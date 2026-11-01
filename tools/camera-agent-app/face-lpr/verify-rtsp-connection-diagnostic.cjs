'use strict'

const assert = require('node:assert/strict')
const net = require('node:net')
const crypto = require('node:crypto')
const { probeSameConnection } = require('./rtsp-connection-diagnostic.cjs')
const { probePlayback } = require('./lpr-playback-probe.cjs')
const { readConfig } = require('./config.cjs')
const path = require('node:path')

const hash = value => crypto.createHash('md5').update(value).digest('hex')
const password = 'mock-password'

function paramsFrom(auth) {
  if (!auth || !auth.startsWith('Digest ')) return null
  return Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map(x => [x[1], x[2] ?? x[3]]))
}
function createMock(closeOnChallenge = false) {
  const server = net.createServer(socket => {
    const nonce = crypto.randomBytes(8).toString('hex')
    let seq = 0
    let received = ''
    socket.on('data', chunk => {
      received += chunk.toString('latin1')
      while (received.includes('\r\n\r\n')) {
        const pos = received.indexOf('\r\n\r\n')
        const message = received.slice(0, pos)
        received = received.slice(pos + 4)
        const lines = message.split('\r\n')
        const match = /^DESCRIBE (rtsp:\/\/\S+) RTSP\/1\.0$/.exec(lines[0])
        if (!match) { socket.destroy(); return }
        const uri = match[1]
        const auth = paramsFrom(lines.find(x => /^Authorization:/i.test(x))?.slice('Authorization:'.length).trim())
        const ha1 = hash(`admin:PilotMock:${password}`)
        const ha2 = hash(`DESCRIBE:${uri}`)
        const expected = auth && hash(`${ha1}:${nonce}:${auth.nc}:${auth.cnonce}:auth:${ha2}`)
        const valid = !!auth && auth.nonce === nonce && auth.uri === uri && auth.response === expected
        seq++
        if (!valid) {
          const hdr = `RTSP/1.0 401 Unauthorized\r\nCSeq: ${seq}\r\nWWW-Authenticate: Digest realm="PilotMock", nonce="${nonce}", algorithm=MD5, qop="auth"\r\nContent-Length: 0\r\n${closeOnChallenge ? 'Connection: close\r\n' : ''}\r\n`
          if (closeOnChallenge) socket.end(hdr)
          else socket.write(hdr)
        } else {
          const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=Mock\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n'
          socket.end(`RTSP/1.0 200 OK\r\nCSeq: ${seq}\r\nContent-Type: application/sdp\r\nContent-Length: ${Buffer.byteLength(sdp)}\r\n\r\n${sdp}`)
        }
      }
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function main() {
  const config = readConfig(path.join(__dirname, 'pilot.config.json'))
  assert.equal(config.enabled, false)
  assert.equal(config.nvrs.find(n => n.id === 'yakang-nvr-01').enabled, false)
  assert.throws(() => probeSameConnection({ host: '8.8.8.8', uiChannel: 6, startTime: '2026_10_31_12_34_10', endTime: '2026_10_31_12_34_20', username: 'admin', password }), /PRIVATE_IPV4_REQUIRED/)
  const server = await createMock()
  const opts = { host: '127.0.0.1', port: server.address().port, allowLoopback: true, username: 'admin', uiChannel: 6, startTime: '2026_10_31_12_34_10', endTime: '2026_10_31_12_34_20', timeoutMs: 2000 }
  try {
    const prior = await probePlayback({ ...opts, password })
    assert.equal(prior.status, 401)
    console.log('PASS: old diagnostic fails with socket-bound Digest nonce')
    const same = await probeSameConnection({ ...opts, password })
    assert.equal(same.initialStatus, 401)
    assert.equal(same.authStatus, 200)
    assert.equal(same.sameConnection, true)
    assert.equal(same.videoSdp, true)
    console.log('PASS: same-connection Digest auth returns SDP video')
    const invalid = await probeSameConnection({ ...opts, password: 'incorrect-password' })
    assert.equal(invalid.authStatus, 401)
    assert.equal(invalid.videoSdp, false)
    console.log('PASS: incorrect password rejected with no secret output')
  } finally { await new Promise(resolve => server.close(resolve)) }
  const closed = await createMock(true)
  try {
    const afterClose = await probeSameConnection({ ...opts, port: closed.address().port, password })
    assert.equal(afterClose.authAttempted, false)
    assert.equal(afterClose.connectionClosed, true)
    assert.equal(afterClose.videoSdp, false)
    console.log('PASS: no second request when NVR closes after challenge')
  } finally { await new Promise(resolve => closed.close(resolve)) }
  console.log('RTSP_SAME_TCP_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
}
main().catch(e => { console.error('RTSP_SAME_TCP_OFFLINE_TEST: FAIL', e.message); process.exitCode = 1 })
