'use strict'

// Stage 21.1: deterministic, offline capture scheduling ONLY.
// No NVR requests, file access, uploads, identity assertion, or Agent integration.
// All clock strings are NVR-local *wall clock* values; no host timezone conversions.
const { validateConfig } = require('./config.cjs')

const ignored = reason => ({ planned: false, reason, plans: [] })
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function parseLocalClock(value) {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number)
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  return date.getTime()
}

function formatLocalClock(milliseconds, precision = false) {
  const value = new Date(milliseconds)
  if (!Number.isFinite(value.getTime())) throw new Error('INVALID_DATE')
  const two = n => String(n).padStart(2, '0')
  const valueStr = `${String(value.getUTCFullYear()).padStart(4, '0')}-${two(value.getUTCMonth() + 1)}-${two(value.getUTCDate())} ${two(value.getUTCHours())}:${two(value.getUTCMinutes())}:${two(value.getUTCSeconds())}`
  return precision ? `${valueStr}.${String(value.getUTCMilliseconds()).padStart(3, '0')}` : valueStr
}

function buildLprCapturePlans({ config, assessment } = {}) {
  if (!validateConfig(config).valid) return ignored('INVALID_CONFIG')
  if (!config.enabled) return ignored('MODULE_DISABLED')
  if (!isObject(assessment) || assessment.qualified !== true || assessment.reason !== 'HIGH_RISK_CANDIDATE_MATCH' || !isObject(assessment.alert)) return ignored('NOT_QUALIFIED_HIGH_RISK')
  const alert = assessment.alert
  if (alert.centerId !== config.centerId || !['historical', 'live'].includes(alert.source) ||
      typeof alert.nvrId !== 'string' || typeof alert.faceCameraId !== 'string' ||
      !Number.isSafeInteger(alert.faceChannel)) return ignored('INVALID_FACE_CONTEXT')
  if (alert.personId !== '' || typeof alert.groupName !== 'string' || alert.groupName.trim().toLocaleLowerCase() !== 'high risk person' ||
      typeof alert.similarity !== 'number' || !Number.isFinite(alert.similarity) || alert.similarity < 90 || alert.similarity > 100) return ignored('UNTRUSTED_HIGH_RISK_CONTEXT')

  const source = config.nvrs.find(n => n.id === alert.nvrId)
  if (!source || !source.enabled) return ignored('SOURCE_NVR_NOT_ENABLED')
  const face = source.cameras.find(c => c.id === alert.faceCameraId && c.type === 'face' && c.channel === alert.faceChannel)
  if (!face) return ignored('FACE_CAMERA_MISMATCH')

  const time = parseLocalClock(alert.eventTime)
  if (time === null) return ignored('EVENT_TIME_NOT_VERIFIED')

  // Do not trust a target list supplied from outside the config/high-risk evaluator.
  const expectedTargets = new Map()
  for (const mapping of config.mappings.filter(m => m.faceCameraId === face.id)) {
    for (const id of mapping.lprCameraIds) {
      const nvr = config.nvrs.find(entry => entry.cameras.some(c => c.id === id))
      const camera = nvr?.cameras.find(c => c.id === id)
      if (nvr && camera && camera.type === 'lpr') expectedTargets.set(camera.id, `${nvr.id}|${camera.channel}`)
    }
  }
  if (!expectedTargets.size) return ignored('NO_LPR_MAPPING')
  if (!Array.isArray(alert.lprTargets) || alert.lprTargets.length !== expectedTargets.size) return ignored('TARGET_LIST_MISMATCH')
  const observed = new Set()
  for (const target of alert.lprTargets) {
    if (!isObject(target) || observed.has(target.cameraId) || expectedTargets.get(target.cameraId) !== `${target.nvrId}|${target.channel}`) return ignored('TARGET_LIST_MISMATCH')
    observed.add(target.cameraId)
  }

  const plans = []
  for (const mapping of config.mappings) {
    if (mapping.faceCameraId !== face.id) continue
    const { offsetSeconds, windowSeconds, sampleCount } = mapping.capture
    const start = time + offsetSeconds * 1000
    const end = start + windowSeconds * 1000
    if (!Number.isFinite(start) || !Number.isFinite(end)) return ignored('INVALID_CAPTURE_TIME')
    // Half-open time window [start, end): 5 samples over 5s = seconds 0,1,2,3,4.
    const samples = Array.from({ length: sampleCount }, (_, index) => formatLocalClock(start + Math.round((index * windowSeconds * 1000) / sampleCount), true))
    for (const cameraId of mapping.lprCameraIds) {
      const targetNvr = config.nvrs.find(n => n.cameras.some(c => c.id === cameraId))
      const targetCamera = targetNvr?.cameras.find(c => c.id === cameraId)
      if (!targetNvr || !targetCamera) return ignored('INVALID_CONFIG')
      const crossNvr = targetNvr.id !== source.id
      const status = !targetNvr.enabled ? 'TARGET_NVR_DISABLED' : crossNvr ? 'CROSS_NVR_CLOCK_SYNC_REQUIRED' : 'READY_FOR_MANUAL_CAPTURE_TEST'
      plans.push({
        mappingId: mapping.id,
        faceCameraId: face.id,
        target: { nvrId: targetNvr.id, cameraId: targetCamera.id, channel: targetCamera.channel },
        eventTimeLocal: alert.eventTime,
        startTimeLocal: formatLocalClock(start),
        endTimeLocalExclusive: formatLocalClock(end),
        sampleTimesLocal: [...samples],
        timeBasis: 'UNVERIFIED_NVR_WALL_CLOCK',
        association: 'TIME_CONTEXT_ONLY',
        requiresClockSyncReview: crossNvr,
        status,
      })
    }
  }
  return { planned: true, reason: 'CAPTURE_PLANS_PREPARED_OFFLINE', plans }
}

module.exports = { buildLprCapturePlans, parseLocalClock, formatLocalClock }
