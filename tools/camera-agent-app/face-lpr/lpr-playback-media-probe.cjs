'use strict'

// Pilot-only bounded RTSP replay probe: DESCRIBE -> SETUP -> PLAY -> TEARDOWN.
// No media is saved, decoded, forwarded, or returned to the caller.
const net = require('node:net')
const { parseDigestChallenge, digestAuthorization } = require('./nvr-client.cjs')
const MAX_CONTROL_BYTES = 128 * 1024
const MAX_BUFFER_BYTES = 256 * 1024
const TIME_RE = /^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$/

function isPrivate(host, loopback) {
  if (net.isIP(host) !== 4) return false
  const [a,b] = host.split('.').map(Number)
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || (loopback && a === 127)
}

function readControl(buffer, needsSdp) {
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd === -1) return null
  if (headerEnd > MAX_CONTROL_BYTES) throw new Error('RTSP_HEADER_TOO_LARGE')
  const lines = buffer.subarray(0, headerEnd).toString('latin1').split('\r\n')
  const m = /^RTSP\/1\.0 (\d{3})(?:\s|$)/.exec(lines.shift() || '')
  if (!m) throw new Error('RTSP_BAD_STATUS')
  const headers = Object.create(null)
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase()
      if (!headers[key]) headers[key] = line.slice(colon+1).trim()
    }
  }
  let size = 0
  if (headers['content-length'] !== undefined) {
    size = Number(headers['content-length'])
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_CONTROL_BYTES) throw new Error('RTSP_BAD_CONTENT_LENGTH')
  } else if (needsSdp && Number(m[1]) === 200) throw new Error('RTSP_SDP_LENGTH_MISSING')
  const consumed = headerEnd + 4 + size
  if (buffer.length < consumed) return null
  return { status: Number(m[1]), headers, body: buffer.subarray(headerEnd + 4, consumed).toString('utf8'), consumed }
}

