'use strict'

// Stage 17: purely local, fail-closed High Risk evaluation.
// No NVR, server, network, disk, Electron, or Agent side effects.
// Caller supplies a *validated* configuration and a single source NVR ID.
// Qualified results are NOT permission to alert, transmit, or store biometric data.

const { validateConfig } = require('./config.cjs')

const DEFAULT_GROUP = 'High Risk Person'
const DEFAULT_THRESHOLD = 90
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const ignored = reason => ({ qualified: false, reason })

function findFaceCamera(config, nvrId, channel) {
  const nvr = config.nvrs.find(n => n.id === nvrId)
  if (!nvr) return { reason: 'NVR_NOT_CONFIGURED' }
  if (!nvr.enabled) return { reason: 'NVR_DISABLED' }
  const camera = nvr.cameras.find(c => c.channel === channel && c.type === 'face')
  if (!camera) return { reason: 'FACE_CAMERA_NOT_CONFIGURED' }
  return { nvr, camera }
}

function findLprTargets(config, faceCameraId) {
  const selectedIds = new Set()
  for (const mapping of config.mappings) {
    if (mapping.faceCameraId === faceCameraId) {
      for (const cameraId of mapping.lprCameraIds) selectedIds.add(cameraId)
    }
  }
  const targets = []
  for (const nvr of config.nvrs) {
    for (const camera of nvr.cameras) {
      if (camera.type === 'lpr' && selectedIds.has(camera.id)) {
        targets.push(Object.freeze({ nvrId: nvr.id, cameraId: camera.id, channel: camera.channel }))
      }
    }
  }
  return targets
}

function parseSimilarity(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) return null
  const score = Number(value)
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null
}

function selectCandidate(candidates, expectedGroup, threshold) {
  if (!Array.isArray(candidates)) return null
  const matches = []
  for (const candidate of candidates) {
    if (!isObject(candidate) || !isObject(candidate.Person)) continue
    const group = candidate.Person.GroupName
    const name = candidate.Person.Name
    const similarity = parseSimilarity(candidate.Similarity)
    if (typeof group !== 'string' || group.trim().toLocaleLowerCase() !== expectedGroup.toLocaleLowerCase()) continue
    if (typeof name !== 'string' || !name.trim()) continue
    if (similarity === null || similarity < threshold) continue
    matches.push({ personName: name.trim(), similarity, groupName: group.trim() })
  }
  matches.sort((a, b) => b.similarity - a.similarity)
  return matches[0] || null
}

function evaluateLiveFaceEvent({ config, nvrId, event, minSimilarity = DEFAULT_THRESHOLD, groupName = DEFAULT_GROUP }) {
  if (!validateConfig(config).valid) return ignored('INVALID_CONFIG')
  if (!config.enabled) return ignored('MODULE_DISABLED')
  if (typeof nvrId !== 'string' || !nvrId) return ignored('NVR_NOT_SPECIFIED')
  if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 100) return ignored('INVALID_THRESHOLD')
  if (typeof groupName !== 'string' || !groupName.trim()) return ignored('INVALID_GROUP')
  if (!isObject(event) || event.code !== 'FaceComparision' || event.action !== 'Pulse') return ignored('NOT_FACE_PULSE')
  if (!Number.isSafeInteger(event.channel) || event.channel < 1 || !isObject(event.data)) return ignored('INVALID_EVENT')
  const lookup = findFaceCamera(config, nvrId, event.channel)
  if (lookup.reason) return ignored(lookup.reason)

  // Live NVR payload may differ from historical search results.
  // Accept explicit candidate evidence only; never infer group from root Sim/Name.
  const candidates = Array.isArray(event.data.Candidates)
    ? event.data.Candidates
    : (isObject(event.data.Face) && Array.isArray(event.data.Face.Candidates)
        ? event.data.Face.Candidates : null)
  const candidate = selectCandidate(candidates, groupName.trim(), minSimilarity)
  if (!candidate) return ignored('NO_EXPLICIT_HIGH_RISK_CANDIDATE')

  const lprTargets = findLprTargets(config, lookup.camera.id)
  if (lprTargets.length === 0) return ignored('NO_LPR_MAPPING')

  return {
    qualified: true,
    reason: 'HIGH_RISK_CANDIDATE_MATCH',
    // A candidate match is NOT an identity confirmation or an outbound alert.
    alert: {
      source: 'live', centerId: config.centerId, nvrId,
      faceCameraId: lookup.camera.id, faceChannel: event.channel,
      personName: candidate.personName,
      personId: '', // Explicit product requirement: ID remains blank.
      groupName: candidate.groupName, similarity: candidate.similarity,
      lprTargets,
      eventTime: null, // Live event time must be verified separately.
      detectedImagePath: null, referenceImagePath: null,
      verifiedImagePair: false,
      eventKey: null, // Persisted dedupe is NOT implemented in this module.
    },
  }
}

function evaluateHistoricalFaceRecord({ config, nvrId, fields, index = 0, minSimilarity = DEFAULT_THRESHOLD, groupName = DEFAULT_GROUP }) {
  if (!isObject(fields) || !Number.isSafeInteger(index) || index < 0) return ignored('INVALID_HISTORICAL_RECORD')
  const base = `items[${index}].`
  const prefix = base + 'SummaryNew[0].Value.'
  const candidate = prefix + 'Candidates[0].'
  const channelIndex = Number(fields[base + 'Channel'])
  if (!Number.isSafeInteger(channelIndex) || channelIndex < 0) return ignored('INVALID_HISTORICAL_CHANNEL')
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(fields[base + 'StartTime'] || '')) return ignored('INVALID_HISTORICAL_TIME')
  const event = {
    code: 'FaceComparision', action: 'Pulse', channel: channelIndex + 1,
    data: { Candidates: [{
      Person: { Name: fields[candidate + 'Person.Name'], GroupName: fields[candidate + 'Person.GroupName'] },
      Similarity: fields[candidate + 'Similarity'],
    }] },
  }
  const result = evaluateLiveFaceEvent({ config, nvrId, event, minSimilarity, groupName })
  if (!result.qualified) return result

  const detectedImagePath = fields[prefix + 'Object.Image.FilePath'] || null
  const referenceImagePath = fields[candidate + 'Person.Image[0].FilePath'] || null
  return {
    ...result,
    alert: {
      ...result.alert,
      source: 'historical', eventTime: fields[base + 'StartTime'],
      detectedImagePath, referenceImagePath,
      // Paths alone are not proof of a successfully downloaded image pair.
      verifiedImagePair: false,
    },
  }
}

module.exports = { evaluateLiveFaceEvent, evaluateHistoricalFaceRecord }
