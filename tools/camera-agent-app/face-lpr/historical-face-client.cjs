'use strict'

// Stage 18: MANUAL READ-ONLY historical FaceRecognition lookup.
// Does not modify or import Electron main, heartbeat, updater, or persistent storage.
// Local to the NVR endpoint; no redirects, downloads, uploads, or credentials on disk.

const http = require('node:http')
const net = require('node:net')
const { parseDigestChallenge, digestAuthorization } = require('./nvr-client.cjs')
const { createFaceImageClient } = require('./face-image-client.cjs')

const ENDPOINT = '/cgi-bin/mediaFileFind.cgi'
const MAX_RESPONSE = 256 * 1024
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function isPrivateHost(host, allowLoopback) {
  if (net.isIP(host) !== 4) return false
  const a = host.split('.').map(Number)
  return a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168) || (allowLoopback && a[0] === 127)
}

function encodeQuery(params) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
}

function requestOnce({ host, port, path, timeoutMs, authorization, cookie }) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'text/plain, */*', Connection: 'close' }
    if (authorization) headers.Authorization = authorization
    if (cookie) headers.Cookie = cookie
    const req = http.request({ host, port, path, method: 'GET', headers, agent: false }, res => {
      const chunks = []
      let bytes = 0
      res.on('data', part => {
        bytes += part.length
        if (bytes > MAX_RESPONSE) {
          req.destroy(new Error('NVR_RESPONSE_TOO_LARGE'))
          return
        }
        chunks.push(part)
      })
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8').trim(),
      }))
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('NVR_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

// Tiny session cookie jar, restricted to the single configured NVR.
// No cookie values are printed, persisted, or forwarded to any other host.
function applyCookies(jar, headers) {
  const values = headers['set-cookie'] || []
  for (const entry of (Array.isArray(values) ? values : [values])) {
    const pair = String(entry).split(';', 1)[0]
    const equal = pair.indexOf('=')
    if (equal < 1) continue
    const key = pair.slice(0, equal).trim()
    const val = pair.slice(equal + 1).trim()
    if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(key) && !/[\r\n;]/.test(val)) {
      if (!val) jar.delete(key)
      else jar.set(key, val)
    }
  }
}

function parseFlatFields(body) {
  const fields = Object.create(null)
  for (const line of body.split(/\r?\n/)) {
    const equal = line.indexOf('=')
    if (equal > 0) fields[line.slice(0, equal).trim()] = line.slice(equal + 1).trim()
  }
  return fields
}

function createHistoricalClient({ host, username, password, port = 80, timeoutMs = 12000, allowLoopback = false }) {
  if (!isPrivateHost(host, allowLoopback)) throw new Error('NVR_PRIVATE_IPV4_REQUIRED')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('INVALID_TIMEOUT')
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw new Error('NVR_CREDENTIALS_REQUIRED')
  }

  let challenge = null
  const jar = new Map()
  const cookieHeader = () => Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ')
  let imageWindowOpen = false
  const imageClient = createFaceImageClient({
    host, username, password, port, timeoutMs, allowLoopback,
    cookieProvider: () => imageWindowOpen ? cookieHeader() : '',
  })

  async function call(params) {
    const path = ENDPOINT + '?' + encodeQuery(params)
    const auth = () => challenge && digestAuthorization(challenge, 'GET', path, username, password)
    let result = await requestOnce({ host, port, path, timeoutMs, authorization: auth(), cookie: cookieHeader() })
    applyCookies(jar, result.headers)
    if (result.status === 401) {
      challenge = parseDigestChallenge(result.headers['www-authenticate'])
      result = await requestOnce({ host, port, path, timeoutMs, authorization: auth(), cookie: cookieHeader() })
      applyCookies(jar, result.headers)
    }
    if (result.status !== 200) throw new Error(`NVR_HTTP_${result.status}`)
    if (result.body.startsWith('{')) {
      // Never echo raw NVR response or arbitrary sensitive data.
      throw new Error('NVR_SESSION_OR_API_REJECTED')
    }
    return result.body
  }

  async function search({ uiChannel, startTime, endTime, onStep = () => {}, onResult = null }) {
    if (!Number.isSafeInteger(uiChannel) || uiChannel < 1 || uiChannel > 1024) {
      throw new Error('INVALID_UI_CHANNEL')
    }
    if (!DATE_TIME.test(startTime) || !DATE_TIME.test(endTime) || startTime >= endTime) {
      throw new Error('INVALID_SEARCH_WINDOW')
    }
    if (onResult !== null && typeof onResult !== 'function') {
      throw new Error('INVALID_RESULT_HANDLER')
    }
    let object = null
    let cleanupOk = true
    try {
      const created = await call({ action: 'factory.create' })
      const match = /^result=(\d+)$/.exec(created)
      if (!match) throw new Error('NVR_CREATE_FAILED')
      object = match[1]
      onStep('CREATE')

      const searched = await call({
        action: 'findFile', object,
        'condition.Channel': uiChannel,
        'condition.Types[0]': 'jpg',
        'condition.Flags[0]': 'Event',
        'condition.Events[0]': 'FaceRecognition',
        'condition.DB.FaceRecognitionRecordFilter.RegType': 'RecSuccess',
        'condition.DB.FaceRecognitionRecordFilter.StartTime': startTime,
        'condition.DB.FaceRecognitionRecordFilter.EndTime': endTime,
      })
      if (searched !== 'OK') throw new Error('NVR_FIND_FILE_FAILED')
      onStep('SEARCH')
      const result = parseFlatFields(await call({ action: 'findNextFile', object, count: 10 }))
      if (!/^\d+$/.test(result.found || '')) throw new Error('NVR_NEXT_FILE_INVALID')
      const record = { found: Number(result.found), fields: result }
      if (!onResult) return record
      // The caller can inspect the result and download a verified JPEG BEFORE
      // the Finder closes. The session Cookie itself remains private here.
      imageWindowOpen = true
      const imageResult = await onResult({
        ...record,
        getJpeg: (filePath, expectedBytes) => {
          if (!imageWindowOpen) throw new Error('NVR_IMAGE_SESSION_CLOSED')
          return imageClient.getJpeg(filePath, expectedBytes)
        },
      })
      return { ...record, imageResult }
    } finally {
      imageWindowOpen = false
      if (object) {
        for (const action of ['close', 'destroy']) {
          try {
            const result = await call({ action, object })
            if (!/^(OK|true|result=true)$/i.test(result)) cleanupOk = false
          } catch {
            cleanupOk = false
          }
        }
      }
      onStep(cleanupOk ? 'CLEANUP_OK' : 'CLEANUP_UNCONFIRMED')
      jar.clear()
    }
  }
  return Object.freeze({ search })
}

module.exports = { createHistoricalClient, parseFlatFields }
