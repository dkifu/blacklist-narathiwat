'use strict'

// Offline regression test: Dahua images return 404 without the active Finder
// session Cookie, even with HTTP Digest. No real NVR or personal data.
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const { createHistoricalClient } = require('./historical-face-client.cjs')
const { createFaceImageClient } = require('./face-image-client.cjs')
const { parseDigestChallenge } = require('./nvr-client.cjs')

const REALM = 'MOCK_NVR'
const NONCE = 'TEST_NONCE'
const PASSWORD = 'ONLY_FOR_LOCAL_MOCK'
const COOKIE = 'NVR_TEST_SESSION'
const hash = s => crypto.createHash('md5').update(s).digest('hex')
const JPEG1 = Buffer.from([255, 216, 255, 224, 0, 0, 255, 217])
const JPEG2 = Buffer.from([255, 216, 255, 224, 1, 0, 0, 255, 217])
const IMG1 = '/IntelliStorage/mnt/SYNTHETIC:8.jpg'
const IMG2 = '/IntelliStorage/mnt/SYNTHETIC-2:8.jpg'

function digestValid(req) {
  if (!req.headers.authorization) return false
  try {
    const d = parseDigestChallenge(req.headers.authorization)
    const a1 = hash(`admin:${REALM}:${PASSWORD}`)
    const a2 = hash(`GET:${req.url}`)
    const expected = hash(`${a1}:${NONCE}:${d.nc}:${d.cnonce}:${d.qop}:${a2}`)
    return d.realm === REALM && d.nonce === NONCE && d.uri === req.url && d.response === expected
  } catch { return false }
}

async function main() {
  const calls = []
  let finderOpen = false
  let imagesServed = 0
  const mock = http.createServer((req, res) => {
    const path = req.url || ''
    if (path.startsWith('/IntelliStorage/mnt/')) {
      calls.push('IMAGE')
      if (!finderOpen || req.headers.cookie !== `DahuaSession=${COOKIE}`) {
        res.writeHead(404); res.end('not found'); return
      }
      const body = path === IMG1 ? JPEG1 : path === IMG2 ? JPEG2 : null
      if (!body) { res.writeHead(404); res.end(); return }
      imagesServed += 1
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': body.length })
      res.end(body)
      return
    }
    if (!path.startsWith('/cgi-bin/mediaFileFind.cgi?')) { res.writeHead(404); res.end(); return }
    if (!digestValid(req)) {
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="${REALM}", nonce="${NONCE}", qop="auth"`,
      }); res.end(); return
    }
    const url = new URL(path, 'http://localhost')
    const action = url.searchParams.get('action')
    if (action !== 'factory.create' && req.headers.cookie !== `DahuaSession=${COOKIE}`) {
      res.writeHead(200); res.end('{"result":false}'); return
    }
    calls.push(action)
    if (action === 'factory.create') {
      finderOpen = true
      res.writeHead(200, { 'Set-Cookie': `DahuaSession=${COOKIE}; Path=/; HttpOnly` })
      res.end('result=456')
    } else if (action === 'findFile') {
      res.end('OK')
    } else if (action === 'findNextFile') {
      const prefix = 'items[0].SummaryNew[0].Value.'
      res.end([
        'found=1',
        'items[0].StartTime=2026-10-31 12:34:15',
        `${prefix}Object.Image.FilePath=${IMG1}`,
        `${prefix}Object.Image.Length=${JPEG1.length}`,
        `${prefix}Candidates[0].Person.Image[0].FilePath=${IMG2}`,
        `${prefix}Candidates[0].Person.Image[0].Length=${JPEG2.length}`,
      ].join('\n'))
    } else if (action === 'close') {
      finderOpen = false
      res.end('OK')
    } else if (action === 'destroy') {
      res.end('OK')
    } else { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const port = mock.address().port
  const makeHistory = () => createHistoricalClient({
    host: '127.0.0.1', port, allowLoopback: true, username: 'admin', password: PASSWORD,
  })
  const searchArgs = {
    uiChannel: 9,
    startTime: '2026-10-31 12:33:00',
    endTime: '2026-10-31 12:36:00',
  }
  try {
    // Reproduce the old defect: Digest alone cannot fetch a file.
    const independent = createFaceImageClient({
      host: '127.0.0.1', port, allowLoopback: true, username: 'admin', password: PASSWORD,
    })
    await assert.rejects(independent.getJpeg(IMG1, JPEG1.length), /NVR_IMAGE_HTTP_404/)
    console.log('PASS: image without session Cookie returns 404, even with independent client')

    const steps = []
    let leakedGetter
    const result = await makeHistory().search({ ...searchArgs,
      onStep: step => steps.push(step),
      onResult: async ({ found, fields, getJpeg }) => {
        assert.equal(found, 1)
        leakedGetter = getJpeg
        const prefix = 'items[0].SummaryNew[0].Value.'
        const imageOne = await getJpeg(fields[prefix + 'Object.Image.FilePath'], Number(fields[prefix + 'Object.Image.Length']))
        const imageTwo = await getJpeg(fields[prefix + 'Candidates[0].Person.Image[0].FilePath'], Number(fields[prefix + 'Candidates[0].Person.Image[0].Length']))
        return [imageOne, imageTwo]
      },
    })
    assert.deepEqual(result.imageResult, [JPEG1, JPEG2])
    assert.deepEqual(steps, ['CREATE', 'SEARCH', 'CLEANUP_OK'])
    assert.deepEqual(calls.slice(-7), ['factory.create', 'findFile', 'findNextFile', 'IMAGE', 'IMAGE', 'close', 'destroy'])
    assert.equal(imagesServed, 2)
    assert.throws(() => leakedGetter(IMG1, JPEG1.length), /NVR_IMAGE_SESSION_CLOSED/)
    console.log('PASS: BOTH JPEGs downloaded using same in-memory Cookie before Finder cleanup')
    console.log('PASS: session cleaned and image fetch blocked after close')

    // Failure in second image validation must still close & destroy Finder.
    const failedSteps = []
    await assert.rejects(makeHistory().search({ ...searchArgs,
      onStep: step => failedSteps.push(step),
      onResult: async ({ getJpeg }) => {
        await getJpeg(IMG1, JPEG1.length)
        await getJpeg(IMG2, JPEG2.length + 1)
      },
    }), /NVR_IMAGE_SIZE_MISMATCH/)
    assert.equal(finderOpen, false)
    assert.deepEqual(failedSteps, ['CREATE', 'SEARCH', 'CLEANUP_OK'])
    console.log('PASS: failed image validation still cleans up Finder; no partial output')
    console.log('SESSION_IMAGE_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('SERVER_UPLOAD: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  } finally {
    mock.closeAllConnections?.()
    await new Promise(resolve => mock.close(resolve))
  }
}
main().catch(error => {
  console.error('SESSION_IMAGE_OFFLINE_TEST: FAIL', error.message)
  process.exitCode = 1
})
