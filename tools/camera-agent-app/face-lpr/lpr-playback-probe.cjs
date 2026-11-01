'use strict'

// Read-only Dahua RTSP DESCRIBE probe. Does not SETUP/PLAY, decode or save media.
// The user's NVR password stays in this process memory; it is not placed in
// command-line arguments, URLs, files, logs or child processes.

const net = require('node:net')
const { parseDigestChallenge, digestAuthorization } = require('./nvr-client.cjs')

const MAX_RESPONSE = 128 * 1024
const TIME_RE = /^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$/

function isPrivateIPv4(host, allowLoopback = false) {
  if (net.isIP(host) !== 4) return false
  const a = host.split('.').map(Number)
  return a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168) || (allowLoopback && a[0] === 127)
}

function parseResponse(buffer) {
  const split = buffer.indexOf('\r\n\r\n')
  if (split < 0) return null
  const header = buffer.subarray(0, split).toString('latin1')
  const lines = header.split('\r\n')
  const match = /^RTSP\/1\.0 (\d{3})(?:\s|$)/.exec(lines.shift())
  if (!match) throw new Error('RTSP_INVALID_RESPONSE')
  const headers = Object.create(null)
  for (const line of lines) {
    const sep = line.indexOf(':')
    if (sep < 1) continue
    const key = line.slice(0, sep).toLowerCase().trim()
    const val = line.slice(sep + 1).trim()
    if (!headers[key]) headers[key] = val
  }
  const lengthHeader = headers['content-length']
  const length = lengthHeader === undefined ? null : Number(lengthHeader)
  if (length !== null && (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE)) {
    throw new Error('RTSP_INVALID_CONTENT_LENGTH')
  }
  return { status: Number(match[1]), headers, bodyStart: split + 4, contentLength: length }
}

function describeOnce({ host, port, uri, authorization, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    let chunks = []
    let total = 0
    let done = false
    const finish = (error, result) => {
      if (done) return
      done = true
      socket.destroy()
      chunks = []
      if (error) reject(error)
      else resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish(new Error('RTSP_TIMEOUT')))
    socket.on('error', () => finish(new Error('RTSP_NETWORK_ERROR')))
    socket.on('connect', () => {
      const lines = [
        `DESCRIBE ${uri} RTSP/1.0`,
        'CSeq: 1',
        'Accept: application/sdp',
        'User-Agent: NRW-FaceLpr-Pilot-ReadOnly',
      ]
      if (authorization) lines.push(`Authorization: ${authorization}`)
      socket.write(lines.join('\r\n') + '\r\n\r\n', 'latin1')
    })
    socket.on('data', chunk => {
      total += chunk.length
      if (total > MAX_RESPONSE) { finish(new Error('RTSP_RESPONSE_TOO_LARGE')); return }
      chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      let parsed
      try { parsed = parseResponse(bytes) } catch (e) { finish(e); return }
      if (!parsed) return
      const { status, headers, bodyStart, contentLength } = parsed
      // Errors need no SDP body. Avoid waiting on servers that keep the socket open.
      if (status !== 200) { finish(null, { status, headers, sdp: '' }); return }
      if (contentLength !== null && bytes.length - bodyStart >= contentLength) {
        finish(null, { status, headers, sdp: bytes.subarray(bodyStart, bodyStart + contentLength).toString('utf8') })
      }
    })
    socket.on('end', () => {
      if (done) return
      const bytes = Buffer.concat(chunks)
      let parsed
      try { parsed = parseResponse(bytes) } catch (e) { finish(e); return }
      if (!parsed) { finish(new Error('RTSP_INCOMPLETE_RESPONSE')); return }
      if (parsed.contentLength !== null && bytes.length - parsed.bodyStart < parsed.contentLength) {
        finish(new Error('RTSP_INCOMPLETE_SDP')); return
      }
      finish(null, { status: parsed.status, headers: parsed.headers, sdp: bytes.subarray(parsed.bodyStart).toString('utf8') })
    })
  })
}

async function probePlayback({ host, port = 554, uiChannel, startTime, endTime, username, password, timeoutMs = 10000, allowLoopback = false }) {
  if (!isPrivateIPv4(host, allowLoopback)) throw new Error('RTSP_PRIVATE_IPV4_REQUIRED')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('RTSP_INVALID_PORT')
  if (!Number.isSafeInteger(uiChannel) || uiChannel < 1 || uiChannel > 1024) throw new Error('RTSP_INVALID_CHANNEL')
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime) || startTime >= endTime) throw new Error('RTSP_INVALID_WINDOW')
  if (!username || !password || /[\r\n]/.test(username + password)) throw new Error('RTSP_CREDENTIALS_REQUIRED')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('RTSP_INVALID_TIMEOUT')

  const uri = `rtsp://${host}:${port}/cam/playback?channel=${uiChannel}&starttime=${startTime}&endtime=${endTime}`
  const first = await describeOnce({ host, port, uri, timeoutMs })
  let last = first
  if (first.status === 401) {
    const challenge = first.headers['www-authenticate']
    if (!challenge || !/^Digest\s/i.test(challenge)) throw new Error('RTSP_DIGEST_UNAVAILABLE')
    const digest = parseDigestChallenge(challenge)
    const authorization = digestAuthorization(digest, 'DESCRIBE', uri, username, password)
    last = await describeOnce({ host, port, uri, authorization, timeoutMs })
  }
  const videoSdp = last.status === 200 && /^v=0\s*$/m.test(last.sdp) && /^m=video\s/m.test(last.sdp)
  return Object.freeze({ status: last.status, digestChallenged: first.status === 401, videoSdp })
}

module.exports = { probePlayback }