function videoTrack(sdp, headers, requestUri, host, port) {
  if (!/^v=0\s*$/m.test(sdp)) throw new Error('RTSP_SDP_INVALID')
  const video = sdp.split(/\r?\nm=video\s/)[1]
  if (!video) throw new Error('RTSP_VIDEO_TRACK_MISSING')
  const videoPart = video.split(/\r?\nm=/)[0]
  const track = /(?:^|\r?\n)a=control:([^\r\n]+)/.exec(videoPart)?.[1]?.trim()
  if (!track) throw new Error('RTSP_VIDEO_CONTROL_MISSING')
  if (track.length > 256 || /[\r\n\\#]/.test(track)) throw new Error('RTSP_VIDEO_CONTROL_INVALID')
  const rawBase = headers['content-base'] || headers['content-location'] || requestUri
  let base, url
  try {
    base = new URL(rawBase, requestUri)
    if (track === '*') url = base
    else if (/^rtsp:\/\//i.test(track)) url = new URL(track)
    else if (track.startsWith('/')) url = new URL(track, base)
    else if (headers['content-base'] || headers['content-location']) url = new URL(track, base.href.endsWith('/') ? base.href : base.href + '/')
    else url = new URL(requestUri + '/' + track)
  } catch { throw new Error('RTSP_VIDEO_CONTROL_INVALID') }
  for (const candidate of [base, url]) {
    if (candidate.protocol !== 'rtsp:' || candidate.hostname !== host || Number(candidate.port || '554') !== port || candidate.username || candidate.password || candidate.hash) {
      throw new Error('RTSP_TRACK_MUST_BE_SAME_HOST')
    }
  }
  const codec = /(?:^|\r?\n)a=rtpmap:\d+\s+([A-Za-z0-9_-]+)\//.exec(videoPart)?.[1]?.toUpperCase() || 'UNKNOWN'
  return { uri: url.href, codec: /^[A-Z0-9_-]{1,24}$/.test(codec) ? codec : 'UNKNOWN' }
}

function probePlaybackMedia({ host, port=554, uiChannel, startTime, endTime, username, password,
  timeoutMs=8000, captureMs=3000, maxRtpPackets=5, allowLoopback=false }) {
  if (!isPrivate(host, allowLoopback)) throw new Error('RTSP_PRIVATE_IPV4_REQUIRED')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RTSP_BAD_PORT')
  if (!Number.isInteger(uiChannel) || uiChannel < 1 || uiChannel > 1024) throw new Error('RTSP_BAD_CHANNEL')
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime) || startTime >= endTime) throw new Error('RTSP_BAD_WINDOW')
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password || /[\r\n]/.test(username + password)) throw new Error('RTSP_CREDENTIALS_REQUIRED')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000 || !Number.isInteger(captureMs) || captureMs < 500 || captureMs > 8000 || !Number.isInteger(maxRtpPackets) || maxRtpPackets < 1 || maxRtpPackets > 30) throw new Error('RTSP_BAD_LIMITS')
  const uri = `rtsp://${host}:${port}/cam/playback?channel=${uiChannel}&starttime=${startTime}&endtime=${endTime}`
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    let buffer = Buffer.alloc(0), state = 'first', done = false, challenge = null
    let session = '', mediaUri = '', captureTimer = null, timeoutTimer = null, teardownTimer = null
    const result = { describeStatus: null, setupStatus: null, playStatus: null,
      teardownStatus: null, sameTcpDigest: false, videoSdp: false, codec: 'UNKNOWN',
      rtpPackets: 0, rtpPayloadBytes: 0, teardownSent: false }
    function finish(error) {
      if (done) return
      done = true
      if (captureTimer) clearTimeout(captureTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (teardownTimer) clearTimeout(teardownTimer)
      socket.destroy()
      buffer.fill(0); buffer = Buffer.alloc(0)
      if (error) reject(error)
      else resolve(Object.freeze({ ...result }))
    }
    function send(method, requestUri, cseq, extra={}) {
      const lines = [ `${method} ${requestUri} RTSP/1.0`, `CSeq: ${cseq}`, 'User-Agent: NRW-Pilot-Playback-ReadOnly' ]
      if (method === 'DESCRIBE') lines.push('Accept: application/sdp')
      for (const [key,value] of Object.entries(extra)) lines.push(`${key}: ${value}`)
      if (challenge) lines.push(`Authorization: ${digestAuthorization(challenge, method, requestUri, username, password)}`)
      socket.write(lines.join('\r\n') + '\r\n\r\n', 'latin1')
    }
    function teardown() {
      if (done || state === 'teardown') return
      if (!session) { finish(null); return }
      state = 'teardown'
      result.teardownSent = true
      send('TEARDOWN', uri, 5, { Session: session })
      teardownTimer = setTimeout(() => finish(null), 1500)
    }
    function handleResponse(message) {
      if (state === 'first') {
        if (message.status !== 401) { result.describeStatus=message.status; finish(null); return }
        const hdr = message.headers['www-authenticate'] || ''
        if (!/^Digest\s/i.test(hdr)) { result.describeStatus=401; finish(null); return }
        try { challenge = parseDigestChallenge(hdr) } catch { finish(new Error('RTSP_DIGEST_CHALLENGE_INVALID')); return }
        if (/\bclose\b/i.test(message.headers.connection || '')) { result.describeStatus = 401; finish(null); return }
        state='describe'; result.sameTcpDigest = true; send('DESCRIBE', uri, 2)
      } else if (state === 'describe') {
        result.describeStatus=message.status
        if (message.status !== 200) { finish(null); return }
        let track
        try { track = videoTrack(message.body, message.headers, uri, host, port) } catch (e) { finish(e); return }
        result.videoSdp=true; result.codec=track.codec; mediaUri=track.uri
        state='setup'; send('SETUP', mediaUri, 3, { Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1' })
      } else if (state === 'setup') {
        result.setupStatus=message.status
        if (message.status !== 200) { finish(null); return }
        const transport=message.headers.transport || ''
        if (!/RTP\/AVP\/TCP/i.test(transport) || !/interleaved\s*=\s*0-1\b/i.test(transport)) { finish(new Error('RTSP_TCP_INTERLEAVED_NOT_ACCEPTED')); return }
        const rawSession=(message.headers.session || '').split(';')[0].trim()
        if (!rawSession || !/^[A-Za-z0-9_.-]{1,128}$/.test(rawSession)) { finish(new Error('RTSP_SESSION_INVALID')); return }
        session=rawSession
        state='play'; send('PLAY', uri, 4, { Session: session })
      } else if (state === 'play') {
        result.playStatus=message.status
        if (message.status !== 200) { teardown(); return }
        state='stream'
        captureTimer=setTimeout(teardown, captureMs)
      } else if (state === 'teardown') {
        result.teardownStatus=message.status
        finish(null)
      }
    }
    socket.on('connect', () => send('DESCRIBE', uri, 1))
    socket.on('error', () => finish(new Error('RTSP_SOCKET_ERROR')))
    socket.on('end', () => finish(null))
    timeoutTimer = setTimeout(() => {
      if (state === 'stream') teardown()
      else if (session) teardown()
      else finish(new Error('RTSP_PROBE_TIMEOUT'))
    }, timeoutMs)
    socket.on('data', chunk => {
      if (done) return
      if (buffer.length + chunk.length > MAX_BUFFER_BYTES) { finish(new Error('RTSP_RESPONSE_TOO_LARGE')); return }
      buffer = Buffer.concat([buffer, chunk])
      while (!done && buffer.length) {
        if (buffer[0] === 0x24) { // RTSP over TCP interleaved RTP/RTCP
          if (buffer.length < 4) return
          const channel = buffer[1], size=buffer.readUInt16BE(2)
          if (buffer.length < size + 4) return
          if (state === 'stream' && channel === 0 && size >= 12 && (buffer[4] & 0xc0) === 0x80) {
            const csrcCount = buffer[4] & 15
            const extension = (buffer[4] & 0x10) !== 0
            // Count only well-formed RTP headers; never decode or return media.
            let offset=12 + csrcCount * 4
            if (extension && size >= offset + 4) offset += 4 + buffer.readUInt16BE(4+offset+2)*4
            if (size > offset) {
              result.rtpPackets++
              result.rtpPayloadBytes += size-offset
              if (result.rtpPackets >= maxRtpPackets) {
                buffer = buffer.subarray(size+4)
                teardown()
                continue
              }
            }
          }
          buffer = buffer.subarray(size+4)
          continue
        }
        let msg
        try { msg = readControl(buffer, state === 'describe') } catch (e) { finish(e); return }
        if (!msg) return
        buffer = buffer.subarray(msg.consumed)
        handleResponse(msg)
      }
    })
  })
}

module.exports = { probePlaybackMedia, videoTrack }
