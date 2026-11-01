'use strict'

// Manual read-only RTSP DESCRIBE check. No video frames, secrets or images saved.
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { probePlayback } = require('./lpr-playback-probe.cjs')

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('INTERACTIVE_CMD_REQUIRED'))
    let value = ''
    let finished = false
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true)
    input.resume()
    const finish = error => {
      if (finished) return
      finished = true
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = data => {
      for (const char of data.toString('utf8')) {
        if (char === '\r' || char === '\n') return finish()
        if (char === '\u0003') return finish(new Error('CANCELLED'))
        if (char === '\b' || char === '\u007f') value = value.slice(0, -1)
        else if (char >= ' ' && value.length < 256) value += char
      }
    }
    input.on('data', onData)
  })
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--manual-playback-probe') {
    console.log('NOT_STARTED: --manual-playback-probe required')
    return
  }
  const config = readConfig(path.join(__dirname, 'pilot.config.json'))
  if (config.enabled !== false) throw new Error('PILOT_CONFIG_MUST_STAY_DISABLED')
  const nvr = config.nvrs.find(item => item.id === 'yakang-nvr-01')
  if (!nvr || nvr.enabled !== false) throw new Error('PILOT_NVR_MUST_STAY_DISABLED')
  const camera = nvr.cameras.find(c => c.type === 'lpr' && c.channel === 6)
  if (!camera) throw new Error('LPR_CHANNEL_6_NOT_CONFIGURED')
  console.log('MODE: MANUAL_RTSP_DESCRIBE_ONLY')
  console.log('TARGET_NVR:', nvr.id)
  console.log('LPR_CHANNEL:', camera.channel)
  console.log('TIME_WINDOW_LOCAL_ASSUMED: 2026-10-31 12:34:10 to 12:34:20')
  console.log('PASSWORD_IN_CMD_OR_URL: NO')
  console.log('SETUP_OR_PLAY_SENT: NO')
  console.log('IMAGES_OR_VIDEO_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  let password = await askPasswordHidden()
  try {
    const result = await probePlayback({
      host: nvr.host,
      uiChannel: camera.channel,
      startTime: '2026_10_31_12_34_10',
      endTime: '2026_10_31_12_34_20',
      username: 'admin',
      password,
    })
    console.log('RTSP_DIGEST_CHALLENGE:', result.digestChallenged)
    console.log('RTSP_DESCRIBE_STATUS:', result.status)
    console.log('SDP_VIDEO_PRESENT:', result.videoSdp)
    console.log('PLAYBACK_RTSP_PROBE:', result.videoSdp ? 'PASS' : 'NOT_CONFIRMED')
    console.log('AGENT_MAIN_CHANGED: NO')
    if (!result.videoSdp) process.exitCode = 2
  } finally { password = '' }
}

main().catch(err => {
  console.error('PLAYBACK_RTSP_PROBE: FAIL', err.message)
  process.exitCode = 1
})
