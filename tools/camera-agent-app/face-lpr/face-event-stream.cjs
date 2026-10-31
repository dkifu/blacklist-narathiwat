'use strict'

// Manual-only Dahua FaceComparision event subscription.
// Built-in Node modules only; entirely independent of main.cjs / Ping / updater.

const http = require('node:http')
const net = require('node:net')
const { parseDigestChallenge, digestAuthorization } = require('./nvr-client.cjs')
const { FaceEventParser } = require('./face-event-parser.cjs')

const EVENT_PATH = '/cgi-bin/eventManager.cgi?action=attach&codes=%5BFaceComparision%5D&heartbeat=5'

function privateIPv4(host, allowLoopback = false) {
  if (net.isIP(host) !== 4) return false
  const p = host.split('.').map(Number)
  return p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (allowLoopback && p[0] === 127)
}

function options(host, port, authorization) {
  const headers = { Accept: '*/*', Connection: 'close' }
  if (authorization) headers.Authorization = authorization
  return { host, port, path: EVENT_PATH, method: 'GET', headers, agent: false }
}

function getChallenge(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(options(host, port), response => {
      const auth = response.headers['www-authenticate']
      const status = response.statusCode
      response.resume()
      response.once('end', () => {
        if (status !== 401) return reject(new Error(`NVR_EXPECTED_401_GOT_${status}`))
        try { resolve(parseDigestChallenge(auth)) } catch (err) { reject(err) }
      })
      response.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('NVR_TIMEOUT_CHALLENGE')))
    req.on('error', reject)
    req.end()
  })
}

function consumeStream(host, port, authorization, timeoutMs, signal, handlers) {
  return new Promise((resolve, reject) => {
    let settled = false
    let opened = false
    let req
    const parser = new FaceEventParser(handlers)
    const done = (err, status) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (err) reject(err)
      else resolve(status)
    }
    const abort = () => {
      req?.destroy()
      done(null, 'STOPPED_BY_CLIENT')
    }
    if (signal?.aborted) return done(null, 'STOPPED_BY_CLIENT')
    req = http.request(options(host, port, authorization), res => {
      if (res.statusCode !== 200) {
        res.resume()
        done(new Error(`NVR_STREAM_HTTP_${res.statusCode}`))
        return
      }
      opened = true
      handlers.onOpen?.()
      res.on('data', buffer => {
        try { parser.push(buffer) } catch (error) { req.destroy(error) }
      })
      res.on('end', () => {
        parser.end()
        done(null, 'ENDED_BY_NVR')
      })
      res.on('error', err => done(err))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(opened ? 'NVR_STREAM_IDLE_TIMEOUT' : 'NVR_TIMEOUT_STREAM')))
    req.on('error', err => done(err))
    signal?.addEventListener('abort', abort, { once: true })
    req.end()
  })
}

async function receiveFaceEvents({
  host, username, password, port = 80, timeoutMs = 12000,
  signal, allowLoopback = false,
  onEvent, onHeartbeat = () => {}, onMalformed = () => {}, onOpen = () => {},
}) {
  if (!privateIPv4(host, allowLoopback)) throw new Error('NVR_PRIVATE_IPV4_REQUIRED')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('INVALID_TIMEOUT')
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw new Error('NVR_CREDENTIALS_REQUIRED')
  }
  if (typeof onEvent !== 'function') throw new Error('ON_EVENT_REQUIRED')
  if (signal?.aborted) return 'STOPPED_BY_CLIENT'
  const challenge = await getChallenge(host, port, timeoutMs)
  if (signal?.aborted) return 'STOPPED_BY_CLIENT'
  const auth = digestAuthorization(challenge, 'GET', EVENT_PATH, username, password)
  return consumeStream(host, port, auth, timeoutMs, signal, { onEvent, onHeartbeat, onMalformed, onOpen })
}

module.exports = { receiveFaceEvents }
