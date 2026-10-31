'use strict'

// Manual, read-only authentication diagnostic for Dahua historical face images.
// No images, credentials, cookie values, paths, or personal identifiers are printed or saved.
// Does not import Electron main.cjs, modify the NVR, or send anything to the server.

const http = require('node:http')
const net = require('node:net')
const { parseDigestChallenge, digestAuthorization } = require('./nvr-client.cjs')
const { encodeImagePath } = require('./face-image-client.cjs')

const CGI = '/cgi-bin/mediaFileFind.cgi'
const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 12000
const EXPECTED_TIME = '2026-10-31 12:34:15'

function privateIpv4(host, allowLoopback) {
  if (net.isIP(host) !== 4) return false
  const a = host.split('.').map(Number)
  return a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168) || (allowLoopback && a[0] === 127)
}

function queryString(params) {
  return Object.entries(params).map(([key, val]) =>
    encodeURIComponent(key) + '=' + encodeURIComponent(String(val))).join('&')
}

function performRequest({ host, port, path, authorization, cookie, timeoutMs = TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: '*/*', Connection: 'close' }
    if (authorization) headers.Authorization = authorization
    if (cookie) headers.Cookie = cookie
    const req = http.request({ host, port, path, method: 'GET', headers, agent: false }, res => {
      let size = 0
      const chunks = []
      res.on('data', chunk => {
        size += chunk.length
        if (size > MAX_BYTES) return req.destroy(new Error('RESPONSE_TOO_LARGE'))
        chunks.push(chunk)
      })
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('READ_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

function updateCookieJar(jar, setCookie) {
  for (const entry of (Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [])) {
    const pair = String(entry).split(';', 1)[0]
    const n = pair.indexOf('=')
    if (n < 1) continue
    const key = pair.slice(0, n).trim()
    const value = pair.slice(n + 1).trim()
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(key) || /[\r\n;]/.test(value)) continue
    if (value) jar.set(key, value)
    else jar.delete(key)
  }
}

function fieldsFromText(buffer) {
  const obj = Object.create(null)
  for (const line of buffer.toString('utf8').trim().split(/\r?\n/)) {
    const n = line.indexOf('=')
    if (n > 0) obj[line.slice(0, n).trim()] = line.slice(n + 1).trim()
  }
  return obj
}

function imageSummary(res, expectedBytes) {
  const mime = String(res.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  const body = res.body
  const jpeg = body.length >= 4 && body[0] === 255 && body[1] === 216 && body[2] === 255 &&
    body[body.length - 2] === 255 && body[body.length - 1] === 217
  return {
    status: res.status,
    mime: mime === 'image/jpeg' ? 'JPEG' : 'OTHER',
    validJpeg: res.status === 200 && mime === 'image/jpeg' && jpeg && body.length === expectedBytes,
    digestChallenge: res.status === 401 && /^Digest\s/i.test(res.headers['www-authenticate'] || ''),
  }
}

async function diagnose({ host, username, password, port = 80, allowLoopback = false, log = console.log }) {
  if (!privateIpv4(host, allowLoopback)) throw new Error('PRIVATE_NVR_REQUIRED')
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('INVALID_PORT')
  if (!username || !password) throw new Error('NVR_CREDENTIALS_REQUIRED')

  let challenge = null
  let finder = null
  const jar = new Map()
  const cookie = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ')
  const authorization = path => challenge ? digestAuthorization(challenge, 'GET', path, username, password) : null

  async function cgi(params) {
    const path = CGI + '?' + queryString(params)
    let res = await performRequest({ host, port, path, authorization: authorization(path), cookie: cookie() })
    updateCookieJar(jar, res.headers['set-cookie'])
    if (res.status === 401) {
      challenge = parseDigestChallenge(res.headers['www-authenticate'])
      res = await performRequest({ host, port, path, authorization: authorization(path), cookie: cookie() })
      updateCookieJar(jar, res.headers['set-cookie'])
    }
    if (res.status !== 200) throw new Error('CGI_HTTP_' + res.status)
    if (res.body.toString('utf8').trim().startsWith('{')) throw new Error('CGI_SESSION_REJECTED')
    return res.body.toString('utf8').trim()
  }

  const output = Object.create(null)
  let cleanupOk = true
  try {
    const created = await cgi({ action: 'factory.create' })
    const m = /^result=(\d+)$/.exec(created)
    if (!m) throw new Error('CREATE_FAILED')
    finder = m[1]
    log('CREATE: OK')
    const searched = await cgi({
      action: 'findFile', object: finder,
      'condition.Channel': 9,
      'condition.Types[0]': 'jpg',
      'condition.Flags[0]': 'Event',
      'condition.Events[0]': 'FaceRecognition',
      'condition.DB.FaceRecognitionRecordFilter.RegType': 'RecSuccess',
      'condition.DB.FaceRecognitionRecordFilter.StartTime': '2026-10-31 12:33:00',
      'condition.DB.FaceRecognitionRecordFilter.EndTime': '2026-10-31 12:36:00',
    })
    if (searched !== 'OK') throw new Error('SEARCH_FAILED')
    log('SEARCH: OK')
    const fields = fieldsFromText(Buffer.from(await cgi({ action: 'findNextFile', object: finder, count: 10 })))
    if (fields.found !== '1' || fields['items[0].StartTime'] !== EXPECTED_TIME) {
      throw new Error('EXPECTED_EVENT_NOT_FOUND')
    }
    log('EXPECTED_EVENT: FOUND')
    const prefix = 'items[0].SummaryNew[0].Value.Object.Image.'
    const rawPath = fields[prefix + 'FilePath']
    const length = fields[prefix + 'Length']
    if (!/^\d+$/.test(length || '') || Number(length) < 4 || Number(length) > MAX_BYTES) {
      throw new Error('INVALID_IMAGE_SIZE')
    }
    const path = encodeImagePath(rawPath)
    const expectedBytes = Number(length)
    log('IMAGE_PATH_VALID: true')
    log('LITERAL_COLON_PRESERVED: ' + (path.includes(':') === rawPath.includes(':')))
    log('SESSION_COOKIE_PRESENT: ' + (jar.size > 0))

    const tests = [
      ['IMG_ANONYMOUS', false, false],
      ['IMG_DIGEST_ONLY', true, false],
      ['IMG_COOKIE_ONLY', false, true],
      ['IMG_DIGEST_AND_COOKIE', true, true],
    ]
    for (const [label, useAuth, useCookie] of tests) {
      const response = await performRequest({
        host, port, path,
        authorization: useAuth ? authorization(path) : null,
        cookie: useCookie ? cookie() : null,
      })
      const summary = imageSummary(response, expectedBytes)
      output[label] = summary
      log(label + ': HTTP=' + summary.status + ' JPEG_VALID=' + summary.validJpeg +
        ' DIGEST_CHALLENGE=' + summary.digestChallenge)
    }
    log('DIAGNOSTIC: COMPLETE')
    log('IMAGES_SAVED: NO')
    log('SERVER_UPLOAD: NO')
    return output
  } finally {
    if (finder) {
      for (const action of ['close', 'destroy']) {
        try {
          const result = await cgi({ action, object: finder })
          if (!/^(OK|true|result=true)$/i.test(result)) cleanupOk = false
        } catch {
          cleanupOk = false
        }
      }
    }
    jar.clear()
    challenge = null
    log(cleanupOk ? 'CLEANUP_OK' : 'CLEANUP_UNCONFIRMED')
    log('MAIN_CJS_CHANGED: NO')
  }
}

function askPasswordHidden() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('INTERACTIVE_CMD_REQUIRED'))
    let value = ''
    let ended = false
    process.stdout.write('NVR Password (hidden): ')
    input.setRawMode(true)
    input.resume()
    function finish(error) {
      if (ended) return
      ended = true
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
      error ? reject(error) : resolve(value)
    }
    function onData(chunk) {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish()
        if (ch === '\u0003') return finish(new Error('CANCELLED'))
        if (ch === '\b' || ch === '\u007f') value = value.slice(0, -1)
        else if (ch >= ' ' && value.length < 256) value += ch
      }
    }
    input.on('data', onData)
  })
}

if (require.main === module) {
  ;(async () => {
    if (process.argv[2] !== '--manual-image-auth-diagnostic') {
      console.log('NOT_STARTED: --manual-image-auth-diagnostic required')
      return
    }
    const { readConfig } = require('./config.cjs')
    const path = require('node:path')
    const conf = readConfig(path.join(__dirname, 'pilot.config.json'))
    const nvr = conf.nvrs.find(v => v.id === 'yakang-nvr-01')
    if (conf.enabled !== false || !nvr || nvr.enabled !== false || nvr.host !== '172.17.2.23') {
      throw new Error('EXPECTED_DISABLED_PILOT_CONFIG')
    }
    console.log('MODE: MANUAL_READ_ONLY')
    console.log('TARGET_NVR: yakang-nvr-01')
    console.log('EVENT: HISTORICAL_2026-10-31_12:34:15')
    console.log('SERVER_UPLOAD: NO')
    const password = await askPasswordHidden()
    await diagnose({ host: nvr.host, username: 'admin', password })
  })().catch(e => {
    console.error('DIAGNOSTIC: FAIL ' + (e.message.match(/^[A-Z0-9_]+$/) ? e.message : e.name))
    process.exitCode = 1
  })
}

module.exports = { diagnose }
