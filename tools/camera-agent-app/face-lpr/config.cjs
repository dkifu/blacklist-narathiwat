'use strict'

// Offline validation only. This module does NOT connect to an NVR or server.
// Actual Agent integration, capabilities, credentials and command dispatch
// must be designed and reviewed separately.

const fs = require('node:fs')

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function validateConfig(config) {
  const errors = []
  const problem = message => errors.push(message)

  if (!isObject(config)) return { valid: false, errors: ['config must be an object'] }
  if (config.schemaVersion !== 1) problem('schemaVersion must be 1')
  if (typeof config.enabled !== 'boolean') problem('enabled must be a boolean')
  if (typeof config.centerId !== 'string' || !config.centerId.trim()) {
    problem('centerId is required')
  }

  // No NVR credentials or API tokens in local JSON config.
  const forbidden = new Set([
    'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
    'privatekey', 'private_key', 'authorization'
  ])
  function checkSecrets(value, location) {
    if (Array.isArray(value)) {
      value.forEach((entry, i) => checkSecrets(entry, `${location}[${i}]`))
    } else if (isObject(value)) {
      for (const [key, val] of Object.entries(value)) {
        if (forbidden.has(key.toLowerCase())) problem(`${location}.${key}: credentials prohibited`)
        checkSecrets(val, `${location}.${key}`)
      }
    }
  }
  checkSecrets(config, 'config')

  if (!Array.isArray(config.nvrs)) problem('nvrs must be an array')
  if (!Array.isArray(config.mappings)) problem('mappings must be an array')

  const nvrIds = new Set()
  const cameras = new Map()
  for (const [i, nvr] of (Array.isArray(config.nvrs) ? config.nvrs : []).entries()) {
    const label = `nvrs[${i}]`
    if (!isObject(nvr)) { problem(`${label} must be an object`); continue }
    if (typeof nvr.id !== 'string' || !nvr.id.trim()) problem(`${label}.id required`)
    else if (nvrIds.has(nvr.id)) problem(`duplicate NVR id: ${nvr.id}`)
    else nvrIds.add(nvr.id)
    if (typeof nvr.host !== 'string' || !nvr.host.trim()) problem(`${label}.host required`)
    if (typeof nvr.enabled !== 'boolean') problem(`${label}.enabled must be boolean`)
    if (!Array.isArray(nvr.cameras)) { problem(`${label}.cameras must be an array`); continue }
    const channels = new Set()
    for (const [j, camera] of nvr.cameras.entries()) {
      const cLabel = `${label}.cameras[${j}]`
      if (!isObject(camera)) { problem(`${cLabel} must be an object`); continue }
      if (typeof camera.id !== 'string' || !camera.id.trim()) problem(`${cLabel}.id required`)
      else if (cameras.has(camera.id)) problem(`duplicate camera id: ${camera.id}`)
      else cameras.set(camera.id, { ...camera, nvrId: nvr.id })
      if (!Number.isSafeInteger(camera.channel) || camera.channel < 1) {
        problem(`${cLabel}.channel must be a positive integer (UI channel number)`)
      } else if (channels.has(camera.channel)) {
        problem(`${label}: duplicate channel ${camera.channel}`)
      } else channels.add(camera.channel)
      if (!['face', 'lpr'].includes(camera.type)) problem(`${cLabel}.type must be face or lpr`)
    }
  }

  const mappingIds = new Set()
  for (const [i, mapping] of (Array.isArray(config.mappings) ? config.mappings : []).entries()) {
    const label = `mappings[${i}]`
    if (!isObject(mapping)) { problem(`${label} must be an object`); continue }
    if (typeof mapping.id !== 'string' || !mapping.id.trim()) problem(`${label}.id required`)
    else if (mappingIds.has(mapping.id)) problem(`duplicate mapping id: ${mapping.id}`)
    else mappingIds.add(mapping.id)
    if (cameras.get(mapping.faceCameraId)?.type !== 'face') {
      problem(`${label}.faceCameraId must reference a face camera`)
    }
    if (!Array.isArray(mapping.lprCameraIds) || mapping.lprCameraIds.length === 0) {
      problem(`${label}.lprCameraIds must be a nonempty array`)
    } else {
      const uniqueLpr = new Set(mapping.lprCameraIds)
      if (uniqueLpr.size !== mapping.lprCameraIds.length) problem(`${label}: duplicate LPR references`)
      for (const id of mapping.lprCameraIds) {
        if (cameras.get(id)?.type !== 'lpr') problem(`${label}: unknown/non-LPR camera ${id}`)
      }
    }
    const capture = mapping.capture
    if (!isObject(capture)) { problem(`${label}.capture required`); continue }
    if (!Number.isInteger(capture.offsetSeconds) || Math.abs(capture.offsetSeconds) > 3600) {
      problem(`${label}.capture.offsetSeconds must be an integer within +/-3600`)
    }
    if (!Number.isInteger(capture.windowSeconds) || capture.windowSeconds < 1 || capture.windowSeconds > 60) {
      problem(`${label}.capture.windowSeconds must be 1..60`)
    }
    if (!Number.isInteger(capture.sampleCount) || capture.sampleCount < 1 || capture.sampleCount > 20) {
      problem(`${label}.capture.sampleCount must be 1..20`)
    }
  }

  return { valid: errors.length === 0, errors }
}

function readConfig(filePath) {
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const result = validateConfig(config)
  if (!result.valid) throw new Error('Invalid Face/LPR config:\n' + result.errors.join('\n'))
  return config
}

module.exports = { validateConfig, readConfig }
