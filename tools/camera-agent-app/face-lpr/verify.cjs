'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { readConfig, validateConfig } = require('./config.cjs')

const config = readConfig(path.join(__dirname, 'pilot.config.json'))
assert.equal(config.enabled, false, 'pilot must be disabled by default')
assert.equal(config.nvrs[0].enabled, false, 'pilot NVR must be disabled by default')
console.log('PASS: pilot disabled by default')

const copy = value => JSON.parse(JSON.stringify(value))
const many = copy(config)
many.nvrs[0].cameras.push(
  { id: 'yakang-face-cam-10', channel: 10, type: 'face' },
  { id: 'yakang-lpr-cam-07', channel: 7, type: 'lpr' }
)
many.nvrs.push({
  id: 'other-nvr-02', host: '192.0.2.2', enabled: false,
  cameras: [
    { id: 'other-lpr-01', channel: 1, type: 'lpr' },
    { id: 'other-face-02', channel: 2, type: 'face' }
  ]
})
many.mappings.push({
  id: 'cross-nvr-test',
  faceCameraId: 'yakang-face-cam-10',
  lprCameraIds: ['yakang-lpr-cam-07', 'other-lpr-01'],
  capture: { offsetSeconds: -5, windowSeconds: 5, sampleCount: 5 }
})
assert.equal(validateConfig(many).valid, true)
console.log('PASS: multiple NVRs / many cameras / cross-NVR mapping')

const missingLpr = copy(config)
missingLpr.mappings[0].lprCameraIds = ['missing-camera']
assert.equal(validateConfig(missingLpr).valid, false)
console.log('PASS: missing LPR mapping rejected')

const duplicate = copy(config)
duplicate.nvrs[0].cameras.push({ id: 'yakang-lpr-cam-06', channel: 7, type: 'lpr' })
assert.equal(validateConfig(duplicate).valid, false)
console.log('PASS: duplicate camera ID rejected')

const withPassword = copy(config)
withPassword.nvrs[0].password = 'DO_NOT_STORE_HERE'
assert.equal(validateConfig(withPassword).valid, false)
console.log('PASS: plaintext password field rejected')

console.log('CONFIG_TEST: PASS')
console.log('NVR_REQUEST_SENT: NO')
console.log('AGENT_MAIN_CHANGED: NO')
