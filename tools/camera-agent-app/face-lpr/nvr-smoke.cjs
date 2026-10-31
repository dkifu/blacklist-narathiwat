'use strict'

// Manual read-only pilot test. NEVER imported automatically by main.cjs.
// Run only with: node face-lpr/nvr-smoke.cjs --read-only-pilot-test
// Credentials are entered interactively and not stored on disk.

const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { createNvrClient, parseChannelTitles } = require('./nvr-client.cjs')

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('INTERACTIVE_CMD_REQUIRED'))
      return
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
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') { finish(); return }
        if (char === '\u0003') { finish(new Error('CANCELLED')); return }
        if (char === '\b' || char === '\u007f') {
          value = value.slice(0, -1)
        } else if (char >= ' ' && char !== '\u007f' && value.length < 256) {
          value += char
        }
      }
    }
    input.on('data', onData)
  })
}

async function run() {
  if (process.argv[2] !== '--read-only-pilot-test') {
    console.log('Not started. Explicit --read-only-pilot-test flag required.')
    return
  }
  const config = readConfig(path.join(__dirname, 'pilot.config.json'))
  const nvr = config.nvrs[0]
  if (!nvr) throw new Error('NO_PILOT_NVR')
  console.log('MODE: MANUAL_READ_ONLY')
  console.log('AGENT_ENABLED_BY_THIS_TEST: NO')
  console.log('TARGET_NVR:', nvr.id, nvr.host)
  const username = 'admin' // Pilot test only; production credentials will be per NVR.
  let password = await askPasswordHidden()
  try {
    const client = createNvrClient({ host: nvr.host, username, password })
    const caps = await client.getCaps()
    console.log('GET_CAPS: OK')
    console.log('CAPS_COUNT:', caps.split(/\r?\n/).filter(x => x.startsWith('caps.')).length)
    const titles = parseChannelTitles(await client.getChannelTitles())
    console.log('CHANNEL_TITLES:', titles.size)
    console.log('CAM_6:', titles.get(6) || 'NOT_FOUND')
    console.log('CAM_9:', titles.get(9) || 'NOT_FOUND')
    console.log('PILOT_READ_ONLY_TEST: PASS')
  } finally {
    password = ''
  }
}

run().catch(error => {
  console.error('PILOT_READ_ONLY_TEST: FAIL', error.message)
  process.exitCode = 1
})
