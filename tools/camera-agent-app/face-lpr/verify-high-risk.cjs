'use strict'

// Offline test only. Synthetic names and synthetic historical fields.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { evaluateLiveFaceEvent, evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')
const { validateConfig } = require('./config.cjs')

const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'pilot.config.json'), 'utf8'))
const fixture = {
  ...base, enabled: true,
  nvrs: base.nvrs.map(n => ({ ...n, enabled: true, cameras: n.cameras.map(c => ({ ...c })) })),
}
assert.equal(validateConfig(fixture).valid, true)
const nvrId = fixture.nvrs[0].id
const sampleCandidate = (name, group, similarity) => ({ Person: { Name: name, GroupName: group, ID: 'MUST_NOT_LEAK' }, Similarity: similarity })
const event = (channel, candidates, action = 'Pulse') => ({ code: 'FaceComparision', action, index: channel - 1, channel, data: { Candidates: candidates } })
const assess = (e, config = fixture, sourceId = nvrId) => evaluateLiveFaceEvent({ config, nvrId: sourceId, event: e })

assert.deepEqual(evaluateLiveFaceEvent({ config: base, nvrId, event: event(9, [sampleCandidate('TEST PERSON', 'High Risk Person', 91)]) }), { qualified: false, reason: 'MODULE_DISABLED' })
assert.equal(assess(event(9, [sampleCandidate('FAKE PERSON', 'High Risk Person', 91)])).qualified, true)
console.log('PASS: disabled pilot stays disabled; qualifying synthetic candidate accepted only in test copy')

const result = assess(event(9, [sampleCandidate('TEST PERSON', 'High Risk Person', 91)]))
assert.equal(result.alert.personId, '')
assert.equal(result.alert.personName, 'TEST PERSON')
assert.equal(result.alert.faceChannel, 9)
assert.equal(result.alert.eventKey, null)
assert.equal(result.alert.verifiedImagePair, false)
assert.deepEqual(result.alert.lprTargets.map(x => x.channel), [6])
assert.ok(!JSON.stringify(result).includes('MUST_NOT_LEAK'))
console.log('PASS: Face CAM 9 -> LPR CAM 6, blank ID, no false image/dedupe claims')

assert.equal(assess(event(9, [sampleCandidate('TEST', 'High Risk Person', 89)])).qualified, false)
assert.equal(assess(event(9, [sampleCandidate('TEST', 'Visitors', 99)])).qualified, false)
assert.equal(assess(event(9, [sampleCandidate('TEST', 'High Risk Person', 91)], 'Start')).qualified, false)
assert.equal(assess(event(6, [sampleCandidate('TEST', 'High Risk Person', 99)])).qualified, false)
assert.equal(assess(event(9, [{ Person: { Name: 'TEST' }, Similarity: 99 }])).qualified, false)
assert.equal(assess({ ...event(9, []), data: { Name: 'TEST', Sim: 99, Candidates: null } }).qualified, false)
assert.equal(assess(event(9, [sampleCandidate('TEST', 'High Risk Person', 101)])).qualified, false)
console.log('PASS: low score, other group, wrong action/channel, missing group and invalid scores ignored')

const mixed = assess(event(9, [sampleCandidate('LOW', 'High Risk Person', 40), sampleCandidate('OTHER', 'Visitors', 99)]))
assert.equal(mixed.qualified, false)
const best = assess(event(9, [sampleCandidate('A', 'High Risk Person', 91), sampleCandidate('B', 'High Risk Person', 94)]))
assert.equal(best.alert.personName, 'B')
assert.equal(best.alert.similarity, 94)
console.log('PASS: same-candidate threshold/group enforcement; multiple candidates handled')

const cross = structuredClone(fixture)
cross.nvrs.push({ id: 'nvr-02', host: '172.17.2.24', enabled: true, cameras: [{ id: 'lpr-02', type: 'lpr', channel: 2 }] })
cross.mappings[0].lprCameraIds.push('lpr-02')
assert.equal(validateConfig(cross).valid, true)
const crossResult = assess(event(9, [sampleCandidate('TEST', 'High Risk Person', 91)]), cross)
assert.deepEqual(crossResult.alert.lprTargets.map(x => x.nvrId), [nvrId, 'nvr-02'])
assert.equal(assess(event(9, [sampleCandidate('TEST', 'High Risk Person', 91)]), cross, 'nvr-02').qualified, false)
console.log('PASS: many NVR/camera mappings; originating NVR correctly scoped')

const p = 'items[0].'
const f = p + 'SummaryNew[0].Value.'
const c = f + 'Candidates[0].'
const historicalFields = {
  [p + 'Channel']: '8',
  [p + 'StartTime']: '2026-10-31 12:34:15',
  [c + 'Person.Name']: 'SYNTHETIC ONLY',
  [c + 'Person.GroupName']: 'High Risk Person',
  [c + 'Person.ID']: 'MUST_NOT_LEAK',
  [c + 'Similarity']: '91',
  [f + 'Object.Image.FilePath']: '/IntelliStorage/mnt/test-detected.jpg',
  [c + 'Person.Image[0].FilePath']: '/IntelliStorage/mnt/test-reference.jpg',
}
const historic = evaluateHistoricalFaceRecord({ config: fixture, nvrId, fields: historicalFields })
assert.equal(historic.qualified, true)
assert.equal(historic.alert.eventTime, '2026-10-31 12:34:15')
assert.equal(historic.alert.personId, '')
assert.equal(historic.alert.verifiedImagePair, false)
assert.ok(!JSON.stringify(historic).includes('MUST_NOT_LEAK'))
console.log('PASS: synthetic historical SummaryNew fields mapped; ID remains blank')

console.log('HIGH_RISK_OFFLINE_TEST: PASS')
console.log('REAL_NVR_REQUEST_SENT: NO')
console.log('SERVER_UPLOAD: NO')
console.log('AGENT_MAIN_CHANGED: NO')
