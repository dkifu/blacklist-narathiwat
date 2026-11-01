'use strict'
// Stage 21.3. Prepare bounded playback requests from the verified high-risk
// capture plan; optionally execute ONE expressly authorized manual sample.
// No Agent hookup, storage, upload, background polling or alert dispatch.
const net = require('node:net')
const { buildLprCapturePlans, parseLocalClock, formatLocalClock } = require('./lpr-capture-plan.cjs')

function privateIpv4(host) {
  if (net.isIP(host) !== 4) return false
  const [a, b] = host.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
function rtspLocalTime(value) {
  if (parseLocalClock(value) === null) throw new Error('INVALID_LOCAL_PLAYBACK_TIME')
  return value.replace(/[- :]/g, '_')
}

function prepareLprPlaybackJobs({ config, assessment } = {}) {
  const prepared = buildLprCapturePlans({ config, assessment })
  if (!prepared.planned) return { prepared: false, reason: prepared.reason, jobs: [], blocked: [] }
  const jobs = []
  const blocked = []
  for (const plan of prepared.plans) {
    const targetNvr = config.nvrs.find(n => n.id === plan.target.nvrId)
    if (plan.status !== 'READY_FOR_MANUAL_CAPTURE_TEST') {
      blocked.push({ targetNvrId: plan.target.nvrId, cameraId: plan.target.cameraId, reason: plan.status })
      continue
    }
    // Fail closed even when a config passes the generic schema validation.
    if (!targetNvr || !targetNvr.enabled || !privateIpv4(targetNvr.host)) {
      blocked.push({ targetNvrId: plan.target.nvrId, cameraId: plan.target.cameraId, reason: 'PRIVATE_ENABLED_NVR_REQUIRED' })
      continue
    }
    const startMs = parseLocalClock(plan.startTimeLocal)
    const endMs = parseLocalClock(plan.endTimeLocalExclusive)
    if (startMs === null || endMs === null || startMs >= endMs) throw new Error('INVALID_CAPTURE_PLAN_WINDOW')
    plan.sampleTimesLocal.forEach((sample, i) => {
      if (typeof sample !== 'string' || !sample.endsWith('.000')) throw new Error('INVALID_CAPTURE_SAMPLE')
      const timeMs = parseLocalClock(sample.slice(0, -4))
      if (timeMs === null || timeMs < startMs || timeMs >= endMs) throw new Error('OUT_OF_WINDOW_SAMPLE')
      // 1..3 seconds: keep within the configured half-open interval. This may
      // include frames adjacent to the requested time; actual frame time UNKNOWN.
      const captureEndMs = Math.min(timeMs + 3000, endMs)
      const startLocal = formatLocalClock(timeMs)
      const endLocal = formatLocalClock(captureEndMs)
      jobs.push({
        mappingId: plan.mappingId,
        target: { nvrId: targetNvr.id, cameraId: plan.target.cameraId,
          host: targetNvr.host, channel: plan.target.channel },
        sampleIndex: i,
        requestedSampleLocal: sample,
        playbackStartLocal: startLocal,
        playbackEndLocalExclusive: endLocal,
        startTimeRtsp: rtspLocalTime(startLocal),
        endTimeRtsp: rtspLocalTime(endLocal),
        actualFrameTime: 'UNKNOWN',
        association: 'TIME_CONTEXT_ONLY',
        status: 'PENDING_EXPLICIT_MANUAL_TEST',
      })
    })
  }
  return { prepared: true, reason: 'BOUNDED_PLAYBACK_JOBS_PREPARED', jobs, blocked }
}

// A one-off read-only diagnostic may use a longer playback URL window.
// This NEVER modifies capture plans, the persisted configuration, or samples.
function manualPlaybackWindow(job, manualWindowSeconds = null) {
  if (manualWindowSeconds !== null && ![5, 10].includes(manualWindowSeconds)) {
    throw new Error('INVALID_MANUAL_WINDOW_SECONDS')
  }
  if (manualWindowSeconds === null) {
    return { startTimeRtsp: job.startTimeRtsp, endTimeRtsp: job.endTimeRtsp,
      startLocal: job.playbackStartLocal, endLocal: job.playbackEndLocalExclusive }
  }
  const startMs = parseLocalClock(job.playbackStartLocal)
  if (startMs === null || job.sampleIndex !== 0) throw new Error('MANUAL_WINDOW_FIRST_SAMPLE_ONLY')
  const endLocal = formatLocalClock(startMs + manualWindowSeconds * 1000)
  return { startTimeRtsp: job.startTimeRtsp, endTimeRtsp: rtspLocalTime(endLocal),
    startLocal: job.playbackStartLocal, endLocal }
}

async function captureOnePlannedSample({ config, assessment, jobIndex,
  username, password, manualReadOnly = false, manualWindowSeconds = null,
  captureH264, decodeH264, onMediaDiagnostic } = {}) {
  if (manualReadOnly !== true) throw new Error('EXPLICIT_MANUAL_TEST_REQUIRED')
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) throw new Error('IN_MEMORY_CREDENTIALS_REQUIRED')
  if (!Number.isSafeInteger(jobIndex) || jobIndex < 0) throw new Error('INVALID_JOB_INDEX')
  const work = prepareLprPlaybackJobs({ config, assessment })
  if (!work.prepared || !work.jobs.length || work.blocked.length) throw new Error('PLAYBACK_PLAN_NOT_READY')
  const job = work.jobs[jobIndex]
  if (!job) throw new Error('INVALID_JOB_INDEX')
  const playback = manualPlaybackWindow(job, manualWindowSeconds)
  // Lazy imports: generating jobs never connects or launches FFmpeg.
  const capture = captureH264 || require('./lpr-playback-frame-probe.cjs').capturePlaybackH264
  const decode = decodeH264 || require('./lpr-playback-frame-async.cjs').decodeFirstJpegAsync
  const media = await capture({ host: job.target.host, uiChannel: job.target.channel,
    username, password, startTime: playback.startTimeRtsp, endTime: playback.endTimeRtsp,
    captureMs: 8000, timeoutMs: 15000, maxRtpPackets: 3000, maxMediaBytes: 7 * 1024 * 1024 })
  // Safe status-only diagnostic: no URLs, credentials, challenge values or media.
  if (typeof onMediaDiagnostic === 'function') {
    const status = n => Number.isInteger(n) && n >= 100 && n <= 599 ? n : null
    const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0
    onMediaDiagnostic(Object.freeze({
      describe: status(media?.describeStatus), setup: status(media?.setupStatus),
      play: status(media?.playStatus), teardown: status(media?.teardownStatus),
      videoSdp: media?.videoSdp === true, sameTcpDigest: media?.sameTcpDigest === true,
      codec: media?.codec === 'H264' ? 'H264' : 'OTHER_OR_UNKNOWN',
      rtpPackets: count(media?.rtpPackets), h264Bytes: Buffer.isBuffer(media?.h264) ? media.h264.length : 0,
      teardownSent: media?.teardownSent === true,
    }))
  }
  if (media?.describeStatus !== 200 || media.setupStatus !== 200 || media.playStatus !== 200 ||
    media.rtpPackets < 1 || !media.teardownSent || !Buffer.isBuffer(media.h264) || !media.h264.length) {
    throw new Error('RTSP_MEDIA_NOT_CONFIRMED')
  }
  const jpeg = await decode(media.h264)
  if (!Buffer.isBuffer(jpeg) || jpeg.length < 100 || jpeg.length > 5*1024*1024 ||
    jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg[jpeg.length - 2] !== 255 || jpeg[jpeg.length - 1] !== 217) {
    throw new Error('JPEG_INVALID')
  }
  // JPEG stays in memory. Caller must implement manual preview and privacy
  // controls separately, before allowing any persisted result or alert.
  return { job, jpeg, actualFrameTime: 'UNKNOWN', verifiedJpeg: true }
}
module.exports = { prepareLprPlaybackJobs, captureOnePlannedSample, manualPlaybackWindow }
