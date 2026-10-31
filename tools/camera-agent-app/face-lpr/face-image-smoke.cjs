'use strict'

// Explicit manual read-only NVR test. Downloads TWO face JPEGs to a restricted
// random temp directory on this computer ONLY. Never enabled by Electron.

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { createHistoricalClient } = require('./historical-face-client.cjs')
const { evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('INTERACTIVE_CMD_REQUIRED'))
      return
    }
    let value = ''
    let ended = false
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true)
    input.resume()
    function finish(error) {
      if (ended) return
      ended = true
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
      error ? reject(error) : resolve(value)
    }
    function onData(chunk) {
      for (const char of chunk.toString('utf8')) {
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
  if (process.argv[2] !== '--manual-face-image-test') {
    console.log('NOT_STARTED: --manual-face-image-test required')
    return
  }
  const original = readConfig(path.join(__dirname, 'pilot.config.json'))
  const nvr = original.nvrs.find(x => x.id === 'yakang-nvr-01')
  if (!nvr || original.enabled !== false || nvr.enabled !== false) {
    throw new Error('EXPECTED_DISABLED_PILOT_CONFIG')
  }
  const config = structuredClone(original)
  config.enabled = true
  config.nvrs.find(x => x.id === nvr.id).enabled = true

  console.log('MODE: MANUAL_READ_ONLY')
  console.log('AGENT_ENABLED_BY_THIS_TEST: NO')
  console.log('TARGET_NVR:', nvr.id, nvr.host)
  console.log('SERVER_UPLOAD: NO')
  console.log('EVENT_TIME_EXPECTED: 2026-10-31 12:34:15')

  let password = await askPasswordHidden()
  let outputDir = null
  let completed = false
  try {
    const history = createHistoricalClient({ host: nvr.host, username: 'admin', password })
    let cleanupOk = false
    const result = await history.search({
      uiChannel: 9,
      startTime: '2026-10-31 12:33:00',
      endTime: '2026-10-31 12:36:00',
      onStep: step => {
        if (step === 'CLEANUP_OK') cleanupOk = true
        console.log(step + (step === 'CREATE' || step === 'SEARCH' ? ': OK' : ''))
      },
      onResult: async ({ found, fields, getJpeg }) => {
        if (found !== 1 || fields['items[0].StartTime'] !== '2026-10-31 12:34:15') {
          throw new Error('EVENT_NOT_MATCHED')
        }
        const evaluation = evaluateHistoricalFaceRecord({
          config, nvrId: nvr.id, fields, index: 0,
          minSimilarity: 90, groupName: 'High Risk Person',
        })
        if (!evaluation.qualified) throw new Error('HIGH_RISK_NOT_QUALIFIED')
        if (!evaluation.alert.detectedImagePath || !evaluation.alert.referenceImagePath) {
          throw new Error('IMAGE_PATHS_MISSING')
        }
        console.log('HIGH_RISK_ELIGIBLE: true')
        console.log('SIMILARITY:', evaluation.alert.similarity)
        console.log('ID_DISPLAY_BLANK:', evaluation.alert.personId === '')
        const prefix = 'items[0].SummaryNew[0].Value.'
        const entries = [
          ['Face_Detected.jpg', evaluation.alert.detectedImagePath,
            fields[prefix + 'Object.Image.Length']],
          ['Face_Reference.jpg', evaluation.alert.referenceImagePath,
            fields[prefix + 'Candidates[0].Person.Image[0].Length']],
        ]
        // Read both while the same NVR session is active. No image bytes are
        // written to disk until BOTH pass validation.
        const verified = []
        for (const [fileName, filePath, length] of entries) {
          if (!/^\d+$/.test(length || '')) throw new Error('INVALID_IMAGE_LENGTH_FROM_NVR')
          const jpeg = await getJpeg(filePath, Number(length))
          console.log(fileName + ': VERIFIED (' + jpeg.length + ' bytes)')
          verified.push([fileName, jpeg])
        }
        return verified
      },
    })
    if (!cleanupOk) throw new Error('NVR_SESSION_CLEANUP_UNCONFIRMED')
    console.log('FOUND:', result.found)
    const verified = result.imageResult
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'NRW_Face_Node_'))
    for (const [fileName, bytes] of verified) {
      await fs.writeFile(path.join(outputDir, fileName), bytes, { flag: 'wx', mode: 0o600 })
    }
    completed = true
    console.log('IMAGES_DOWNLOADED: 2')
    console.log('FOLDER:', outputDir)
    console.log('REAL_ALERT_SENT: NO')
    console.log('MAIN_CJS_CHANGED: NO')
    console.log('FACE_IMAGES_REAL_TEST: PASS')
  } finally {
    password = ''
    if (!completed && outputDir) await fs.rm(outputDir, { recursive: true, force: true })
  }
}

main().catch(error => {
  // Error message is our own non-sensitive code; no full URLs or identities.
  console.error('FACE_IMAGES_REAL_TEST: FAIL', error.message)
  process.exitCode = 1
})
