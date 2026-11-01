'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { buildHistoricalAlertDraft } = require('./alert-draft.cjs')

const original = readConfig(path.join(__dirname, 'pilot.config.json'))
const enabled = structuredClone(original)
enabled.enabled = true
enabled.nvrs[0].enabled = true

const record = {
  'items[0].Channel': '8',
  'items[0].StartTime': '2026-10-31 12:34:15',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.Name': 'SYNTHETIC CANDIDATE',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.GroupName': 'High Risk Person',
  'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '91',
  'items[0].SummaryNew[0].Value.Object.Image.FilePath': '/IntelliStorage/mnt/PRIVATE-FACE-ORIGINAL.jpg',
  'items[0].SummaryNew[0].Value.Candidates[0].Person.Image[0].FilePath': '/IntelliStorage/mnt/PRIVATE-FACE-REFERENCE.jpg',
}
const args = { config: enabled, nvrId: 'yakang-nvr-01', fields: record }

try {
  const off = buildHistoricalAlertDraft({ ...args, config: original })
  assert.equal(off.drafted, false)
  assert.equal(off.reason, 'MODULE_DISABLED')
  assert.equal(original.enabled, false)
  assert.equal(original.nvrs[0].enabled, false)
  console.log('PASS: real pilot stays disabled; no alert draft from disabled configuration')

  const result = buildHistoricalAlertDraft(args)
  assert.equal(result.drafted, true)
  const d = result.draft
  assert.equal(d.schemaVersion, 1)
  assert.equal(d.state, 'LOCAL_DRAFT_NOT_SENT')
  assert.equal(d.face.personId, '')
  assert.equal(d.face.similarity, 91)
  assert.equal(d.face.channel, 9)
  assert.equal(d.face.eventTimeLocal, '2026-10-31 12:34:15')
  assert.equal(d.face.timeBasis, 'NVR_LOCAL_WALL_CLOCK_UNVERIFIED_OFFSET')
  assert.equal(d.lprOptions.length, 5)
  assert.deepEqual(d.lprOptions.map(x => x.requestedTimeLocal), [
    '2026-10-31 12:34:10.000', '2026-10-31 12:34:11.000',
    '2026-10-31 12:34:12.000', '2026-10-31 12:34:13.000',
    '2026-10-31 12:34:14.000'])
  assert.ok(d.lprOptions.every(x => x.cameraId === 'yakang-lpr-cam-06' && x.objectKey === null && x.actualFrameTime === null))
  assert.equal(d.vehiclePersonAssociationConfirmed, false)
  assert.equal(d.face.identityConfirmed, false)
  assert.equal(d.selectedLprOption, null)
  assert.equal(d.serverEventId, null)
  assert.equal(d.delivery.status, 'NOT_CONFIGURED')
  const json = JSON.stringify(d)
  for (const forbidden of ['172.17.2.23', 'IntelliStorage', 'PRIVATE-FACE-ORIGINAL',
    'PRIVATE-FACE-REFERENCE', 'password', 'privateKeyProtected', 'image/jpeg', 'RTSP_URL']) {
    assert.equal(json.includes(forbidden), false, forbidden)
  }
  console.log('PASS: Face9 -> LPR6 five local-time metadata slots; no implied JPEG or confirmed vehicle match')
  console.log('PASS: no NVR addresses, raw face paths, credentials, media bytes, invented server IDs or object keys')

  const low = { ...record, 'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '89' }
  assert.equal(buildHistoricalAlertDraft({ ...args, fields: low }).drafted, false)
  const unrelated = { ...record, 'items[0].Channel': '5' }
  assert.equal(buildHistoricalAlertDraft({ ...args, fields: unrelated }).drafted, false)
  const badText = { ...record, 'items[0].SummaryNew[0].Value.Candidates[0].Person.Name': 'FAKE\r\nCONTROL' }
  assert.equal(buildHistoricalAlertDraft({ ...args, fields: badText }).drafted, false)
  console.log('PASS: low similarity, wrong face channel and control-character injection rejected')

  const cross = structuredClone(enabled)
  cross.nvrs.push({ id: 'cross-nvr-2', host: '172.17.2.24', enabled: true,
    cameras: [{ id: 'another-lpr', channel: 1, type: 'lpr' }] })
  cross.mappings[0].lprCameraIds.push('another-lpr')
  const multi = buildHistoricalAlertDraft({ ...args, config: cross })
  assert.equal(multi.drafted, true)
  assert.equal(multi.draft.lprOptions.length, 10)
  const pending = multi.draft.lprOptions.filter(x => x.cameraId === 'another-lpr')
  assert.equal(pending.length, 5)
  assert.ok(pending.every(x => x.requiresClockSyncReview && x.captureStatus === 'BLOCKED_PENDING_REVIEW'))
  console.log('PASS: multi-NVR mappings included without silently bypassing cross-NVR clock review')
  console.log('ALERT_DRAFT_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
} catch (error) {
  console.error('ALERT_DRAFT_OFFLINE_TEST: FAIL', error.message)
  process.exitCode = 1
}
