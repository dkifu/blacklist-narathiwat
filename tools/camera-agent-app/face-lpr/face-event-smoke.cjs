'use strict'

// MANUAL STREAM PROBE ONLY: does not enable Face/LPR in main.cjs or write data.
// Run: node face-lpr/face-event-smoke.cjs --manual-live-test
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { receiveFaceEvents } = require('./face-event-stream.cjs')

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      return reject(new Error('INTERACTIVE_CMD_REQUIRED'))
    }
    let value = ''
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true)
    input.resume()
    const finish = (error) => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = chunk => {
      for (const ch of chunk.toString('utf8')) {
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
  if (process.argv[2] !== '--manual-live-test') {
    console.log('NOT_STARTED: explicit --manual-live-test required')
    return
  }
  const cfg = readConfig(path.join(__dirname, 'pilot.config.json'))
  const nvr = cfg.nvrs.find(item => item.id === 'yakang-nvr-01')
  if (!nvr) throw new Error('PILOT_NVR_MISSING')
  const faceChannels = new Set(nvr.cameras.filter(c => c.type === 'face').map(c => c.channel))
  const state = { events: 0, heartbeats: 0, malformed: 0, pilotChannelEvents: 0 }
  console.log('MODE: MANUAL_READ_ONLY')
  console.log('AGENT_ENABLED_BY_THIS_TEST: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('TARGET_NVR:', nvr.id, nvr.host)
  console.log('DURATION_SECONDS: 30')
  const password = await askPasswordHidden()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const outcome = await receiveFaceEvents({
      host: nvr.host,
      username: 'admin', // Manual pilot only; production must use least-privilege per-NVR account.
      password,
      signal: controller.signal,
      onOpen: () => console.log('STREAM: OPEN'),
      onHeartbeat: () => {
        state.heartbeats++
        if (state.heartbeats === 1) console.log('HEARTBEAT: RECEIVED')
      },
      onEvent: event => {
        state.events++
        if (faceChannels.has(event.channel)) state.pilotChannelEvents++
        // Never print payload, names, IDs, paths, image data, or plates.
        console.log('FACE_EVENT: CHANNEL=' + event.channel + ' ACTION=' + event.action)
      },
      onMalformed: reason => {
        state.malformed++
        console.log('PARSER_WARNING:', reason)
      },
    })
    console.log('STREAM_RESULT:', outcome)
  } finally {
    clearTimeout(timeout)
    console.log('----- SUMMARY -----')
    console.log('HEARTBEAT_SEEN:', state.heartbeats > 0)
    console.log('FACE_EVENTS:', state.events)
    console.log('PILOT_FACE_CHANNEL_EVENTS:', state.pilotChannelEvents)
    console.log('MALFORMED_EVENTS:', state.malformed)
    console.log('REAL_ALERT_SENT: NO')
    console.log('MAIN_CJS_CHANGED: NO')
  }
}

main().catch(error => {
  console.error('LIVE_TEST: FAIL', error.message)
  process.exitCode = 1
})
