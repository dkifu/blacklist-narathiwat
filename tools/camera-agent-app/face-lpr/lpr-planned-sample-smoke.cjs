'use strict'
// Stage 21.4: manually requested, read-only real pilot smoke.
// One planned LPR JPEG in RAM; no Agent, saved media, upload, or alerts.
const path = require('node:path')
const { readConfig, validateConfig } = require('./config.cjs')
const { createHistoricalClient } = require('./historical-face-client.cjs')
const { evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')
const { prepareLprPlaybackJobs, captureOnePlannedSample, manualPlaybackWindow } = require('./lpr-playback-jobs.cjs')

const PILOT_NVR_ID = 'yakang-nvr-01'
const PILOT_IP = '172.17.2.23'
const EVENT_TIME = '2026-10-31 12:34:15'

function prepareOneSample({ original, fields }) {
  if (!validateConfig(original).valid || original.enabled !== false) throw new Error('PILOT_CONFIG_MUST_BE_DISABLED')
  const originalNvr = original.nvrs.find(n => n.id === PILOT_NVR_ID)
  if (!originalNvr || originalNvr.host !== PILOT_IP || originalNvr.enabled !== false ||
    !originalNvr.cameras.some(c => c.type === 'face' && c.channel === 9) ||
    !originalNvr.cameras.some(c => c.type === 'lpr' && c.channel === 6)) {
    throw new Error('PILOT_NVR_CONFIG_MISMATCH')
  }
  if (!fields || fields['items[0].StartTime'] !== EVENT_TIME) throw new Error('EXPECTED_HISTORICAL_EVENT_NOT_FOUND')
  const config = structuredClone(original)
  config.enabled = true // In-memory test copy only. Never persisted.
  config.nvrs.find(n => n.id === PILOT_NVR_ID).enabled = true
  const assessment = evaluateHistoricalFaceRecord({
    config, nvrId: PILOT_NVR_ID, fields, index: 0,
    minSimilarity: 90, groupName: 'High Risk Person',
  })
  if (!assessment.qualified || assessment.alert.personId !== '' ||
    assessment.alert.faceChannel !== 9 || assessment.alert.eventTime !== EVENT_TIME) {
    throw new Error('HIGH_RISK_RECORD_NOT_QUALIFIED')
  }
  const prepared = prepareLprPlaybackJobs({ config, assessment })
  if (!prepared.prepared || prepared.blocked.length !== 0 || prepared.jobs.length !== 5) {
    throw new Error('PLAYBACK_PLAN_NOT_READY')
  }
  const job = prepared.jobs[0]
  if (job.target.nvrId !== PILOT_NVR_ID || job.target.host !== PILOT_IP ||
    job.target.channel !== 6 || job.startTimeRtsp !== '2026_10_31_12_34_10' ||
    job.endTimeRtsp !== '2026_10_31_12_34_13' || job.actualFrameTime !== 'UNKNOWN') {
    throw new Error('PILOT_PLAYBACK_JOB_MISMATCH')
  }
  return { config, assessment, job }
}

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('INTERACTIVE_CMD_REQUIRED'))
    let value = '', ended = false
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true); input.resume()
    const finish = err => {
      if (ended) return
      ended = true
      input.off('data', onData)
      input.setRawMode(false); input.pause()
      process.stdout.write('\n')
      if (err) reject(err)
      else resolve(value)
    }
    function onData(buf) {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish()
        if (ch === '\u0003') return finish(new Error('CANCELLED'))
        if (ch === '\b' || ch === '\u007f') value = value.slice(0, -1)
        else if (ch >= ' ' && value.length < 256) value += ch
      }
    }
    input.on('data', onData)
  })
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--manual-one-planned-sample') {
    console.log('NOT_STARTED: --manual-one-planned-sample required')
    return
  }
  const original = readConfig(path.join(__dirname, 'pilot.config.json'))
  if (original.enabled !== false || original.nvrs.find(n => n.id === PILOT_NVR_ID)?.enabled !== false) {
    throw new Error('PILOT_MUST_REMAIN_DISABLED')
  }
  console.log('MODE: MANUAL_SINGLE_PLANNED_LPR_SAMPLE')
  console.log('TARGET_NVR:', PILOT_NVR_ID)
  console.log('FACE_CHANNEL: 9')
  console.log('LPR_CHANNEL: 6')
  console.log('EVENT_TIME_LOCAL:', EVENT_TIME)
  console.log('SAMPLES_TO_CAPTURE: 1 of 5')
  console.log('MEDIA_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('REAL_ALERT_SENT: NO')
  console.log('PASSWORD_IN_CMD_OR_URL: NO')
  let password = await askPasswordHidden()
  try {
    const client = createHistoricalClient({ host: PILOT_IP, username: 'admin', password })
    const history = await client.search({
      uiChannel: 9, startTime: '2026-10-31 12:33:00', endTime: '2026-10-31 12:36:00',
      onStep: step => console.log(step + (['CREATE', 'SEARCH'].includes(step) ? ': OK' : '')),
    })
    console.log('FOUND:', history.found)
    if (history.found !== 1) throw new Error('EXPECTED_ONE_HISTORICAL_EVENT')
    const { config, assessment, job } = prepareOneSample({ original, fields: history.fields })
    console.log('HIGH_RISK_ELIGIBLE:', assessment.qualified)
    console.log('ID_DISPLAY_BLANK:', assessment.alert.personId === '')
    console.log('PLANNED_JOBS:', 5)
    console.log('REQUESTED_SAMPLE_LOCAL:', job.requestedSampleLocal)
    const diagnosticWindow = manualPlaybackWindow(job, 10)
    console.log('PLANNED_WINDOW_LOCAL:', job.playbackStartLocal, 'to', job.playbackEndLocalExclusive)
    console.log('MANUAL_PLAYBACK_WINDOW_LOCAL:', diagnosticWindow.startLocal, 'to', diagnosticWindow.endLocal)
    console.log('MANUAL_WINDOW_SECONDS: 10')
    const result = await captureOnePlannedSample({
      config, assessment, jobIndex: 0, username: 'admin', password, manualReadOnly: true,
      manualWindowSeconds: 10,
      onMediaDiagnostic: media => {
        console.log('LPR_RTSP_STATUS: DESCRIBE=' + (media.describe ?? 'NA') +
          ' SETUP=' + (media.setup ?? 'NA') + ' PLAY=' + (media.play ?? 'NA') +
          ' SDP_VIDEO=' + media.videoSdp + ' CODEC=' + media.codec +
          ' SAME_TCP_DIGEST=' + media.sameTcpDigest +
          ' RTP_PACKETS=' + media.rtpPackets + ' H264_BYTES=' + media.h264Bytes +
          ' TEARDOWN_SENT=' + media.teardownSent + ' TEARDOWN=' + (media.teardown ?? 'NA'))
      },
    })
    console.log('JPEG_VALID:', result.verifiedJpeg)
    console.log('JPEG_BYTES:', result.jpeg.length)
    console.log('ACTUAL_FRAME_TIME:', result.actualFrameTime)
    console.log('VEHICLE_PERSON_ASSOCIATION_CONFIRMED: NO')
    console.log('LPR_PLANNED_REAL_SAMPLE_TEST: PASS')
  } finally {
    password = ''
    console.log('MEDIA_SAVED: NO')
    console.log('SERVER_UPLOAD: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  }
}

if (require.main === module) main().catch(error => {
  // Only locally authored error codes, never raw RTSP/CGI responses or personal data.
  console.error('LPR_PLANNED_REAL_SAMPLE_TEST: FAIL', error.message)
  process.exitCode = 1
})
module.exports = { prepareOneSample }
