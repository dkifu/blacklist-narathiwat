'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { readConfig, validateConfig } = require('./config.cjs')
const { evaluateHistoricalFaceRecord, evaluateLiveFaceEvent } = require('./high-risk-filter.cjs')
const { buildLprCapturePlans, parseLocalClock } = require('./lpr-capture-plan.cjs')

const original = readConfig(path.join(__dirname, 'pilot.config.json'))
const clone = v => structuredClone(v)
const config = clone(original)
config.enabled = true
config.nvrs[0].enabled = true
const prefix = 'items[0].'
const summary = prefix + 'SummaryNew[0].Value.'
const candidate = summary + 'Candidates[0].'
const fakeFields = {
  [prefix + 'Channel']: '8', [prefix + 'StartTime']: '2026-10-31 12:34:15',
  [candidate + 'Person.Name']: 'TEST PERSON', [candidate + 'Person.GroupName']: 'High Risk Person',
  [candidate + 'Similarity']: '91', [candidate + 'Person.ID']: 'DO_NOT_COPY',
}
const assessed = evaluateHistoricalFaceRecord({ config, nvrId: 'yakang-nvr-01', fields: fakeFields })
assert.equal(assessed.qualified, true)
assert.equal(buildLprCapturePlans({ config: original, assessment: assessed }).reason, 'MODULE_DISABLED')
assert.equal(original.enabled, false)
assert.equal(original.nvrs[0].enabled, false)
console.log('PASS: real pilot remains disabled, planning cannot activate cameras')

const result = buildLprCapturePlans({ config, assessment: assessed })
assert.equal(result.planned, true)
assert.equal(result.plans.length, 1)
const plan = result.plans[0]
assert.deepEqual(plan.target, { nvrId: 'yakang-nvr-01', cameraId: 'yakang-lpr-cam-06', channel: 6 })
assert.equal(plan.startTimeLocal, '2026-10-31 12:34:10')
assert.equal(plan.endTimeLocalExclusive, '2026-10-31 12:34:15')
assert.deepEqual(plan.sampleTimesLocal, [
  '2026-10-31 12:34:10.000', '2026-10-31 12:34:11.000', '2026-10-31 12:34:12.000',
  '2026-10-31 12:34:13.000', '2026-10-31 12:34:14.000',
])
assert.equal(plan.status, 'READY_FOR_MANUAL_CAPTURE_TEST')
assert.equal(plan.association, 'TIME_CONTEXT_ONLY')
assert.ok(!JSON.stringify(result).includes('TEST PERSON'))
assert.ok(!JSON.stringify(result).includes('DO_NOT_COPY'))
console.log('PASS: historical Face CAM9 -> LPR CAM6, -5s/5s/5 samples, no personal data copied')

const multi = clone(config)
multi.nvrs[0].cameras.push({ id: 'yakang-lpr-cam-07', channel: 7, type: 'lpr' })
multi.nvrs.push({ id: 'nvr-02', host: '172.17.2.24', enabled: true, cameras: [
  { id: 'other-lpr-cam-01', channel: 1, type: 'lpr' },
] })
multi.mappings[0].lprCameraIds.push('yakang-lpr-cam-07', 'other-lpr-cam-01')
assert.equal(validateConfig(multi).valid, true)
const multiEvent = evaluateHistoricalFaceRecord({ config: multi, nvrId: 'yakang-nvr-01', fields: fakeFields })
const multiPlan = buildLprCapturePlans({ config: multi, assessment: multiEvent })
assert.equal(multiPlan.plans.length, 3)
assert.deepEqual(multiPlan.plans.map(p => p.target.channel), [6, 7, 1])
assert.equal(multiPlan.plans[2].status, 'CROSS_NVR_CLOCK_SYNC_REQUIRED')
assert.equal(multiPlan.plans[2].requiresClockSyncReview, true)
console.log('PASS: many LPRs on same/cross NVR; cross-NVR requires clock-sync review')

const live = evaluateLiveFaceEvent({ config, nvrId: 'yakang-nvr-01', event: {
  code: 'FaceComparision', action: 'Pulse', channel: 9,
  data: { Candidates: [{ Person: { Name: 'TEST', GroupName: 'High Risk Person' }, Similarity: 91 }] },
} })
assert.equal(live.qualified, true)
assert.equal(buildLprCapturePlans({ config, assessment: live }).reason, 'EVENT_TIME_NOT_VERIFIED')
assert.equal(buildLprCapturePlans({ config, assessment: { qualified: false, reason: 'NOT_FACE_PULSE' } }).reason, 'NOT_QUALIFIED_HIGH_RISK')
const tampered = clone(assessed)
tampered.alert.lprTargets.push({ nvrId: 'unknown', cameraId: 'injected', channel: 1 })
assert.equal(buildLprCapturePlans({ config, assessment: tampered }).reason, 'TARGET_LIST_MISMATCH')
const editedId = clone(assessed)
editedId.alert.personId = 'SHOULD_REJECT'
assert.equal(buildLprCapturePlans({ config, assessment: editedId }).reason, 'UNTRUSTED_HIGH_RISK_CONTEXT')
console.log('PASS: unverified live time, unqualified event, injected target and nonblank ID rejected')

for (const invalid of ['2026-02-30 12:34:15', '2026-10-31T12:34:15Z', '2026-10-31 25:34:15', '']) assert.equal(parseLocalClock(invalid), null)
assert.equal(parseLocalClock('2024-02-29 23:59:59') !== null, true)
const midnight = clone(assessed)
midnight.alert.eventTime = '2026-11-01 00:00:02'
const rollover = buildLprCapturePlans({ config, assessment: midnight }).plans[0]
assert.equal(rollover.startTimeLocal, '2026-10-31 23:59:57')
assert.equal(rollover.sampleTimesLocal[0], '2026-10-31 23:59:57.000')
console.log('PASS: strict NVR-local wall time, invalid dates rejected, midnight rollover correct')

console.log('LPR_CAPTURE_PLAN_OFFLINE_TEST: PASS')
console.log('REAL_NVR_REQUEST_SENT: NO')
console.log('MEDIA_SAVED: NO')
console.log('SERVER_UPLOAD: NO')
console.log('AGENT_MAIN_CHANGED: NO')
