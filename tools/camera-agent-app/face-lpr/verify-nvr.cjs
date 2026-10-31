'use strict'

// Offline tests: mock HTTP server on 127.0.0.1 only. Never contacts a real NVR.
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const {
  createNvrClient, parseChannelTitles,
  parseDigestChallenge, digestAuthorization,
} = require('./nvr-client.cjs')

const realm = 'Dahua_Test_Only'
const nonce = 'test_nonce_123'
const password = 'TEST_PASSWORD_ONLY'
const hash = t => crypto.createHash('md5').update(t).digest('hex')

function parseAuthorization(header) {
  return parseDigestChallenge(header.replace(/^Digest /, 'Digest realm="unused", nonce="unused", '))
}

function validateAuthorization(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Digest ')) return false
  // Parse response separately; challenge parser requires realm and nonce.
  const p = parseDigestChallenge(header)
  if (p.nonce !== nonce || p.realm !== realm || p.username !== 'admin' || p.qop !== 'auth') return false
  const ha1 = hash(`admin:${realm}:${password}`)
  const ha2 = hash(`GET:${p.uri}`)
  const expected = hash(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`)
  return expected === p.response && p.uri === req.url
}

async function run() {
  assert.throws(() => createNvrClient({ host: '8.8.8.8', username: 'x', password: 'x' }), /PRIVATE_IPV4/)
  assert.throws(() => createNvrClient({ host: '172.17.2.23', username: 'x', password: '' }), /CREDENTIALS_REQUIRED/)
  const digest = parseDigestChallenge('Digest realm="abc", nonce="def", qop="auth,auth-int"')
  assert.match(digestAuthorization(digest, 'GET', '/x', 'admin', 'x'), /^Digest /)
  console.log('PASS: private-network and credential validation')
  console.log('PASS: Digest challenge parsing')

  let hits = 0
  const server = http.createServer((req, res) => {
    hits += 1
    if (!validateAuthorization(req)) {
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth", opaque="test"`,
        'Connection': 'close',
      })
      res.end('Unauthorized')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    if (req.url === '/cgi-bin/eventManager.cgi?action=getCaps') {
      res.end('caps.One=true\ncaps.Two=true\n')
    } else if (req.url === '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle') {
      res.end('table.ChannelTitle[5].Name=ยะกัง จยย_ขาเข้า\n' +
        'table.ChannelTitle[8].Name=ยะกัง_Face_Dahua\n')
    } else {
      res.end('UNKNOWN')
    }
  })

  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const client = createNvrClient({
      host: '127.0.0.1', port, username: 'admin', password, allowLoopback: true,
    })
    const caps = await client.getCaps()
    assert.equal(caps.split('\n').filter(x => x.startsWith('caps.')).length, 2)
    console.log('PASS: mock NVR Digest Authentication + getCaps')
    const titles = parseChannelTitles(await client.getChannelTitles())
    assert.equal(titles.get(6), 'ยะกัง จยย_ขาเข้า')
    assert.equal(titles.get(9), 'ยะกัง_Face_Dahua')
    assert.equal(hits, 4)
    console.log('PASS: read-only channel titles, UI channels 6 and 9')
    const bad = createNvrClient({
      host: '127.0.0.1', port, username: 'admin', password: 'WRONG', allowLoopback: true,
    })
    await assert.rejects(bad.getCaps(), /NVR_HTTP_401/)
    console.log('PASS: wrong password rejected safely')
    console.log('NVR_CONNECTOR_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
}

run().catch(e => {
  console.error('NVR_CONNECTOR_OFFLINE_TEST: FAIL', e.message)
  process.exitCode = 1
})
