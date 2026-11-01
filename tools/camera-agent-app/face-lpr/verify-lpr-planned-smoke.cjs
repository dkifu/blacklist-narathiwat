'use strict'
// No network or secrets: tests only the real-pilot smoke's preflight guard.
const assert = require('node:assert/strict')
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { prepareOneSample } = require('./lpr-planned-sample-smoke.cjs')
const config = readConfig(path.join(__dirname, 'pilot.config.json'))
const fields = {
  'items[0].Channel': '8',
  'items[0].StartTime': '2026-10-31 12:34:15',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.Name': 'SYNTHETIC TEST ONLY',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.GroupName': 'High Risk Person',
  'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '91',
}
assert.equal(config.enabled, false)
const plan = prepareOneSample({ original: config, fields })
assert.equal(plan.job.startTimeRtsp, '2026_10_31_12_34_10')
assert.equal(plan.job.endTimeRtsp, '2026_10_31_12_34_13')
assert.equal(plan.job.target.channel, 6)
assert.equal(plan.assessment.alert.personId, '')
assert.equal(config.enabled, false)
assert.equal(config.nvrs[0].enabled, false)
console.log('PASS: real-pilot historical Face9 -> LPR6 one sample planned 12:34:10 to 12:34:13')
let tampered = structuredClone(config)
tampered.enabled = true
assert.throws(() => prepareOneSample({ original: tampered, fields }), /PILOT_CONFIG_MUST_BE_DISABLED/)
tampered = structuredClone(config)
tampered.nvrs[0].host = '8.8.8.8'
assert.throws(() => prepareOneSample({ original: tampered, fields }), /PILOT_NVR_CONFIG_MISMATCH/)
assert.throws(() => prepareOneSample({ original: config, fields: { ...fields, 'items[0].StartTime': '2026-10-31 12:35:15' } }), /EXPECTED_HISTORICAL_EVENT_NOT_FOUND/)
assert.throws(() => prepareOneSample({ original: config, fields: { ...fields, 'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '80' } }), /HIGH_RISK_RECORD_NOT_QUALIFIED/)
console.log('PASS: disabled real config, wrong NVR, wrong event time and low score blocked')
console.log('LPR_PLANNED_SAMPLE_OFFLINE_TEST: PASS')
console.log('REAL_NVR_REQUEST_SENT: NO')
console.log('MEDIA_SAVED: NO')
console.log('AGENT_MAIN_CHANGED: NO')
