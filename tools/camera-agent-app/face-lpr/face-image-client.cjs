'use strict'

// Stage 19: read-only, direct Dahua NVR JPEG downloader.
// No Electron/main.cjs imports, no automatic startup, no outbound server upload.
// Only same-host /IntelliStorage/mnt/ image paths from verified NVR records.

const http = require('node:http')
const net = require('node:net')
const { parseDigestChallenge, digestAuthorization } = require('./nvr-client.cjs')

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ROOT = '/IntelliStorage/mnt/'

function validPrivateIp(host, allowLoopback) {
  if (net.isIP(host) !== 4) return false
  const parts = host.split('.').map(Number)
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (allowLoopback && parts[0] === 127)
}

function encodeImagePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.startsWith(ROOT) || filePath.length > 1024) {
    throw new Error('NVR_IMAGE_PATH_NOT_ALLOWED')
  }
  if (/[\\%?#\x00-\x1f\x7f]/.test(filePath)) throw new Error('NVR_IMAGE_PATH_NOT_ALLOWED')
  const segments = filePath.split('/')
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('NVR_IMAGE_PATH_NOT_ALLOWED')
  }
  if (segments.slice(3).some(segment => !segment)) throw new Error('NVR_IMAGE_PATH_NOT_ALLOWED')
  if (!/\.jpe?g$/i.test(filePath)) throw new Error('NVR_IMAGE_PATH_NOT_ALLOWED')
  // Dahua IntelliStorage filenames may contain literal ':' before image size.
  // The NVR's image endpoint can return 404 for percent-encoded '%3A'.
  // Preserve literal colon while encoding all other segment characters.
  // Validation above still forbids redirects, query strings and traversal.
  return segments.map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':')).join('/')
}

function requestImageOnce({ host, port, path, timeoutMs, authorization, cookie }) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'image/jpeg, */*', Connection: 'close' }
    if (authorization) headers.Authorization = authorization
    if (cookie) headers.Cookie = cookie
    const req = http.request({ host, port, method: 'GET', path, agent: false, headers }, response => {
      const parts = []
      let count = 0
      response.on('data', part => {
        count += part.length
        if (count > MAX_IMAGE_BYTES) {
          req.destroy(new Error('NVR_IMAGE_TOO_LARGE'))
          return
        }
        parts.push(part)
      })
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(parts),
      }))
      response.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('NVR_IMAGE_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

function createFaceImageClient({ host, username, password, port = 80, timeoutMs = 15000, allowLoopback = false, cookieProvider = null }) {
  if (!validPrivateIp(host, allowLoopback)) throw new Error('NVR_PRIVATE_IPV4_REQUIRED')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('INVALID_TIMEOUT')
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw new Error('NVR_CREDENTIALS_REQUIRED')
  }
  if (cookieProvider !== null && typeof cookieProvider !== 'function') {
    throw new Error('INVALID_COOKIE_PROVIDER')
  }

  async function getJpeg(filePath, expectedBytes) {
    const resourcePath = encodeImagePath(filePath)
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 4 || expectedBytes > MAX_IMAGE_BYTES) {
      throw new Error('INVALID_EXPECTED_IMAGE_SIZE')
    }
    // Historical IntelliStorage image URLs require the SAME in-memory Cookie
    // jar established by the active Finder session. Never persist or log it.
    const cookie = cookieProvider ? cookieProvider() : null
    if (cookieProvider && (!cookie || typeof cookie !== 'string')) {
      throw new Error('NVR_IMAGE_SESSION_REQUIRED')
    }
    if (cookie && (cookie.length > 4096 || /[\r\n]/.test(cookie))) {
      throw new Error('NVR_IMAGE_INVALID_SESSION')
    }
    let received = await requestImageOnce({ host, port, path: resourcePath, timeoutMs, cookie })
    if (received.status === 401) {
      const challenge = parseDigestChallenge(received.headers['www-authenticate'])
      const authorization = digestAuthorization(challenge, 'GET', resourcePath, username, password)
      received = await requestImageOnce({ host, port, path: resourcePath, timeoutMs, authorization, cookie })
    }
    // Reject redirects and any non-200 response; never follow outside the NVR.
    if (received.status !== 200) throw new Error(`NVR_IMAGE_HTTP_${received.status}`)
    const mime = (received.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (mime !== 'image/jpeg' && mime !== 'image/jpg') throw new Error('NVR_IMAGE_INVALID_CONTENT_TYPE')
    const bytes = received.body
    if (bytes.length !== expectedBytes) throw new Error('NVR_IMAGE_SIZE_MISMATCH')
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) {
      throw new Error('NVR_IMAGE_INVALID_JPEG')
    }
    return bytes
  }

  return Object.freeze({ getJpeg })
}

module.exports = { createFaceImageClient, encodeImagePath, MAX_IMAGE_BYTES }
