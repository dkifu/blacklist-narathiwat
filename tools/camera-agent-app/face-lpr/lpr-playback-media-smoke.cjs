'use strict'
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { probePlaybackMedia } = require('./lpr-playback-media-probe.cjs')

function askHidden() {
  return new Promise((resolve, reject) => {
    const i=process.stdin
    if (!i.isTTY || typeof i.setRawMode !== 'function') return reject(new Error('INTERACTIVE_CMD_REQUIRED'))
    let value='', ended=false
    process.stdout.write('NVR Password (hidden): ')
    i.setRawMode(true); i.resume()
    function end(error) {
      if (ended) return
      ended=true; i.off('data', onData); i.setRawMode(false); i.pause()
      process.stdout.write('\n')
      if (error) reject(error); else resolve(value)
    }
    function onData(data) {
      for (const c of data.toString('utf8')) {
        if (c === '\r' || c === '\n') return end()
        if (c === '\u0003') return end(new Error('CANCELLED'))
        if (c === '\b' || c === '\u007f') value=value.slice(0,-1)
        else if (c >= ' ' && value.length < 256) value+=c
      }
    }
    i.on('data', onData)
  })
}
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--manual-lpr-media-probe') {
    console.log('NOT_STARTED: --manual-lpr-media-probe required'); return
  }
  const config=readConfig(path.join(__dirname, 'pilot.config.json'))
  if (config.enabled !== false) throw new Error('PILOT_CONFIG_MUST_REMAIN_DISABLED')
  const nvr=config.nvrs.find(x => x.id === 'yakang-nvr-01')
  if (!nvr || nvr.enabled !== false || !nvr.cameras.some(x => x.type === 'lpr' && x.channel === 6)) throw new Error('PILOT_LPR_CONFIG_INVALID')
  console.log('MODE: MANUAL_BOUNDED_LPR_MEDIA_PROBE')
  console.log('TARGET_NVR:', nvr.id)
  console.log('CHANNEL: 6')
  console.log('TIME_WINDOW_LOCAL_ASSUMED: 2026-10-31 12:34:10 to 12:34:20')
  console.log('METHODS: DESCRIBE SETUP PLAY TEARDOWN')
  console.log('MAX_RTP_PACKETS: 5')
  console.log('MEDIA_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('PASSWORD_IN_CMD_OR_URL: NO')
  let password=await askHidden()
  try {
    const result=await probePlaybackMedia({
      host:nvr.host, username:'admin', password, uiChannel:6,
      startTime:'2026_10_31_12_34_10', endTime:'2026_10_31_12_34_20',
    })
    console.log('AUTH_SAME_TCP:', result.sameTcpDigest)
    console.log('DESCRIBE_STATUS:', result.describeStatus ?? 'NOT_RECEIVED')
    console.log('SDP_VIDEO_PRESENT:', result.videoSdp)
    console.log('VIDEO_CODEC:', result.codec)
    console.log('SETUP_STATUS:', result.setupStatus ?? 'NOT_SENT')
    console.log('PLAY_STATUS:', result.playStatus ?? 'NOT_SENT')
    console.log('RTP_VIDEO_PACKETS:', result.rtpPackets)
    console.log('RTP_PAYLOAD_BYTES:', result.rtpPayloadBytes)
    console.log('TEARDOWN_SENT:', result.teardownSent)
    console.log('TEARDOWN_STATUS:', result.teardownStatus ?? 'NOT_CONFIRMED')
    console.log('LPR_RECORDED_MEDIA_PROBE:', result.playStatus===200 && result.rtpPackets>0 ? 'PASS' : 'NOT_CONFIRMED')
    console.log('MEDIA_SAVED: NO')
    console.log('MAIN_CJS_CHANGED: NO')
    if (result.playStatus !== 200 || result.rtpPackets === 0) process.exitCode=2
  } finally { password='' }
}
main().catch(e => { console.error('LPR_RECORDED_MEDIA_PROBE: FAIL',e.message); process.exitCode=1 })
