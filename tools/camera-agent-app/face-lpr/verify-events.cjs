'use strict'

// Deterministic offline tests. Local mock server only; no personal data.
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const { FaceEventParser } = require('./face-event-parser.cjs')
const { receiveFaceEvents } = require('./face-event-stream.cjs')
const { parseDigestChallenge } = require('./nvr-client.cjs')

const realm = 'Dahua_Test'
const nonce = 'testnonce'
const password = 'TEST_ONLY_PASSWORD'
const hash = t => crypto.createHash('md5').update(t).digest('hex')
const EVENT_PATH = '/cgi-bin/eventManager.cgi?action=attach&codes=%5BFaceComparision%5D&heartbeat=5'

function matchAuth(req) {
  if (!req.headers.authorization?.startsWith('Digest ')) return false
  const p = parseDigestChallenge(req.headers.authorization)
  if (p.username !== 'test' || p.realm !== realm || p.nonce !== nonce || p.uri !== EVENT_PATH) return false
  const ha1 = hash(`test:${realm}:${password}`)
  const ha2 = hash(`GET:${p.uri}`)
  return p.response === hash(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`)
}

function frame(code, index, data) {
  return '--myboundary\r\nContent-Type: text/plain\r\n\r\n' +
    `Code=${code};action=Pulse;index=${index};data=` +
    JSON.stringify(data, null, 2) + '\r\n'
}

async function run() {
  const sample = frame('FaceComparision', 8, {
    Candidates: [{ Person: { GroupName: 'High Risk Person', Name: 'TEST_FAKE_NAME' }, Similarity: 91 }],
    Face: { Age: 20 },
  }) + '--myboundary\r\nContent-Type: text/plain\r\n\r\nHeartbeat\r\n' +
    frame('TrafficJunction', 5, { v: 1 }) +
    '--myboundary\r\n' +
    'Code=FaceComparision;action=Pulse;index=8;data={not-json\r\n--myboundary\r\n' +
    frame('FaceComparision', 7, { Description: 'ภาษาไทย' }) + '--myboundary\r\n'
  const events = []
  const errors = []
  let heartbeats = 0
  const parser = new FaceEventParser({
    onEvent: event => events.push(event),
    onHeartbeat: () => heartbeats++,
    onMalformed: reason => errors.push(reason),
  })
  const data = Buffer.from(sample, 'utf8')
  // Byte-at-a-time validates header/payload splitting AND UTF-8 split across chunks.
  for (const byte of data) parser.push(Buffer.from([byte]))
  parser.end()
  assert.deepEqual(events.map(e => e.channel), [9, 8])
  assert.equal(events[0].data.Candidates[0].Person.GroupName, 'High Risk Person')
  assert.equal(events[1].data.Description, 'ภาษาไทย')
  assert.equal(heartbeats, 1)
  assert.deepEqual(errors, ['INVALID_EVENT_JSON'])
  console.log('PASS: multipart stream parser, fragmented UTF-8, heartbeat')
  console.log('PASS: channel index conversion and unrelated event ignored')
  console.log('PASS: malformed JSON rejected without creating an event')

  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    assert.equal(req.url, EVENT_PATH)
    if (!matchAuth(req)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth"` })
      res.end('Unauthorized')
      return
    }
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary' })
    res.write('--myboundary\r\nContent-Type: text/plain\r\n\r\nHeartbeat\r\n')
    setTimeout(() => {
      if (!res.destroyed) res.end(frame('FaceComparision', 8, { Candidates: [] }) + '--myboundary\r\n')
    }, 10)
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const got = []
    let seenHeartbeat = 0
    let seenOpen = 0
    const result = await receiveFaceEvents({
      host: '127.0.0.1', port: server.address().port, username: 'test', password,
      allowLoopback: true, timeoutMs: 2000,
      onOpen: () => seenOpen++,
      onHeartbeat: () => seenHeartbeat++,
      onEvent: event => got.push(event.channel),
    })
    assert.equal(result, 'ENDED_BY_NVR')
    assert.deepEqual(got, [9])
    assert.equal(seenHeartbeat, 1)
    assert.equal(seenOpen, 1)
    assert.equal(requests, 2)
    console.log('PASS: authenticated digest live stream with local NVR mock')
    await assert.rejects(receiveFaceEvents({
      host: '127.0.0.1', port: server.address().port,
      username: 'test', password: 'WRONG', allowLoopback: true,
      timeoutMs: 2000, onEvent: () => {},
    }), /NVR_STREAM_HTTP_401/)
    console.log('PASS: incorrect credentials rejected')
    console.log('FACE_EVENT_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
}

run().catch(err => {
  console.error('FACE_EVENT_OFFLINE_TEST: FAIL', err.message)
  process.exitCode = 1
})
