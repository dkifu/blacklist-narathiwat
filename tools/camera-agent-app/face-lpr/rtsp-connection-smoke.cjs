'use strict'

const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { probeSameConnection } = require('./rtsp-connection-diagnostic.cjs')

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('INTERACTIVE_CMD_REQUIRED'))
    let value = ''
    let done = false
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true)
    input.resume()
    const finish = error => {
      if (done) return
      done = true
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = data => {
      for (const c of data.toString('utf8')) {
        if (c === '\r' || c === '\n') return finish()
        if (c === '\u0003') return finish(new Error('CANCELLED'))
        if (c === '\b' || c === '\u007f') value = value.slice(0, -1)
        else if (c >= ' ' && value.length < 256) value += c
      }
    }
    input.on('data', onData)
  })
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--manual-same-connection-diagnostic') {
    console.log('NOT_STARTED: --manual-same-connection-diagnostic required')
    return
  }
  const config = readConfig(path.join(__dirname, 'pilot.config.json'))
  if (config.enabled !== false) throw new Error('PILOT_CONFIG_MUST_STAY_DISABLED')
  const nvr = config.nvrs.find(n => n.id === 'yakang-nvr-01')
  if (!nvr || nvr.enabled !== false) throw new Error('PILOT_NVR_MUST_STAY_DISABLED')
  if (!nvr.cameras.some(c => c.type === 'lpr' && c.channel === 6)) throw new Error('LPR_CHANNEL_6_NOT_CONFIGURED')
  console.log('MODE: MANUAL_READ_ONLY_SAME_TCP_DIAGNOSTIC')
  console.log('TARGET_NVR:', nvr.id)
  console.log('LPR_CHANNEL:', 6)
  console.log('TIME_WINDOW_LOCAL_ASSUMED: 2026-10-31 12:34:10 to 12:34:20')
  console.log('METHOD: DESCRIBE_ONLY')
  console.log('PASSWORD_IN_CMD_OR_URL: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  let password = await askPasswordHidden()
  try {
    const r = await probeSameConnection({
      host: nvr.host, uiChannel: 6,
      startTime: '2026_10_31_12_34_10', endTime: '2026_10_31_12_34_20',
      username: 'admin', password,
    })
    console.log('INITIAL_STATUS:', r.initialStatus)
    console.log('DIGEST_CHALLENGE:', r.digestChallenged)
    console.log('CHALLENGE_ALGORITHM:', r.challengeAlgorithm)
    console.log('CHALLENGE_QOP:', r.challengeQop)
    console.log('AUTH_ATTEMPTED:', r.authAttempted)
    console.log('SAME_TCP_CONNECTION:', r.sameConnection)
    console.log('CONNECTION_CLOSED:', r.connectionClosed)
    console.log('AUTH_DESCRIBE_STATUS:', r.authStatus === null ? 'NOT_RECEIVED' : r.authStatus)
    console.log('DIGEST_STALE_ON_RETRY:', r.staleOnRetry)
    console.log('SDP_VIDEO_PRESENT:', r.videoSdp)
    console.log('SAME_TCP_PROBE:', r.videoSdp ? 'PASS' : 'NOT_CONFIRMED')
    console.log('AGENT_MAIN_CHANGED: NO')
    if (!r.videoSdp) process.exitCode = 2
  } finally { password = '' }
}
main().catch(e => { console.error('SAME_TCP_PROBE: FAIL', e.message); process.exitCode = 1 })
