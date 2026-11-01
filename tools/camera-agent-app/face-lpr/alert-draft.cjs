'use strict'

// Stage 22.2: strict, metadata-only local draft, NOT a network payload.
// Does not call NVR, Electron, Heartbeat, Server, FFmpeg or file I/O.
// Does not attach face or LPR images, image paths, credentials or IP addresses.
// Never asserts a vehicle/person association or a verified identity.

const { evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')
const { buildLprCapturePlans } = require('./lpr-capture-plan.cjs')

const reject = reason => ({ drafted: false, reason, draft: null })
const safeText = (value, max) => typeof value === 'string' &&
  value.trim().length > 0 && value.trim().length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(value)

function buildHistoricalAlertDraft({ config, nvrId, fields, index = 0 } = {}) {
  // The authoritative assessment is built internally, rather than accepting
  // an externally supplied `qualified: true` or a forged mapping list.
  const assessed = evaluateHistoricalFaceRecord({ config, nvrId, fields, index })
  if (!assessed.qualified) return reject(assessed.reason)
  const planned = buildLprCapturePlans({ config, assessment: assessed })
  if (!planned.planned) return reject(planned.reason)
  if (!planned.plans.length) return reject('NO_LPR_CAPTURE_PLANS')

  const alert = assessed.alert
  if (!safeText(alert.personName, 160) || !safeText(alert.groupName, 80)) {
    return reject('INVALID_CANDIDATE_DISPLAY_TEXT')
  }
  if (alert.personId !== '' || !Number.isFinite(alert.similarity)) {
    return reject('INVALID_FACE_ASSESSMENT')
  }

  const lprOptions = []
  for (const plan of planned.plans) {
    for (let index = 0; index < plan.sampleTimesLocal.length; index++) {
      lprOptions.push({
        mappingId: plan.mappingId,
        nvrId: plan.target.nvrId,
        cameraId: plan.target.cameraId,
        channel: plan.target.channel,
        sampleIndex: index,
        requestedTimeLocal: plan.sampleTimesLocal[index],
        actualFrameTime: null,
        objectKey: null,
        captureStatus: plan.status === 'READY_FOR_MANUAL_CAPTURE_TEST'
          ? 'NOT_CAPTURED'
          : 'BLOCKED_PENDING_REVIEW',
        requiresClockSyncReview: plan.requiresClockSyncReview,
      })
    }
  }
  if (!lprOptions.length) return reject('NO_LPR_CAPTURE_PLANS')

  // An event ID, dedupe guarantee, authorization, image object keys and
  // dispatch result can only be supplied after real server-side validation.
  // This document is deliberately NOT sendable as a production event.
  const draft = {
    schemaVersion: 1,
    type: 'face_lpr_review_candidate',
    state: 'LOCAL_DRAFT_NOT_SENT',
    serverEventId: null,
    centerId: alert.centerId,
    face: {
      source: 'historical',
      nvrId: alert.nvrId,
      cameraId: alert.faceCameraId,
      channel: alert.faceChannel,
      eventTimeLocal: alert.eventTime,
      timeBasis: 'NVR_LOCAL_WALL_CLOCK_UNVERIFIED_OFFSET',
      personName: alert.personName,
      personId: '',
      groupName: alert.groupName,
      similarity: alert.similarity,
      identityConfirmed: false,
      detectedImage: { objectKey: null, status: 'NOT_ATTACHED' },
      referenceImage: { objectKey: null, status: 'NOT_ATTACHED' },
    },
    lprOptions,
    selectedLprOption: null,
    vehiclePersonAssociationConfirmed: false,
    delivery: { status: 'NOT_CONFIGURED', deduplication: 'NOT_IMPLEMENTED' },
  }
  return { drafted: true, reason: 'LOCAL_METADATA_DRAFT_PREPARED', draft }
}

module.exports = { buildHistoricalAlertDraft }
