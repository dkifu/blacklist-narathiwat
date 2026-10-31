'use strict'

// Dahua NVR read-only HTTP Digest client.
// No dependency on Electron, Ping, Heartbeat, Auto Updater or the main process.
// Credentials are supplied in memory by the caller, never read from JSON files.
// This phase intentionally exposes only two read-only CGI endpoints.

const http = require('node:http')
const crypto = require('node:crypto')
const net = require('node:net')

const MAX_RESPONSE_BYTES = 262144
const ALLOWED_ENDPOINTS = new Set([
  '/cgi-bin/eventManager.cgi?action=getCaps',
  '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle',
])

function isPrivateIPv4(address, allowLoopback = false) {
  if (net.isIP(address) !== 4) return false
  const n = address.split('.').map(Number)
  return n[0] === 10 ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) ||
    (allowLoopback && n[0] === 127)
}

function parseDigestChallenge(header) {
  if (typeof header !== 'string' || !/^Digest\s+/i.test(header)) {
    throw new Error('DIGEST_CHALLENGE_MISSING')
  }
  const text = header.replace(/^Digest\s+/i, '')
  const attributes = Object.create(null)
  const attr = /(?:^|,)\s*([A-Za-z][\w-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/g
  let match
  while ((match = attr.exec(text))) {
    const value = match[2] === undefined ? match[3] : match[2].replace(/\\(["\\])/g, '$1')
    attributes[match[1].toLowerCase()] = value
  }
  if (!attributes.realm || !attributes.nonce) {
    throw new Error('DIGEST_CHALLENGE_INVALID')
  }
  return attributes
}

function escapeHeaderValue(value) {
  if (/[\r\n]/.test(value)) throw new Error('INVALID_CREDENTIAL_CHARACTERS')
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function digestAuthorization(challenge, method, uri, username, password) {
  const algorithm = (challenge.algorithm || 'MD5').toUpperCase()
  const supported = {
    'MD5': 'md5',
    'MD5-SESS': 'md5',
    'SHA-256': 'sha256',
    'SHA-256-SESS': 'sha256',
  }
  const hashName = supported[algorithm]
  if (!hashName) throw new Error('DIGEST_ALGORITHM_UNSUPPORTED')

  const qopOptions = (challenge.qop || '').split(',').map(s => s.trim().toLowerCase())
  const qop = challenge.qop ? (qopOptions.includes('auth') ? 'auth' : null) : null
  if (challenge.qop && !qop) throw new Error('DIGEST_QOP_UNSUPPORTED')

  const hash = text => crypto.createHash(hashName).update(text, 'utf8').digest('hex')
  const cnonce = crypto.randomBytes(16).toString('hex')
  const nc = '00000001'
  let ha1 = hash(`${username}:${challenge.realm}:${password}`)
  if (algorithm.endsWith('-SESS')) {
    ha1 = hash(`${ha1}:${challenge.nonce}:${cnonce}`)
  }
  const ha2 = hash(`${method}:${uri}`)
  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`)

  const parts = [
    `username="${escapeHeaderValue(username)}"`,
    `realm="${escapeHeaderValue(challenge.realm)}"`,
    `nonce="${escapeHeaderValue(challenge.nonce)}"`,
    `uri="${escapeHeaderValue(uri)}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ]
  if (challenge.opaque !== undefined) parts.push(`opaque="${escapeHeaderValue(challenge.opaque)}"`)
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  return 'Digest ' + parts.join(', ')
}

function requestOnce(host, port, path, timeoutMs, authorization) {
  return new Promise((resolve, reject) => {
    const headers = { 'Accept': 'text/plain, */*', 'Connection': 'close' }
    if (authorization) headers.Authorization = authorization
    const req = http.request({
      host, port, method: 'GET', path, headers,
      agent: false, timeout: timeoutMs,
    }, res => {
      const chunks = []
      let size = 0
      res.on('data', chunk => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('NVR_RESPONSE_TOO_LARGE'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('NVR_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

function createNvrClient({ host, username, password, port = 80, timeoutMs = 10000, allowLoopback = false }) {
  if (!isPrivateIPv4(host, allowLoopback)) throw new Error('NVR_PRIVATE_IPV4_REQUIRED')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error('INVALID_TIMEOUT')
  }
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw new Error('NVR_CREDENTIALS_REQUIRED')
  }

  async function getText(path) {
    if (!ALLOWED_ENDPOINTS.has(path)) throw new Error('NVR_ENDPOINT_NOT_ALLOWED')
    const first = await requestOnce(host, port, path, timeoutMs, null)
    let result = first
    if (first.status === 401) {
      const challenge = parseDigestChallenge(first.headers['www-authenticate'])
      const authorization = digestAuthorization(challenge, 'GET', path, username, password)
      result = await requestOnce(host, port, path, timeoutMs, authorization)
    }
    // Do not follow redirects; never leak credentials to another host.
    if (result.status !== 200) throw new Error(`NVR_HTTP_${result.status}`)
    return result.body.toString('utf8')
  }

  return Object.freeze({
    getCaps: () => getText('/cgi-bin/eventManager.cgi?action=getCaps'),
    getChannelTitles: () => getText('/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle'),
  })
}

function parseChannelTitles(text) {
  const titles = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^table\.ChannelTitle\[(\d+)\]\.Name=(.*)$/)
    if (match) titles.set(Number(match[1]) + 1, match[2])
  }
  return titles
}

module.exports = { createNvrClient, parseChannelTitles, parseDigestChallenge, digestAuthorization }
