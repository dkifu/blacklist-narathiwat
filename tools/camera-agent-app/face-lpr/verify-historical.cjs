'use strict'

// Local mock only. This test never contacts a real NVR or reads real personal data.
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const { parseDigestChallenge } = require('./nvr-client.cjs')
const { createHistoricalClient } = require('./historical-face-client.cjs')
const { evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')
const config = require('./pilot.config.json')

const realm = 'LOCAL_TEST_REALM'
const nonce = 'LOCAL_TEST_NONCE'
const password = 'SYNTHETIC_SECRET'
const hash = s => crypto.createHash('md5').update(s).digest('hex')
const session = 'MOCK_COOKIE_VALUE'
const calls = []

function validDigest(request) {
  if (!request.headers.authorization) return false
  try {
    const d = parseDigestChallenge(request.headers.authorization)
    if (d.username !== 'admin' || d.realm !== realm || d.nonce !== nonce || d.qop !== 'auth') return false
    if (d.uri !== request.url) return false
    const a1 = hash(`admin:${realm}:${password}`)
    const a2 = hash(`GET:${request.url}`)
    const expected = hash(`${a1}:${nonce}:${d.nc}:${d.cnonce}:${d.qop}:${a2}`)
    return d.response === expected
  } catch { return false }
}

async function run() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/cgi-bin/mediaFileFind.cgi') {
      res.writeHead(404); res.end(); return
    }
    const action = url.searchParams.get('action')
    if (!validDigest(req)) {
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth"`,
      }); res.end('Unauthorized'); return
    }
    if (action !== 'factory.create' && req.headers.cookie !== `DahuaSession=${session}`) {
      res.writeHead(200); res.end('{"result":false,"error":{"code":287637505}}'); return
    }
    calls.push(action)
    if (action === 'factory.create') {
      res.writeHead(200, { 'Set-Cookie': `DahuaSession=${session}; Path=/; HttpOnly` })
      res.end('result=12345')
    } else if (action === 'findFile') {
      const p = url.searchParams
      if (p.get('object') !== '12345' || p.get('condition.Channel') !== '9' ||
          p.get('condition.Events[0]') !== 'FaceRecognition' ||
          p.get('condition.DB.FaceRecognitionRecordFilter.RegType') !== 'RecSuccess' ||
          p.get('condition.DB.FaceRecognitionRecordFilter.StartTime') !== '2026-10-31 12:33:00') {
        res.writeHead(400); res.end('INVALID_FILTER'); return
      }
      res.end('OK')
    } else if (action === 'findNextFile') {
      const p = 'items[0].'
      const f = p + 'SummaryNew[0].Value.'
      const c = f + 'Candidates[0].'
      res.end([
        'found=1',
        `${p}Channel=8`,
        `${p}StartTime=2026-10-31 12:34:15`,
        `${p}FilePath=/IntelliStorage/mnt/SYNTHETIC.jpg`,
        `${c}Person.Name=SYNTHETIC NAME`,
        `${c}Person.GroupName=High Risk Person`,
        `${c}Person.ID=DO_NOT_DISPLAY`,
        `${c}Similarity=91`,
        `${f}Object.Image.FilePath=/IntelliStorage/mnt/SYNTHETIC_DETECTED.jpg`,
        `${c}Person.Image[0].FilePath=/IntelliStorage/mnt/SYNTHETIC_REFERENCE.jpg`,
      ].join('\n'))
    } else if (action === 'close' || action === 'destroy') {
      res.end('OK')
    } else {
      res.writeHead(404); res.end('UNKNOWN_ACTION')
    }
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const client = createHistoricalClient({
      host: '127.0.0.1', port: server.address().port, allowLoopback: true,
      username: 'admin', password,
    })
    const steps = []
    const { found, fields } = await client.search({
      uiChannel: 9,
      startTime: '2026-10-31 12:33:00', endTime: '2026-10-31 12:36:00',
      onStep: x => steps.push(x),
    })
    assert.equal(found, 1)
    assert.deepEqual(calls, ['factory.create', 'findFile', 'findNextFile', 'close', 'destroy'])
    assert.deepEqual(steps, ['CREATE', 'SEARCH', 'CLEANUP_OK'])
    console.log('PASS: mock digest authentication and same-host in-memory session cookie')
    console.log('PASS: historical search sequence and session cleanup')

    const testing = structuredClone(config)
    testing.enabled = true
    testing.nvrs[0].enabled = true
    const result = evaluateHistoricalFaceRecord({ config: testing, nvrId: 'yakang-nvr-01', fields })
    assert.equal(result.qualified, true)
    assert.equal(result.alert.personName, 'SYNTHETIC NAME')
    assert.equal(result.alert.personId, '')
    assert.equal(result.alert.similarity, 91)
    assert.equal(result.alert.faceChannel, 9)
    assert.deepEqual(result.alert.lprTargets.map(x => x.channel), [6])
    assert.equal(result.alert.verifiedImagePair, false)
    assert.equal(config.enabled, false)
    assert.equal(config.nvrs[0].enabled, false)
    console.log('PASS: synthetic record -> High Risk CAM9 -> LPR CAM6; ID blank')
    console.log('PASS: on-disk pilot configuration remains disabled')

    await assert.rejects(createHistoricalClient({
      host: '127.0.0.1', port: server.address().port, allowLoopback: true,
      username: 'admin', password: 'WRONG_PASSWORD',
    }).search({ uiChannel: 9, startTime: '2026-10-31 12:33:00', endTime: '2026-10-31 12:36:00' }), /NVR_HTTP_401/)
    console.log('PASS: invalid credentials rejected')
    assert.throws(() => createHistoricalClient({ host: '8.8.8.8', username: 'x', password: 'x' }), /NVR_PRIVATE_IPV4_REQUIRED/)
    console.log('PASS: public target rejected')
    console.log('HISTORICAL_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('SERVER_UPLOAD: NO')
    console.log('MAIN_CJS_CHANGED: NO')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
}
run().catch(error => {
  console.error('HISTORICAL_OFFLINE_TEST: FAIL', error.message)
  process.exitCode = 1
})
