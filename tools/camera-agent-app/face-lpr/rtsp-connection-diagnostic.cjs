'use strict'

// Manual, read-only RTSP DESCRIBE auth diagnostic. Sends only DESCRIBE;
// attempts exactly one authenticated retry on the SAME TCP connection.
// Does not save media or log credential/nonce/realm/URI.

const net = require('node:net')
const { parseDigestChallenge, digestAuthorization } = require('./nvr-client.cjs')

const MAX_BYTES = 128 * 1024
const TIME_RE = /^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$/

function privateIPv4(host, allowLoopback = false) {
  if (net.isIP(host) !== 4) return false
  const [a, b] = host.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (allowLoopback && a === 127)
}

function parseMessage(bytes) {
  const split = bytes.indexOf('\r\n\r\n')
  if (split < 0) return null
  const lines = bytes.subarray(0, split).toString('latin1').split('\r\n')
  const match = /^RTSP\/1\.0 (\d{3})(?:\s|$)/.exec(lines.shift() || '')
  if (!match) throw new Error('RTSP_INVALID_RESPONSE')
  const headers = Object.create(null)
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const key = line.slice(0, colon).toLowerCase().trim()
      if (!headers[key]) headers[key] = line.slice(colon + 1).trim()
    }
  }
  const status = Number(match[1])
  let length = 0
  if (headers['content-length'] !== undefined) {
    length = Number(headers['content-length'])
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BYTES) throw new Error('RTSP_INVALID_CONTENT_LENGTH')
  } else if (status === 200) {
    // Do not risk treating an incomplete SDP as a valid result.
    throw new Error('RTSP_SDP_CONTENT_LENGTH_MISSING')
  }
  const consumed = split + 4 + length
  if (bytes.length < consumed) return null
  return { status, headers, body: bytes.subarray(split + 4, consumed).toString('utf8'), consumed }
}

function probeSameConnection({ host, port = 554, uiChannel, startTime, endTime, username, password, timeoutMs = 10000, allowLoopback = false }) {
  if (!privateIPv4(host, allowLoopback)) throw new Error('RTSP_PRIVATE_IPV4_REQUIRED')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('RTSP_INVALID_PORT')
  if (!Number.isSafeInteger(uiChannel) || uiChannel < 1 || uiChannel > 1024) throw new Error('RTSP_INVALID_CHANNEL')
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime) || startTime >= endTime) throw new Error('RTSP_INVALID_WINDOW')
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password || /[\r\n]/.test(username + password)) throw new Error('RTSP_CREDENTIALS_REQUIRED')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('RTSP_INVALID_TIMEOUT')

  const uri = `rtsp://${host}:${port}/cam/playback?channel=${uiChannel}&starttime=${startTime}&endtime=${endTime}`
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    let bytes = Buffer.alloc(0)
    let state = 'first'
    let finished = false
    let result = {
      initialStatus: null, digestChallenged: false, authAttempted: false,
      sameConnection: false, connectionClosed: false,
      challengeAlgorithm: 'none', challengeQop: 'none',
      authStatus: null, staleOnRetry: false, videoSdp: false,
    }
    function finish(error) {
      if (finished) return
      finished = true
      socket.destroy()
      bytes = Buffer.alloc(0)
      if (error) reject(error)
      else resolve(Object.freeze({ ...result }))
    }
    function send(cseq, authorization) {
      const lines = [
        `DESCRIBE ${uri} RTSP/1.0`,
        `CSeq: ${cseq}`,
        'Accept: application/sdp',
        'User-Agent: NRW-FaceLpr-Pilot-ReadOnly',
      ]
      if (authorization) lines.push(`Authorization: ${authorization}`)
      socket.write(lines.join('\r\n') + '\r\n\r\n', 'latin1')
    }
    socket.setTimeout(timeoutMs, () => finish(new Error('RTSP_TIMEOUT')))
    socket.on('error', () => finish(new Error('RTSP_NETWORK_ERROR')))
    socket.on('connect', () => send(1, null))
    socket.on('end', () => {
      if (finished) return
      result.connectionClosed = true
      finish(null)
    })
    socket.on('data', chunk => {
      if (finished) return
      if (bytes.length + chunk.length > MAX_BYTES) { finish(new Error('RTSP_RESPONSE_TOO_LARGE')); return }
      bytes = Buffer.concat([bytes, chunk])
      while (!finished) {
        let parsed
        try { parsed = parseMessage(bytes) } catch (e) { finish(e); return }
        if (!parsed) return
        bytes = bytes.subarray(parsed.consumed)
        if (state === 'first') {
          result.initialStatus = parsed.status
          if (parsed.status !== 401) {
            result.authStatus = parsed.status
            result.videoSdp = parsed.status === 200 && /^v=0\s*$/m.test(parsed.body) && /^m=video\s/m.test(parsed.body)
            finish(null)
            return
          }
          const challenge = parsed.headers['www-authenticate'] || ''
          if (!/^Digest\s/i.test(challenge)) { finish(null); return }
          let digest, authorization
          try {
            digest = parseDigestChallenge(challenge)
            authorization = digestAuthorization(digest, 'DESCRIBE', uri, username, password)
          } catch (e) { finish(e); return }
          result.digestChallenged = true
          result.challengeAlgorithm = (digest.algorithm || 'MD5').toUpperCase()
          result.challengeQop = digest.qop ? (digest.qop.split(',').map(x => x.trim().toLowerCase()).includes('auth') ? 'auth' : 'unsupported') : 'none'
          if (/\bclose\b/i.test(parsed.headers.connection || '')) {
            result.connectionClosed = true
            finish(null)
            return
          }
          state = 'second'
          result.authAttempted = true
          result.sameConnection = true
          send(2, authorization)
        } else {
          result.authStatus = parsed.status
          result.videoSdp = parsed.status === 200 && /^v=0\s*$/m.test(parsed.body) && /^m=video\s/m.test(parsed.body)
          if (parsed.status === 401 && /^Digest\s/i.test(parsed.headers['www-authenticate'] || '')) {
            try { result.staleOnRetry = parseDigestChallenge(parsed.headers['www-authenticate']).stale === 'true' } catch {}
          }
          finish(null)
          return
        }
      }
    })
  })
}

module.exports = { probeSameConnection }
