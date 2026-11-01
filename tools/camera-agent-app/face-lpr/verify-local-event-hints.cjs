'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { buildLocalEventHints } = require('./local-event-hints.cjs')

const original = readConfig(path.join(__dirname, 'pilot.config.json'))
const enabled = structuredClone(original)
enabled.enabled = true
enabled.nvrs[0].enabled = true
const record = {
  'items[0].Channel': '8',
  'items[0].StartTime': '2026-10-31 12:34:15',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.Name': 'SYNTHETIC PERSON',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.GroupName': 'High Risk Person',
  'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '91',
  'items[0].SummaryNew[0].Value.Object.Image.FilePath': '/IntelliStorage/mnt/SECRET-DETECTED.jpg',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.Image[0].FilePath': '/IntelliStorage/mnt/SECRET-REFERENCE.jpg',
}
const args = { config: enabled, nvrId: 'yakang-nvr-01', fields: record }
try {
  const disabled = buildLocalEventHints({ ...args, config: original })
  assert.equal(disabled.prepared, false)
  assert.equal(disabled.reason, 'MODULE_DISABLED')
  assert.equal(original.enabled, false)
  console.log('PASS: disabled pilot cannot create an event hint')

  const first = buildLocalEventHints(args)
  const again = buildLocalEventHints({ ...args, fields: structuredClone(record) })
  assert.equal(first.prepared, true)
  assert.deepEqual(first, again)
  const h = first.hints
  assert.match(h.candidateHint, /^local-face-v1:[a-f0-9]{64}$/)
  assert.equal(h.slotHints.length, 5)
  assert.equal(new Set(h.slotHints.map(s => s.hint)).size, 5)
  assert.ok(h.slotHints.every(s => /^local-lpr-slot-v1:[a-f0-9]{64}$/.test(s.hint)))
  assert.equal(h.slotHints[0].requestedTimeLocal, '2026-10-31 12:34:10.000')
  assert.equal(h.slotHints[4].requestedTimeLocal, '2026-10-31 12:34:14.000')
  console.log('PASS: deterministic per-candidate and five per-slot hints, without clock conversion')

  assert.equal(h.serverEventId, null)
  assert.equal(h.sendAllowed, false)
  assert.equal(h.serverDedupeRequired, true)
  assert.equal(h.hintAuthority, 'UNTRUSTED_LOCAL_HEURISTIC')
  assert.equal(h.timeBasis, 'NVR_LOCAL_WALL_CLOCK_UNVERIFIED_OFFSET')
  assert.ok(h.slotHints.every(s => s.captureStatus === 'NOT_CAPTURED'))
  const printed = JSON.stringify(h)
  for (const forbidden of [
    'SYNTHETIC PERSON', '172.17.2.23', 'IntelliStorage',
    'SECRET-DETECTED', 'SECRET-REFERENCE', 'password', 'privateKey',
    'image/jpeg', 'http://', 'rtsp://',
  ]) assert.equal(printed.includes(forbidden), false, forbidden)
  console.log('PASS: no name, NVR host, image paths, passwords, media, object IDs or false delivery claims in hints')

  const changed = buildLocalEventHints({ ...args,
    fields: { ...record, 'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '92' },
  })
  assert.equal(changed.prepared, true)
  assert.notEqual(first.hints.candidateHint, changed.hints.candidateHint)
  const wrongChannel = buildLocalEventHints({ ...args, fields: { ...record, 'items[0].Channel': '5' } })
  assert.equal(wrongChannel.prepared, false)
  const low = buildLocalEventHints({ ...args, fields: { ...record,
    'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '89' } })
  assert.equal(low.prepared, false)
  assert.equal(buildLocalEventHints({ ...args, fields: null }).prepared, false)
  console.log('PASS: mismatched camera, low risk and invalid input fail closed')

  const cross = structuredClone(enabled)
  cross.nvrs.push({ id: 'cross-nvr-2', host: '172.17.2.24', enabled: true,
    cameras: [{ id: 'another-lpr', channel: 1, type: 'lpr' }] })
  cross.mappings[0].lprCameraIds.push('another-lpr')
  const multi = buildLocalEventHints({ ...args, config: cross })
  assert.equal(multi.prepared, true)
  assert.equal(multi.hints.slotHints.length, 10)
  assert.equal(new Set(multi.hints.slotHints.map(x => x.hint)).size, 10)
  assert.ok(multi.hints.slotHints.filter(x => x.nvrId === 'cross-nvr-2')
    .every(x => x.captureStatus === 'BLOCKED_PENDING_REVIEW'))
  console.log('PASS: multiple NVRs supported; cross-NVR clock-review remains blocked')
  console.log('LOCAL_EVENT_HINTS_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
} catch (error) {
  console.error('LOCAL_EVENT_HINTS_OFFLINE_TEST: FAIL', error.message)
  process.exitCode = 1
}
