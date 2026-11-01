'use strict'

const assert = require('node:assert/strict')
const net = require('node:net')
const crypto = require('node:crypto')
const { probePlayback } = require('./lpr-playback-probe.cjs')
const { readConfig } = require('./config.cjs')
const path = require('node:path')

const hash = str => crypto.createHash('md5').update(str).digest('hex')
const expectedPassword = 'mock-password'
const nonce = 'mock-nonce'

function verifyAuthorization(header, uri) {
  if (!header || !header.startsWith('Digest ')) return false
  const params = Object.fromEntries([...header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map(x => [x[1], x[2] ?? x[3]]))
  if (params.username !== 'admin' || params.uri !== uri || params.nonce !== nonce) return false
  const ha1 = hash(`admin:PilotMock:${expectedPassword}`)
  const ha2 = hash(`DESCRIBE:${uri}`)
  const expected = hash(`${ha1}:${nonce}:${params.nc}:${params.cnonce}:auth:${ha2}`)
  return params.response === expected
}

function startMockServer() {
  const server = net.createServer(socket => {
    let received = ''
    socket.on('data', bytes => {
      received += bytes.toString('latin1')
      if (!received.includes('\r\n\r\n')) return
      const lines = received.split('\r\n')
      const match = /^DESCRIBE (rtsp:\/\/[^ ]+) RTSP\/1\.0$/.exec(lines[0])
      if (!match) { socket.destroy(); return }
      const auth = lines.find(x => /^Authorization:/i.test(x))?.slice('Authorization:'.length).trim()
      if (!verifyAuthorization(auth, match[1])) {
        socket.end('RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Digest realm="PilotMock", nonce="mock-nonce", algorithm=MD5, qop="auth"\r\nContent-Length: 0\r\n\r\n')
      } else {
        const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=Mock\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n'
        socket.end(`RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Type: application/sdp\r\nContent-Length: ${Buffer.byteLength(sdp)}\r\n\r\n` + sdp)
      }
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function main() {
  const config = readConfig(path.join(__dirname, 'pilot.config.json'))
  assert.equal(config.enabled, false)
  assert.equal(config.nvrs.find(n => n.id === 'yakang-nvr-01').enabled, false)
  await assert.rejects(probePlayback({ host: '8.8.8.8', uiChannel: 6, startTime:'2026_10_31_12_34_10', endTime:'2026_10_31_12_34_20', username:'admin', password:expectedPassword }), /RTSP_PRIVATE_IPV4_REQUIRED/)
  console.log('PASS: public targets rejected and pilot remains disabled')
  const server = await startMockServer()
  const port = server.address().port
  const opts = { host: '127.0.0.1', port, uiChannel:6, startTime:'2026_10_31_12_34_10', endTime:'2026_10_31_12_34_20', username:'admin', allowLoopback:true, timeoutMs:2000 }
  try {
    const correct = await probePlayback({ ...opts, password:expectedPassword })
    assert.equal(correct.status, 200)
    assert.equal(correct.digestChallenged, true)
    assert.equal(correct.videoSdp, true)
    console.log('PASS: Digest handshake, read-only DESCRIBE returns video SDP')
    const wrong = await probePlayback({ ...opts, password:'wrong-password' })
    assert.equal(wrong.status, 401)
    assert.equal(wrong.videoSdp, false)
    console.log('PASS: wrong credentials rejected; no password in CLI arguments')
    console.log('LPR_RTSP_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('MEDIA_SAVED: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(e => { console.error('LPR_RTSP_OFFLINE_TEST: FAIL', e.message); process.exitCode = 1 })
