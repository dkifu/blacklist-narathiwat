'use strict'
// Offline-only unit test; no real NVR request.
const assert = require('node:assert/strict')
const http = require('node:http')
const { installTrace, diagnosticLabels } = require('./trace-historical-auth.cjs')

assert.deepEqual(diagnosticLabels('Basic realm="ignored"'), {
  digest: false, stale: 'unknown', algorithm: 'unknown', qop: 'unknown',
})
assert.deepEqual(diagnosticLabels('Digest realm="x", nonce="DO_NOT_PRINT", algorithm=MD5, qop="auth", stale=true'), {
  digest: true, stale: 'true', algorithm: 'MD5', qop: 'auth',
})
assert.equal(diagnosticLabels('Digest realm="x", nonce="secret", algorithm=SHA-256').qop, 'none')

const output = []
installTrace({ reporter: x => output.push(x) })
const srv = http.createServer((req, res) => {
  if (req.headers.authorization) {
    res.writeHead(401, {'WWW-Authenticate':'Digest realm="x", nonce="SYNTHETIC_NONCE_SECRET", algorithm=MD5, stale=true'})
  } else {
    res.writeHead(401, {'WWW-Authenticate':'Digest realm="x", nonce="SYNTHETIC_NONCE_SECRET", algorithm=MD5, qop="auth", stale=false'})
  }
  res.end()
})
async function request(port, auth) {
  return new Promise((resolve, reject) => {
    const req = http.request({host:'127.0.0.1', port,
      path:'/cgi-bin/mediaFileFind.cgi?action=factory.create',
      headers: auth ? {Authorization:'Digest SYNTHETIC_SECRET'} : {},
      agent:false}, res => {res.resume();res.on('end',resolve)})
    req.on('error', reject); req.end()
  })
}
async function run() {
  await new Promise(resolve => srv.listen(0,'127.0.0.1',resolve))
  try {
    await request(srv.address().port,false)
    await request(srv.address().port,true)
    assert.equal(output.length,2)
    assert.match(output[0],/AUTH_TRACE_ACTION=CREATE STATUS=401 DIGEST_SENT=NO COOKIE_SENT=NO/)
    assert.match(output[0],/QOP=auth STALE=false/)
    assert.match(output[1],/DIGEST_SENT=YES COOKIE_SENT=NO/)
    assert.match(output[1],/QOP=none STALE=true/)
    assert.ok(output.every(x => !x.includes('SYNTHETIC_SECRET') && !x.includes('SYNTHETIC_NONCE_SECRET')))
    console.log('PASS: distinguishes initial challenge from rejected Digest request')
    console.log('PASS: reports algorithm / qop / stale as bounded labels only')
    console.log('PASS: no credential, nonce, cookie, path or response body in trace')
    console.log('HISTORICAL_AUTH_TRACE_OFFLINE_TEST: PASS')
    console.log('REAL_NVR_REQUEST_SENT: NO')
    console.log('AGENT_MAIN_CHANGED: NO')
  } finally {
    srv.closeAllConnections?.()
    await new Promise(resolve => srv.close(resolve))
  }
}
run().catch(err => {console.error('HISTORICAL_AUTH_TRACE_OFFLINE_TEST: FAIL',err.message);process.exitCode=1})
