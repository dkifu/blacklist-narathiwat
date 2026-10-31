'use strict'

// Offline tests only. Runs a loopback HTTP mock; does NOT contact a real NVR.
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const { createFaceImageClient, encodeImagePath } = require('./face-image-client.cjs')

const TEST_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9])
const ROOT = '/IntelliStorage/mnt/face.jpg'
const REALM = 'mock-NVR'
const NONCE = 'nonce-123'
const H = s => crypto.createHash('md5').update(s).digest('hex')

function isAuthorized(value, path) {
  if (!value || !value.startsWith('Digest ')) return false
  const field = name => {
    const m = new RegExp('(?:^|[,\\s])' + name + '="?([^",\\s]+)', 'i').exec(value)
    return m && m[1]
  }
  const username = field('username')
  const nc = field('nc')
  const cnonce = field('cnonce')
  const qop = field('qop')
  const uri = field('uri')
  if (username !== 'admin' || uri !== path || qop !== 'auth') return false
  const a1 = H(`admin:${REALM}:testpass`)
  const a2 = H(`GET:${uri}`)
  return field('response') === H(`${a1}:${NONCE}:${nc}:${cnonce}:${qop}:${a2}`)
}

async function main() {
  const mock = http.createServer((req, res) => {
    if (!isAuthorized(req.headers.authorization, req.url)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", nonce="${NONCE}", qop="auth"` })
      res.end('unauthorized')
      return
    }
    const segments = req.url.split('/')
    const filename = segments.at(-1)
    // Match real Dahua behavior: IntelliStorage filename contains literal ':'.
    if (req.url.includes('%3A') || req.url.includes('%3a')) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    if (filename === 'redirect.jpg') {
      res.writeHead(302, { Location: 'http://example.com/face.jpg' })
      res.end()
      return
    }
    if (filename === 'wrongmime.jpg') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(TEST_JPEG)
      return
    }
    if (filename === 'truncated.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.end(TEST_JPEG.subarray(0, 4))
      return
    }
    if (filename === 'badjpeg.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.end(Buffer.alloc(TEST_JPEG.length, 0x41))
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    res.end(TEST_JPEG)
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  try {
    const port = mock.address().port
    const client = createFaceImageClient({ host: '127.0.0.1', allowLoopback: true, port,
      username: 'admin', password: 'testpass' })
    assert.deepEqual(await client.getJpeg(ROOT, TEST_JPEG.length), TEST_JPEG)
    const colonPath = '/IntelliStorage/mnt/0-50237-3-21-1-1:30186.jpg'
    assert.equal(encodeImagePath(colonPath), colonPath)
    assert.deepEqual(await client.getJpeg(colonPath, TEST_JPEG.length), TEST_JPEG)
    console.log('PASS: Dahua literal colon path preserved (no %3A / HTTP 404)')
    console.log('PASS: authenticated same-host Digest download, complete JPEG')

    for (const path of [
      'http://example.com/face.jpg', '/etc/passwd', '/IntelliStorage/mnt/../other.jpg',
      '/IntelliStorage/mnt/%2e%2e/face.jpg', '/IntelliStorage/mnt/x.jpg?url=x',
      '/IntelliStorage/mnt/face.png', '/IntelliStorage/mnt/a\\b.jpg',
    ]) assert.throws(() => encodeImagePath(path), /NVR_IMAGE_PATH_NOT_ALLOWED/)
    assert.throws(() => createFaceImageClient({ host: '1.1.1.1', username: 'admin', password: 'abc' }), /NVR_PRIVATE_IPV4_REQUIRED/)
    console.log('PASS: private NVR only, image path allowlist, traversal and URL rejected')

    await assert.rejects(client.getJpeg(ROOT, TEST_JPEG.length + 1), /NVR_IMAGE_SIZE_MISMATCH/)
    await assert.rejects(client.getJpeg(ROOT.replace('face.jpg','wrongmime.jpg'), TEST_JPEG.length), /NVR_IMAGE_INVALID_CONTENT_TYPE/)
    await assert.rejects(client.getJpeg(ROOT.replace('face.jpg','truncated.jpg'), TEST_JPEG.length), /NVR_IMAGE_SIZE_MISMATCH/)
    await assert.rejects(client.getJpeg(ROOT.replace('face.jpg','badjpeg.jpg'), TEST_JPEG.length), /NVR_IMAGE_INVALID_JPEG/)
    await assert.rejects(client.getJpeg(ROOT.replace('face.jpg','redirect.jpg'), TEST_JPEG.length), /NVR_IMAGE_HTTP_302/)
    console.log('PASS: wrong MIME, length, JPEG markers, and redirects rejected')

    const bad = createFaceImageClient({ host: '127.0.0.1', allowLoopback: true, port,
      username: 'admin', password: 'wrong' })
    await assert.rejects(bad.getJpeg(ROOT, TEST_JPEG.length), /NVR_IMAGE_HTTP_401/)
    console.log('PASS: incorrect password rejected, no token or image content logged')
    console.log('FACE_IMAGE_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('SERVER_UPLOAD: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  } finally {
    await new Promise((resolve, reject) => mock.close(e => e ? reject(e) : resolve()))
  }
}
main().catch(e => { console.error('FACE_IMAGE_OFFLINE_TEST: FAIL', e.message); process.exitCode = 1 })
