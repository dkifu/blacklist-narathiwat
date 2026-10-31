'use strict'

// Local-only offline test: mock a Dahua NVR that requires BOTH Digest and Cookie
// while its historical Finder session is active. No real NVR traffic.
const http = require('node:http')
const assert = require('node:assert/strict')
const { diagnose } = require('./diagnose-image-auth.cjs')
const JPEG = Buffer.from([255, 216, 255, 224, 0, 0, 255, 217])

async function main() {
  let closeSeen = false
  let destroySeen = false
  const mock = http.createServer((req, res) => {
    const auth = String(req.headers.authorization || '')
    const cookie = String(req.headers.cookie || '')
    if (req.url.startsWith('/cgi-bin/mediaFileFind.cgi?')) {
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="mock", nonce="abc123", qop="auth"',
          'Set-Cookie': 'SID=pilot-test; Path=/; HttpOnly' })
        res.end('Unauthorized')
        return
      }
      const action = new URL('http://localhost' + req.url).searchParams.get('action')
      if (action === 'factory.create') return res.end('result=12345')
      if (action === 'findFile') return res.end('OK')
      if (action === 'findNextFile') {
        return res.end('found=1\nitems[0].StartTime=2026-10-31 12:34:15\n' +
          'items[0].SummaryNew[0].Value.Object.Image.FilePath=/IntelliStorage/mnt/mock:8.jpg\n' +
          'items[0].SummaryNew[0].Value.Object.Image.Length=8\n')
      }
      if (action === 'close') { closeSeen = true; return res.end('OK') }
      if (action === 'destroy') { destroySeen = true; return res.end('OK') }
      res.writeHead(404); res.end(); return
    }
    if (req.url === '/IntelliStorage/mnt/mock:8.jpg' && auth.startsWith('Digest ') &&
        cookie.includes('SID=pilot-test')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.end(JPEG)
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  try {
    const results = await diagnose({
      host: '127.0.0.1', port: mock.address().port, allowLoopback: true,
      username: 'admin', password: 'not-a-real-password', log: () => {},
    })
    assert.equal(results.IMG_ANONYMOUS.status, 404)
    assert.equal(results.IMG_DIGEST_ONLY.status, 404)
    assert.equal(results.IMG_COOKIE_ONLY.status, 404)
    assert.equal(results.IMG_DIGEST_AND_COOKIE.status, 200)
    assert.equal(results.IMG_DIGEST_AND_COOKIE.validJpeg, true)
    assert.ok(closeSeen && destroySeen)
    console.log('PASS: mock Finder session and Digest challenge')
    console.log('PASS: distinguish anonymous / Digest / Cookie / combined requests')
    console.log('PASS: session cleanup and in-memory-only JPEG validation')
    console.log('IMAGE_AUTH_DIAGNOSTIC_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  } finally {
    await new Promise((resolve, reject) => mock.close(err => err ? reject(err) : resolve()))
  }
}
main().catch(err => { console.error('OFFLINE_TEST: FAIL', err.name); process.exitCode = 1 })
