'use strict'

// Offline-only signed Face/LPR event envelope builder.
// No network calls, no NVR operations, no storage access, and no Agent main changes.
// The private key remains inside Electron main's signing callback.
const { createHash } = require('node:crypto')

const CONTEXT = 'CCTV-AGENT-FACE-LPR-V1'
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const HEX64_RE = /^[0-9a-f]{64}$/
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const VERSION_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,32})?$/
const EXPECTED_KEYS = [
  'centerId', 'eventKind', 'eventTimeLocal', 'faceCameraId', 'nvrId',
  'schemaVersion', 'similarityScore', 'sourceEventKey',
  'vehiclePersonAssociationConfirmed',
].sort().join(',')

function requireValid(value, message) {
  if (!value) throw new Error(message)
}

function validLocalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return false
  const date = new Date(value.replace(' ', 'T') + 'Z')
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 19).replace('T', ' ') === value
}

function encodePayload(payload) {
  requireValid(payload && typeof payload === 'object' && !Array.isArray(payload), 'Invalid event payload')
  requireValid(Object.keys(payload).sort().join(',') === EXPECTED_KEYS, 'Unexpected event payload fields')
  requireValid(payload.schemaVersion === 1, 'Invalid schema version')
  requireValid(payload.eventKind === 'face_lpr_high_risk', 'Invalid event kind')
  requireValid(payload.vehiclePersonAssociationConfirmed === false, 'Vehicle/person association is unverified')
  requireValid(Number.isSafeInteger(payload.centerId) && payload.centerId > 0, 'Invalid center ID')
  requireValid(typeof payload.nvrId === 'string' && CODE_RE.test(payload.nvrId), 'Invalid NVR ID')
  requireValid(typeof payload.faceCameraId === 'string' && CODE_RE.test(payload.faceCameraId), 'Invalid camera ID')
  requireValid(typeof payload.sourceEventKey === 'string' && HEX64_RE.test(payload.sourceEventKey), 'Invalid source event key')
  requireValid(validLocalTime(payload.eventTimeLocal), 'Invalid event local time')
  requireValid(typeof payload.similarityScore === 'number' && Number.isFinite(payload.similarityScore) &&
    payload.similarityScore >= 90 && payload.similarityScore <= 100 &&
    Math.round(payload.similarityScore * 100) === payload.similarityScore * 100,
    'Invalid similarity score')

  // Same bytes are signed and sent; never stringify after signing.
  const data = Buffer.from(JSON.stringify(payload), 'utf8')
  requireValid(data.length <= 16 * 1024, 'Payload too large')
  return data
}

async function buildSignedFaceLprEnvelope({
  deviceId, agentVersion, challenge, payload, signBytes,
}) {
  requireValid(typeof deviceId === 'string' && UUID_RE.test(deviceId), 'Invalid device ID')
  requireValid(typeof agentVersion === 'string' && VERSION_RE.test(agentVersion), 'Invalid Agent version')
  requireValid(challenge && typeof challenge === 'object', 'Missing challenge')
  requireValid(challenge.deviceId === deviceId, 'Challenge Device ID mismatch')
  requireValid(typeof challenge.challengeId === 'string' && UUID_RE.test(challenge.challengeId), 'Invalid challenge ID')
  requireValid(typeof challenge.nonce === 'string' && HEX64_RE.test(challenge.nonce), 'Invalid challenge nonce')
  requireValid(challenge.protocol === CONTEXT, 'Challenge protocol mismatch')
  requireValid(challenge.eventSubmissionEnabled === true, 'Event ingestion disabled')
  requireValid(typeof challenge.expiresAt === 'string' && Number.isFinite(Date.parse(challenge.expiresAt)) &&
    Date.parse(challenge.expiresAt) > Date.now(), 'Challenge has expired')
  requireValid(typeof signBytes === 'function', 'Signing callback required')

  const payloadBytes = encodePayload(payload)
  const payloadHash = createHash('sha256').update(payloadBytes).digest('hex')
  const message = Buffer.from([
    CONTEXT,
    challenge.challengeId,
    deviceId,
    challenge.nonce,
    agentVersion,
    payloadHash,
  ].join('\n'), 'utf8')

  // Callback must sign inside trusted Electron main; never export or log private keys.
  const rawSignature = await signBytes(message)
  const signature = Buffer.from(rawSignature)
  requireValid(signature.length === 64, 'Invalid Ed25519 signature length')
  return Object.freeze({
    action: 'event',
    agentVersion,
    challengeId: challenge.challengeId,
    deviceId,
    nonce: challenge.nonce,
    payloadBase64: payloadBytes.toString('base64'),
    signatureBase64: signature.toString('base64'),
  })
}

module.exports = { buildSignedFaceLprEnvelope }
