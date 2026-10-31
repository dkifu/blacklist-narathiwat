'use strict'

// Stage 18: MANUAL REAL NVR TEST. Never imported into main.cjs.
// No personal name, credential, ID, image path, or cookie is logged or stored.

const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')
const { createHistoricalClient } = require('./historical-face-client.cjs')

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('INTERACTIVE_CMD_REQUIRED'))
      return
    }
    let value = ''
    let finished = false
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true)
    input.resume()
    const onData = chunk => {
      if (finished) return
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') { finish(); return }
        if (char === '\u0003') { finish(new Error('CANCELLED')); return }
        if (char === '\b' || char === '\u007f') value = value.slice(0, -1)
        else if (char >= ' ' && value.length < 256) value += char
      }
    }
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
    input.on('data', onData)
  })
}

async function main() {
  if (process.argv[2] !== '--manual-historical-test') {
    console.log('NOT_STARTED: --manual-historical-test required')
    return
  }

  const original = readConfig(path.join(__dirname, 'pilot.config.json'))
  const nvr = original.nvrs.find(x => x.id === 'yakang-nvr-01')
  if (!nvr) throw new Error('PILOT_NVR_NOT_CONFIGURED')
  const config = structuredClone(original)
  config.enabled = true // ONLY an in-memory test copy, never write/enable the Agent.
  const selectedNvr = config.nvrs.find(x => x.id === nvr.id)
  selectedNvr.enabled = true

  console.log('MODE: MANUAL_READ_ONLY')
  console.log('AGENT_ENABLED_BY_THIS_TEST: NO')
  console.log('PILOT_CONFIG_FILE_STILL_DISABLED:', original.enabled === false && nvr.enabled === false)
  console.log('SERVER_UPLOAD: NO')
  console.log('TARGET_NVR:', nvr.id, nvr.host)
  console.log('EVENT_TIME_EXPECTED: 2026-10-31 12:34:15')

  let password = await askPasswordHidden()
  try {
    const client = createHistoricalClient({ host: nvr.host, username: 'admin', password })
    const result = await client.search({
      uiChannel: 9,
      startTime: '2026-10-31 12:33:00',
      endTime: '2026-10-31 12:36:00',
      onStep: step => console.log(step + (step === 'CREATE' || step === 'SEARCH' ? ': OK' : '')),
    })

    console.log('FOUND:', result.found)
    if (result.found !== 1) throw new Error('EXPECTED_ONE_HISTORICAL_EVENT')
    const fields = result.fields
    const timeMatches = fields['items[0].StartTime'] === '2026-10-31 12:34:15'
    console.log('EVENT_TIME_MATCHED:', timeMatches)
    if (!timeMatches) throw new Error('EVENT_TIME_MISMATCH')
    const evaluation = evaluateHistoricalFaceRecord({
      config, nvrId: nvr.id, fields, index: 0,
      minSimilarity: 90, groupName: 'High Risk Person',
    })
    console.log('HIGH_RISK_ELIGIBLE:', evaluation.qualified)
    console.log('REASON:', evaluation.reason)
    if (!evaluation.qualified) throw new Error('REAL_RECORD_FILTER_REJECTED')
    const alert = evaluation.alert
    console.log('FACE_CHANNEL:', alert.faceChannel)
    console.log('SIMILARITY:', alert.similarity)
    console.log('PERSON_NAME_PRESENT:', Boolean(alert.personName))
    console.log('ID_DISPLAY_BLANK:', alert.personId === '')
    console.log('DETECTED_PATH_PRESENT:', Boolean(alert.detectedImagePath))
    console.log('REFERENCE_PATH_PRESENT:', Boolean(alert.referenceImagePath))
    console.log('LPR_CHANNELS:', alert.lprTargets.map(x => x.channel).join(','))
    console.log('IMAGES_DOWNLOADED: NO')
    console.log('DEDUPE_PERSISTED: NO')
    console.log('REAL_ALERT_SENT: NO')
    console.log('MAIN_CJS_CHANGED: NO')
    console.log('HISTORICAL_HIGH_RISK_TEST: PASS')
  } finally {
    password = ''
  }
}

main().catch(e => {
  // Internal errors only; do not expose raw NVR bodies or personal data.
  console.error('HISTORICAL_HIGH_RISK_TEST: FAIL', e.message)
  process.exitCode = 1
})
