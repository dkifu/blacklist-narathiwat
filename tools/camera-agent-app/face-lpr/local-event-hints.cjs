'use strict'

// Stage 22.3: deterministic LOCAL-ONLY grouping hints for historical candidates.
// These SHA-256 values are not server event IDs, not authenticators, and not
// authoritative dedupe keys. Same source/candidate/time may collide across
// distinct NVR detections; the server must validate and deduplicate independently.
// No I/O, NVR, HTTP, Electron, FFmpeg or Agent entrypoint dependency.

const { createHash } = require('node:crypto')
const { buildHistoricalAlertDraft } = require('./alert-draft.cjs')

const fail = reason => ({ prepared: false, reason, hints: null })
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = parts => createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')

function buildLocalEventHints({ config, nvrId, fields, index = 0 } = {}) {
  // Re-evaluate the source data; never accept caller-provided `qualified`,
  // `draft`, `serverEventId`, `selectedLprOption` or a forged target list.
  const generated = buildHistoricalAlertDraft({ config, nvrId, fields, index })
  if (!generated.drafted) return fail(generated.reason)
  const draft = generated.draft
  if (!isRecord(draft) || draft.schemaVersion !== 1 ||
      draft.state !== 'LOCAL_DRAFT_NOT_SENT' || draft.serverEventId !== null ||
      draft.delivery?.status !== 'NOT_CONFIGURED' ||
      draft.face?.source !== 'historical' ||
      draft.face?.personId !== '' ||
      draft.face?.identityConfirmed !== false ||
      draft.vehiclePersonAssociationConfirmed !== false ||
      draft.selectedLprOption !== null || !Array.isArray(draft.lprOptions)) {
    return fail('INVALID_UNSENT_DRAFT')
  }
  const face = draft.face
  const fingerprint = `local-face-v1:${digest([
    'face_lpr_local_candidate_v1', draft.centerId, face.nvrId,
    face.cameraId, face.channel, face.eventTimeLocal,
    face.personName, face.groupName, face.similarity,
  ])}`
  const slots = draft.lprOptions.map(slot => ({
    mappingId: slot.mappingId,
    nvrId: slot.nvrId,
    cameraId: slot.cameraId,
    sampleIndex: slot.sampleIndex,
    requestedTimeLocal: slot.requestedTimeLocal,
    captureStatus: slot.captureStatus,
    hint: `local-lpr-slot-v1:${digest([
      'face_lpr_local_slot_v1', fingerprint, slot.mappingId,
      slot.nvrId, slot.cameraId, slot.channel,
      slot.sampleIndex, slot.requestedTimeLocal,
    ])}`,
  }))
  if (new Set(slots.map(s => s.hint)).size !== slots.length) {
    return fail('AMBIGUOUS_SAMPLE_SLOTS')
  }
  return {
    prepared: true,
    reason: 'LOCAL_HINTS_ONLY_NOT_DELIVERABLE',
    hints: {
      status: 'LOCAL_ONLY_NOT_SENT',
      candidateHint: fingerprint,
      hintAuthority: 'UNTRUSTED_LOCAL_HEURISTIC',
      collisionWarning: 'DIFFERENT_DETECTIONS_CAN_HAVE_IDENTICAL_METADATA',
      timeBasis: face.timeBasis,
      serverEventId: null,
      serverDedupeRequired: true,
      sendAllowed: false,
      slotHints: slots,
    },
  }
}

module.exports = { buildLocalEventHints }
