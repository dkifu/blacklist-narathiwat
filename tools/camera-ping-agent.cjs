// ===========================================
// CCTV CAMERA PING AGENT
// Windows / Node.js 18+
// ===========================================

const http = require('node:http')

const {
  execFile,
} = require('node:child_process')

const {
  randomBytes,
  timingSafeEqual,
} = require('node:crypto')


/* ==========================================
   CONFIG
========================================== */

const allowedOrigin = process.argv[2]

if (
  !allowedOrigin ||
  !/^https?:\/\//.test(allowedOrigin)
) {
  console.error(
    'Usage: node tools/camera-ping-agent.cjs https://YOUR-WEB-ORIGIN'
  )

  process.exit(1)
}

if (process.platform !== 'win32') {
  console.error(
    'This helper is intended for a Windows workstation.'
  )

  process.exit(1)
}

const key = randomBytes(16).toString('hex')


/* ==========================================
   PRIVATE IP VALIDATION
========================================== */

const validPrivate = ip => {
  const parts = String(ip).split('.')

  if (
    parts.length !== 4 ||
    !parts.every(
      x =>
        /^\d{1,3}$/.test(x) &&
        +x <= 255
    )
  ) {
    return false
  }

  const a = parts.map(Number)

  return (
    a[0] === 10 ||

    (
      a[0] === 172 &&
      a[1] >= 16 &&
      a[1] <= 31
    ) ||

    (
      a[0] === 192 &&
      a[1] === 168
    )
  )
}


/* ==========================================
   ICMP PING
========================================== */

function ping(ip) {
  return new Promise(resolve => {

    execFile(
      'ping.exe',
      [
        '-4',
        '-n', '3',
        '-w', '1200',
        ip,
      ],

      {
        windowsHide: true,
        timeout: 6000,
        maxBuffer: 20000,
      },

      (_error, stdout = '') => {

        const replies = stdout
          .split(/\r?\n/)
          .filter(
            line =>
              /\bTTL\s*=\s*\d+/i.test(line)
          )

        const values = replies
          .map(line => {
            const match = line.match(
              /(?:time|เวลา)\s*([=<])\s*(\d+)\s*ms/i
            )

            return match
              ? (
                  match[1] === '<'
                    ? 0
                    : +match[2]
                )
              : null
          })
          .filter(x => x !== null)

        const received =
          replies.length

        const avgMs = values.length
          ? Math.round(
              values.reduce(
                (s, n) => s + n,
                0
              ) / values.length * 10
            ) / 10
          : null

        const lossPct = Math.round(
          (3 - received) / 3 * 100
        )

        const level =
          !received
            ? 'unreachable'
            : avgMs === null
              ? 'red'
              : (
                  avgMs < 20 &&
                  lossPct === 0
                )
                ? 'green'
                : (
                    avgMs < 80 &&
                    lossPct < 67
                  )
                  ? 'orange'
                  : 'red'

        resolve({
          ip,
          received,
          avgMs,
          lossPct,
          level,
        })

      }
    )
  })
}


/* ==========================================
   PARALLEL PING
========================================== */

async function limitedPing(
  ips,
  concurrency = 8
) {

  const results =
    Array(ips.length)

  let index = 0

  async function worker() {
    while (index < ips.length) {
      const i = index++

      results[i] =
        await ping(ips[i])
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          concurrency,
          ips.length
        ),
      },
      worker
    )
  )

  return results
}


/* ==========================================
   HTTP RESPONSE
========================================== */

function respond(
  res,
  status,
  data,
  origin
) {
  res.writeHead(status, {
    'Content-Type':
      'application/json; charset=utf-8',

    'Cache-Control':
      'no-store',

    'Access-Control-Allow-Origin':
      origin,

    'Access-Control-Allow-Methods':
      'GET,POST,OPTIONS',

    'Access-Control-Allow-Headers':
      'Content-Type,X-Agent-Key',

    'Vary':
      'Origin',
  })

  res.end(
    JSON.stringify(data)
  )
}


/* ==========================================
   LOCAL SERVER
========================================== */

const server = http.createServer(
  async (req, res) => {

    const origin =
      req.headers.origin

    if (origin !== allowedOrigin) {
      res.writeHead(403)
      res.end()
      return
    }

    if (req.method === 'OPTIONS') {
      respond(
        res,
        204,
        {},
        origin
      )
      return
    }

    const token = String(
      req.headers['x-agent-key'] || ''
    )

    const ok =
      token.length === key.length &&
      timingSafeEqual(
        Buffer.from(token),
        Buffer.from(key)
      )

    if (!ok) {
      respond(
        res,
        401,
        {
          error: 'Invalid agent key',
        },
        origin
      )
      return
    }

    if (
      req.method === 'GET' &&
      req.url === '/health'
    ) {
      respond(
        res,
        200,
        {
          ok: true,
          version: 1,
        },
        origin
      )
      return
    }

    if (
      req.method !== 'POST' ||
      req.url !== '/ping'
    ) {
      respond(
        res,
        404,
        {
          error: 'Not found',
        },
        origin
      )
      return
    }

    let body = ''

    try {
      for await (const chunk of req) {
        body += chunk.toString('utf8')

        if (body.length > 16000) {
          throw Error(
            'Payload too large'
          )
        }
      }

      const ips =
        JSON.parse(body).ips

      if (
        !Array.isArray(ips) ||
        ips.length < 1 ||
        ips.length > 25 ||
        new Set(ips).size !== ips.length ||
        !ips.every(validPrivate)
      ) {
        respond(
          res,
          400,
          {
            error:
              '1–25 unique private IPv4 addresses required',
          },
          origin
        )
        return
      }

      const results =
        await limitedPing(ips)

      respond(
        res,
        200,
        {
          results,
        },
        origin
      )

    } catch (err) {
      respond(
        res,
        400,
        {
          error: err.message,
        },
        origin
      )
    }
  }
)


/* ==========================================
   START AGENT
========================================== */

server.listen(
  8765,
  '127.0.0.1',

  () => {
    console.log(
      'Camera Ping Agent running at 127.0.0.1:8765'
    )

    console.log(
      'Allowed web Origin:',
      allowedOrigin
    )

    console.log(
      'Agent Key:',
      key
    )

    console.log(
      'Keep this window open during checks. Ctrl+C to stop.'
    )
  }
)