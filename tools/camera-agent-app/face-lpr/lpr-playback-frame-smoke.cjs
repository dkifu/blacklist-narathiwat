'use strict'
// Explicit manual test on pilot NVR only; capture bounded stream -> JPEG entirely in RAM.
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { capturePlaybackH264 } = require('./lpr-playback-frame-probe.cjs')
const { inspectH264 } = require('./lpr-playback-frame-decode.cjs')
const { decodeFirstJpegAsync } = require('./lpr-playback-frame-async.cjs')

function askHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('INTERACTIVE_CMD_REQUIRED'))
    let value = '', ended = false
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true); input.resume()
    function end(err) {
      if (ended) return
      ended = true; input.off('data', onData); input.setRawMode(false); input.pause()
      process.stdout.write('\n')
      if (err) reject(err); else resolve(value)
    }
    function onData(buf) {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return end()
        if (ch === '\u0003') return end(new Error('CANCELLED'))
        if (ch === '\b' || ch === '\u007f') value = value.slice(0,-1)
        else if (ch >= ' ' && value.length < 256) value += ch
      }
    }
    input.on('data', onData)
  })
}
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--manual-lpr-frame-probe') {
    console.log('NOT_STARTED: --manual-lpr-frame-probe required'); return
  }
  const cfg = readConfig(path.join(__dirname,'pilot.config.json'))
  if (cfg.enabled !== false) throw new Error('PILOT_MUST_REMAIN_DISABLED')
  const nvr = cfg.nvrs.find(x => x.id === 'yakang-nvr-01')
  if (!nvr || nvr.enabled !== false || !nvr.cameras.some(c => c.type === 'lpr' && c.channel === 6)) throw new Error('PILOT_LPR_CONFIG_INVALID')
  console.log('MODE: MANUAL_BOUNDED_IN_MEMORY_LPR_FRAME_PROBE')
  console.log('TARGET_NVR:', nvr.id)
  console.log('CHANNEL: 6')
  console.log('TIME_WINDOW_LOCAL_ASSUMED: 2026-10-31 12:34:10 to 12:34:20')
  console.log('CAPTURE_MS: 8000')
  console.log('MEDIA_LIMIT_BYTES: 7340032')
  console.log('PASSWORD_IN_CMD_OR_URL: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  let password = await askHidden()
  try {
    const r = await capturePlaybackH264({ host:nvr.host, uiChannel:6, username:'admin', password,
      startTime:'2026_10_31_12_34_10', endTime:'2026_10_31_12_34_20',
      captureMs:8000, timeoutMs:15000, maxRtpPackets:3000, maxMediaBytes:7*1024*1024 })
    password = ''
    console.log('DESCRIBE_STATUS:', r.describeStatus ?? 'NOT_CONFIRMED')
    console.log('VIDEO_CODEC:', r.codec)
    console.log('SETUP_STATUS:', r.setupStatus ?? 'NOT_SENT')
    console.log('PLAY_STATUS:', r.playStatus ?? 'NOT_SENT')
    console.log('RTP_PACKETS:', r.rtpPackets)
    console.log('H264_BYTES:', r.h264.length)
    console.log('H264_SPS_PRESENT:', !!r.collector?.hasSps)
    console.log('H264_PPS_PRESENT:', !!r.collector?.hasPps)
    console.log('H264_IDR_PRESENT:', !!r.collector?.hasIdr)
    console.log('H264_DISCARDED_PACKETS:', r.collector?.discarded ?? 'UNKNOWN')
    console.log('H264_INCOMPLETE_FU:', !!r.collector?.incompleteFu)
    const nalStats = r.h264.length ? inspectH264(r.h264) : { nals:0, idr:0 }
    console.log('H264_NALS:', nalStats.nals)
    console.log('H264_IDR_NALS:', nalStats.idr)
    console.log('TEARDOWN_SENT:', r.teardownSent)
    console.log('TEARDOWN_STATUS:', r.teardownStatus ?? 'NOT_CONFIRMED')
    if (r.describeStatus !== 200 || r.setupStatus !== 200 || r.playStatus !== 200 || r.rtpPackets === 0 || !r.teardownSent) {
      console.log('LPR_FRAME_REAL_TEST: NOT_CONFIRMED'); process.exitCode = 2; return
    }
    if (!r.collector?.hasSps || !r.collector?.hasPps || !r.collector?.hasIdr) {
      console.log('JPEG_VALID: false')
      console.log('LPR_FRAME_REAL_TEST: NO_DECODABLE_KEYFRAME_IN_CAPTURE')
      process.exitCode = 2; return
    }
    try {
      const jpeg = await decodeFirstJpegAsync(r.h264)
      console.log('JPEG_VALID: true')
      console.log('JPEG_BYTES:', jpeg.length)
      console.log('LPR_FRAME_REAL_TEST: PASS')
    } catch (e) {
      console.log('JPEG_VALID: false')
      console.log('DECODE_DIAGNOSTIC:', e.category || 'DECODE_FAILED')
      console.log('LPR_FRAME_REAL_TEST: NOT_CONFIRMED', e.message)
      process.exitCode = 2
    }
  } finally {
    password = ''
    console.log('MEDIA_SAVED: NO')
    console.log('SERVER_UPLOAD: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  }
}
main().catch(e => { console.error('LPR_FRAME_REAL_TEST: FAIL',e.message); process.exitCode=1 })
