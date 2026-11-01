'use strict'
// Explicit, one-run diagnostic for Stage 21.4. Logs only booleans/status labels.
// Does not change request bytes or retry behavior; does not log paths, headers,
// identities, credentials, cookie values, media or NVR responses.
const http = require('node:http')
let installed = false

function diagnosticLabels(raw) {
  if (typeof raw !== 'string' || !/^Digest\s/i.test(raw)) {
    return { digest: false, stale: 'unknown', algorithm: 'unknown', qop: 'unknown' }
  }
  // Never echo a raw WWW-Authenticate header. Only normalize known tokens.
  const get = key => {
    const found = new RegExp('(?:^|[,\\s])' + key + '=\\s*(?:"([^"]*)"|([^,\\s]+))', 'i').exec(raw)
    return found && (found[1] === undefined ? found[2] : found[1])
  }
  const algorithm = (get('algorithm') || 'MD5').toUpperCase()
  const qop = (get('qop') || 'none').toLowerCase().split(',').map(x => x.trim())
  const stale = (get('stale') || '').toLowerCase()
  return {
    digest: true,
    stale: stale === 'true' ? 'true' : stale === 'false' ? 'false' : 'absent',
    algorithm: ['MD5', 'MD5-SESS', 'SHA-256', 'SHA-256-SESS'].includes(algorithm) ? algorithm : 'other',
    qop: qop.includes('auth') ? 'auth' : qop.includes('none') ? 'none' : 'other',
  }
}

function installTrace({ reporter = console.log } = {}) {
  if (installed) return
  installed = true
  const original = http.request
  http.request = function tracedHttpRequest(...args) {
    const opts = args[0]
    const handlerIndex = args.findIndex(x => typeof x === 'function')
    // Only the known internal historical CGI and the standard Node request signature.
    if (!opts || typeof opts !== 'object' || typeof opts.path !== 'string' ||
        !opts.path.startsWith('/cgi-bin/mediaFileFind.cgi?') || handlerIndex < 0) {
      return original.apply(this, args)
    }
    const qs = opts.path.slice(opts.path.indexOf('?') + 1)
    const action = new URLSearchParams(qs).get('action')
    const actions = {
      'factory.create': 'CREATE', findFile: 'FIND', findNextFile: 'NEXT',
      close: 'CLOSE', destroy: 'DESTROY',
    }
    const category = actions[action] || 'OTHER'
    const headers = opts.headers || {}
    const have = name => Object.keys(headers).some(x => x.toLowerCase() === name.toLowerCase() && Boolean(headers[x]))
    const authSent = have('authorization')
    const cookieSent = have('cookie')
    const originalHandler = args[handlerIndex]
    args[handlerIndex] = function tracedResponse(res) {
      const status = Number.isInteger(res.statusCode) && res.statusCode >= 100 && res.statusCode <= 599
        ? res.statusCode : 'unknown'
      const metadata = diagnosticLabels(res.headers && res.headers['www-authenticate'])
      const parts = [
        'AUTH_TRACE_ACTION=' + category,
        'STATUS=' + status,
        'DIGEST_SENT=' + (authSent ? 'YES' : 'NO'),
        'COOKIE_SENT=' + (cookieSent ? 'YES' : 'NO'),
        'DIGEST_CHALLENGE=' + (metadata.digest ? 'YES' : 'NO'),
        'ALGORITHM=' + metadata.algorithm,
        'QOP=' + metadata.qop,
        'STALE=' + metadata.stale,
      ]
      reporter(parts.join(' '))
      return originalHandler(res)
    }
    return original.apply(this, args)
  }
}

// Automatically install only for the explicit manual diagnostic command.
if (process.argv[1] && /(?:^|[\\/])lpr-planned-sample-smoke\.cjs$/i.test(process.argv[1]) &&
    process.argv[2] === '--manual-one-planned-sample') {
  installTrace()
  console.log('AUTH_TRACE_ACTIVE: YES (status/flags only; no credentials, cookies or media)')
}
module.exports = { installTrace, diagnosticLabels }
