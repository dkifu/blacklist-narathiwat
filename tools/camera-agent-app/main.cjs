// ===========================================
// CCTV PING AGENT - WINDOWS APPLICATION
// Electron / Blacklist Narathiwat
// ===========================================

const {
  app,
  BrowserWindow,
  dialog,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
} = require('electron')

const { autoUpdater } = require('electron-updater')

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')

// ==========================================
// PERSISTENT USER DATA DIRECTORY
// ใช้โฟลเดอร์เดิมทั้งรุ่นพัฒนาและรุ่นติดตั้ง
// ==========================================

const stableUserDataPath = path.join(
  app.getPath('appData'),
  'cctv-ping-agent'
)

fs.mkdirSync(stableUserDataPath, {
  recursive: true,
})

app.setPath('userData', stableUserDataPath)

const {
  randomBytes,
  randomUUID,
  generateKeyPairSync,
  createPublicKey,
  sign,
  timingSafeEqual,
} = require('node:crypto')


/* ==========================================
   CONFIG
========================================== */

const PORT = 8765
const PROTOCOL = 'cctv-ping-agent'

const ALLOWED_ORIGINS = new Set([
  'https://dkifu.github.io',
  'http://localhost:5173',
])

// Session ใช้งานได้นาน 24 ชั่วโมง
const SESSION_TTL_MS =
  24 * 60 * 60 * 1000

// เปลี่ยนรหัสได้เมื่อ Session หมดอายุ
let sessionKey =
  randomBytes(32).toString('hex')

let mainWindow = null
let server = null
let busy = false

// System Tray
let tray = null
let isQuitting = false

// ==========================================
// CONNECTION APPROVAL
// ==========================================

// เว็บไซต์ที่เจ้าหน้าที่อนุญาตในรอบนี้
let approvedOrigin = null

// ป้องกันการเปิดหน้าต่างอนุญาตซ้อนกัน
let pairingPromptOpen = false

// เวลาหมดอายุของสิทธิ์เว็บไซต์
let approvedUntil = 0

// ยกเลิกสิทธิ์และสร้าง Session Key ใหม่
function resetApproval() {
  approvedOrigin = null
  approvedUntil = 0

  sessionKey =
    randomBytes(32).toString('hex')

  // อัปเดตเมนูหลังยกเลิกสิทธิ์
  updateTrayMenu()
}

// ตรวจสอบสิทธิ์หมดอายุ
function expireApprovalIfNeeded() {
  if (
    approvedOrigin &&
    Date.now() >= approvedUntil
  ) {
    resetApproval()
  }
}

/* ==========================================
   DEVICE IDENTITY
========================================== */

let deviceIdentity = null

function ensureDeviceIdentity() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Windows ไม่พร้อมเข้ารหัสข้อมูลประจำเครื่อง'
    )
  }

  const filePath = path.join(
    app.getPath('userData'),
    'device-identity.json'
  )

  // หากเคยสร้างแล้ว ให้นำตัวตนเดิมกลับมาใช้
  if (fs.existsSync(filePath)) {
    const saved = JSON.parse(
      fs.readFileSync(filePath, 'utf8')
    )

    if (
      typeof saved.id !== 'string' ||
      typeof saved.publicKey !== 'string' ||
      typeof saved.privateKeyProtected !== 'string'
    ) {
      throw new Error('ข้อมูลประจำเครื่องไม่สมบูรณ์')
    }

    // ตรวจสอบว่ากุญแจส่วนตัวถอดรหัสได้
    // และตรงกับกุญแจสาธารณะที่บันทึกไว้
    const privateKey = safeStorage.decryptString(
      Buffer.from(saved.privateKeyProtected, 'base64')
    )

    const publicKey = createPublicKey(privateKey)
      .export({
        type: 'spki',
        format: 'pem',
      })

    if (publicKey !== saved.publicKey) {
      throw new Error('กุญแจประจำเครื่องไม่ตรงกัน')
    }

    return saved
  }

  // สร้างตัวตนใหม่เฉพาะการเปิดครั้งแรก
  const { publicKey, privateKey } =
    generateKeyPairSync('ed25519', {
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    })

  const identity = {
    id: randomUUID(),
    publicKey,
    privateKeyProtected:
      safeStorage.encryptString(privateKey).toString('base64'),
    createdAt: new Date().toISOString(),
  }

  // ไม่เขียนทับตัวตนเดิม
  fs.writeFileSync(
    filePath,
    JSON.stringify(identity, null, 2),
    {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    }
  )

  return identity
}


/* ==========================================
   AUTOMATIC DEVICE HEARTBEAT
   Every 60 seconds, independent of browser
========================================== */

const HEARTBEAT_URL =
  'https://supabase.melonman.uk/functions/v1/agent-heartbeat'

const HEARTBEAT_INTERVAL_MS = 60 * 1000

const HEARTBEAT_UUID_PATTERN =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

let heartbeatTimer = null
let heartbeatBusy = false

async function heartbeatApi(body) {
  const res = await fetch(HEARTBEAT_URL, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
    },

    body: JSON.stringify(body),

    signal: AbortSignal.timeout(12000),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok || !data?.success) {
    throw new Error(
      `HTTP ${res.status}: ${data?.error || 'Heartbeat failed'}`
    )
  }

  return data
}

async function sendDeviceHeartbeat() {
  if (heartbeatBusy || !deviceIdentity) {
    return
  }

  heartbeatBusy = true

  try {
    const deviceId = deviceIdentity.id

    // 1. ขอ Challenge จาก Server
    const challenge = await heartbeatApi({
      action: 'challenge',
      deviceId,
    })

    if (
      challenge.deviceId !== deviceId ||
      typeof challenge.challengeId !== 'string' ||
      !HEARTBEAT_UUID_PATTERN.test(challenge.challengeId) ||
      typeof challenge.nonce !== 'string' ||
      !/^[0-9a-f]{64}$/.test(challenge.nonce)
    ) {
      throw new Error(
        'Invalid heartbeat challenge from server'
      )
    }

    // 2. สร้างข้อความสำหรับเซ็น
    // ต้องตรงกับ Edge Function Heartbeat V2

    const agentVersion = app.getVersion()

    const message = [
      'CCTV-AGENT-HEARTBEAT-V2',
      challenge.challengeId,
      deviceId,
      challenge.nonce,
      agentVersion,
    ].join('\n')

    // 3. ถอด Private Key ภายใน Agent
    const privateKey = safeStorage.decryptString(
      Buffer.from(
        deviceIdentity.privateKeyProtected,
        'base64'
      )
    )

    // 4. เซ็นด้วย Ed25519
    const signature = sign(
      null,
      Buffer.from(message, 'utf8'),
      privateKey
    ).toString('base64')

    // 5. ส่งลายเซ็นและ Agent Version ให้ Server ตรวจสอบ
    const result = await heartbeatApi({
      action: 'heartbeat',
      deviceId,
      challengeId: challenge.challengeId,
      signature,
      agentVersion,
    })

    if (result.deviceId !== deviceId) {
      throw new Error(
        'Heartbeat response Device ID mismatch'
      )
    }

    console.log(
      '[HEARTBEAT] OK:',
      result.lastSeenAt
    )
  } catch (err) {
    console.warn(
      '[HEARTBEAT] Failed:',
      err.message
    )
  } finally {
    heartbeatBusy = false
  }
}

function startHeartbeat() {
  if (heartbeatTimer) {
    return
  }

  // ส่งครั้งแรกเมื่อ Agent เริ่มทำงาน
  void sendDeviceHeartbeat()

  // ส่งซ้ำทุก 60 วินาที
  heartbeatTimer = setInterval(() => {
    void sendDeviceHeartbeat()
  }, HEARTBEAT_INTERVAL_MS)
}



/* ==========================================
   VALIDATE PRIVATE IPv4
========================================== */

function validPrivateIPv4(value) {
  if (typeof value !== 'string') return false

  const parts = value.split('.')

  if (parts.length !== 4) return false

  if (!parts.every(p =>
    /^\d{1,3}$/.test(p) &&
    String(Number(p)) === p &&
    Number(p) <= 255
  )) {
    return false
  }

  const [a, b] = parts.map(Number)

  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
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

      (_err, stdout = '') => {

        const replies = stdout
          .split(/\r?\n/)
          .filter(line =>
            /\bTTL\s*=\s*\d+/i.test(line)
          )

        const values = replies
          .map(line => {
            const match = line.match(
              /(?:time|เวลา)\s*([=<])\s*(\d+)\s*ms/i
            )

            return match
              ? match[1] === '<'
                ? 0
                : Number(match[2])
              : null
          })
          .filter(value => value !== null)

        const received =
          Math.min(replies.length, 3)

        const avgMs = values.length
          ? Math.round(
              values.reduce(
                (total, value) => total + value,
                0
              ) / values.length * 10
            ) / 10
          : null

        const lossPct = Math.round(
          (3 - received) / 3 * 100
        )

        const level = !received
          ? 'unreachable'

          : avgMs === null
            ? 'red'

            : avgMs < 20 && lossPct === 0
              ? 'green'

              : avgMs < 80 && lossPct < 67
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

async function pingAll(ips) {
  const results = Array(ips.length)

  let cursor = 0

  async function worker() {
    while (cursor < ips.length) {
      const i = cursor++

      results[i] = await ping(ips[i])
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(8, ips.length),
      },
      () => worker()
    )
  )

  return results
}


/* ==========================================
   HTTP RESPONSE
========================================== */

function response(
  res,
  status,
  body,
  origin
) {
  res.writeHead(status, {
    'Content-Type':
      'application/json; charset=utf-8',

    'Access-Control-Allow-Origin': origin,

    'Access-Control-Allow-Methods':
      'GET, POST, OPTIONS',

    'Access-Control-Allow-Headers':
      'Content-Type, X-Agent-Key',

    'Cache-Control': 'no-store',

    Vary: 'Origin',
  })

  if (status === 204) {
    res.end()
  } else {
    res.end(JSON.stringify(body))
  }
}


/* ==========================================
   SESSION AUTHORIZATION
========================================== */

function authorized(req) {
  const sent = String(
    req.headers['x-agent-key'] || ''
  )

  return (
    sent.length === sessionKey.length &&
    timingSafeEqual(
      Buffer.from(sent),
      Buffer.from(sessionKey)
    )
  )
}


/* ==========================================
   LOCAL HTTP SERVER
========================================== */

function startServer() {

  server = http.createServer(
    async (req, res) => {

      const origin =
        req.headers.origin

      if (
        !ALLOWED_ORIGINS.has(origin) ||
        req.headers.host !==
          `127.0.0.1:${PORT}`
      ) {
        res.writeHead(403, {
          'Cache-Control': 'no-store',
        })

        res.end()
        return
      }

      // ตรวจสอบ Session ก่อนประมวลผลคำขอ
      expireApprovalIfNeeded()


      /* PREFLIGHT */

      if (req.method === 'OPTIONS') {
        response(res, 204, null, origin)
        return
      }


      /* HEALTH CHECK */

      if (
        req.method === 'GET' &&
        req.url === '/health'
      ) {
        response(
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


      /* ==========================================
        SESSION KEY - REQUIRE USER APPROVAL
        ========================================== */

        if (
        req.method === 'GET' &&
        req.url === '/session'
        ) {

        // อนุญาตเพียงเว็บไซต์เดียวต่อการเปิด Agent
        if (
            approvedOrigin &&
            approvedOrigin !== origin
        ) {
            response(res, 403, {
            error: 'Another website is already approved',
            }, origin)
            return
        }

        // ยังไม่เคยอนุญาตในรอบนี้
        if (!approvedOrigin) {

            if (pairingPromptOpen) {
            response(res, 429, {
                error: 'Approval already in progress',
            }, origin)
            return
            }

            pairingPromptOpen = true

            try {

            if (
                mainWindow &&
                !mainWindow.isDestroyed()
            ) {
                mainWindow.show()
                mainWindow.focus()
            }

            const result = await dialog.showMessageBox(
                mainWindow,
                {
                type: 'question',

                title: 'CCTV Ping Agent',

                message:
                    'อนุญาตให้เว็บไซต์นี้เชื่อมต่อ CCTV Ping Agent หรือไม่?',

                detail:
                    `เว็บไซต์: ${origin}\n\n` +
                    'เมื่ออนุญาต เว็บไซต์นี้จะสามารถสั่ง Ping IP ภายในเครือข่ายที่เครื่องเข้าถึงได้\n\n' +
                    'สิทธิ์นี้ใช้งานได้ 24 ชั่วโมง หรือจนกว่าจะยกเลิกสิทธิ์หรือปิดโปรแกรม Agent',

                buttons: [
                    'อนุญาตการเชื่อมต่อ',
                    'ไม่อนุญาต',
                ],

                defaultId: 1,
                cancelId: 1,
                noLink: true,
                }
            )

            // กดไม่อนุญาต หรือปิดหน้าต่าง
            if (result.response !== 0) {

                response(res, 403, {
                error: 'Connection rejected by user',
                }, origin)

                return
            }

            // เจ้าหน้าที่กดยืนยัน
            approvedOrigin = origin

            // เริ่มนับ 24 ชั่วโมงจากเวลาที่อนุญาต
            approvedUntil =
              Date.now() + SESSION_TTL_MS

            // อัปเดตสถานะใน System Tray
            updateTrayMenu()

            } catch (err) {

            response(res, 500, {
                error: 'Approval failed',
            }, origin)

            return

            } finally {
            pairingPromptOpen = false
            }
        }

        // ส่งรหัสเฉพาะเว็บไซต์ที่ได้รับอนุญาต
        response(
            res,
            200,
            {
            key: sessionKey,
            },
            origin
        )

        return
        }


      /* REQUIRE SESSION KEY */

      if (
        approvedOrigin !== origin ||
        !authorized(req)
        ) {
        response(
            res,
            401,
            {
            error: 'Agent connection is not authorized',
            },
            origin
        )

        return
        }

              /* ==========================================
                DEVICE IDENTITY API
                Requires approved Agent session
            ========================================== */

            if (
                req.method === 'GET' &&
                req.url === '/identity'
            ) {

                if (!deviceIdentity) {
                response(
                    res,
                    503,
                    {
                    error: 'Device identity not ready',
                    },
                    origin
                )

                return
                }

                response(
                res,
                200,
                {
                    deviceId: deviceIdentity.id,
                    publicKey: deviceIdentity.publicKey,
                    agentVersion: app.getVersion(),
                },
                origin
                )

                return
            }

            
      /* ==========================================
         SIGN REGISTRATION CHALLENGE
         Requires approved Agent session
      ========================================== */

      if (
        req.method === 'POST' &&
        req.url === '/sign-registration'
      ) {
        if (!deviceIdentity) {
          response(res, 503, {
            error: 'Device identity not ready',
          }, origin)
          return
        }

        try {
          let raw = ''

          for await (const chunk of req) {
            raw += chunk.toString('utf8')

            if (Buffer.byteLength(raw, 'utf8') > 2048) {
              response(res, 413, {
                error: 'Request too large',
              }, origin)
              return
            }
          }

          let body

          try {
            body = JSON.parse(raw)
          } catch {
            response(res, 400, {
              error: 'Invalid JSON',
            }, origin)
            return
          }

          const {
            challengeId,
            deviceId,
            nonce,
          } = body || {}

        const uuidPattern =
            /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

        

          if (
            typeof challengeId !== 'string' ||
            !uuidPattern.test(challengeId) ||
            typeof deviceId !== 'string' ||
            deviceId !== deviceIdentity.id ||
            typeof nonce !== 'string' ||
            !/^[0-9a-f]{64}$/.test(nonce)
          ) {
            response(res, 400, {
              error: 'Invalid registration challenge',
            }, origin)
            return
          }

          // รูปแบบข้อความต้องตรงกับ Edge Function
          const message = [
            'CCTV-AGENT-REGISTER-V1',
            challengeId,
            deviceId,
            nonce,
          ].join('\n')

          // ถอดรหัส Private Key ภายใน Agent เท่านั้น
          const privateKey = safeStorage.decryptString(
            Buffer.from(
              deviceIdentity.privateKeyProtected,
              'base64'
            )
          )

          // เซ็นข้อความด้วย Ed25519
          const signature = sign(
            null,
            Buffer.from(message, 'utf8'),
            privateKey
          ).toString('base64')

          // ส่งเฉพาะลายเซ็น ไม่ส่ง Private Key
          response(res, 200, {
            deviceId,
            challengeId,
            signature,
          }, origin)

          return
        } catch (err) {
          console.error(
            'Registration signing failed:',
            err.message
          )

          response(res, 500, {
            error: 'Registration signing failed',
          }, origin)

          return
        }
      }



            /* ==========================================
                REPORT COMPLETED
                Keep Agent and Session active
            ========================================== */

            if (
                req.method === 'POST' &&
                req.url === '/shutdown'
            ) {

                if (busy) {
                response(
                    res,
                    409,
                    {
                    error: 'Ping still running',
                    },
                    origin
                )

                return
                }

                // บันทึกรายงานเสร็จแล้ว
                // ไม่ปิด Agent และไม่ยกเลิก Session
                response(
                res,
                200,
                {
                    ok: true,
                    agentRunning: true,
                    sessionActive: true,
                },
                origin
                )

                return
            }

      


      /* PING ENDPOINT */

      if (
        req.method !== 'POST' ||
        req.url !== '/ping'
      ) {
        response(
          res,
          404,
          {
            error: 'Not found',
          },
          origin
        )

        return
      }


      if (busy) {
        response(
          res,
          429,
          {
            error: 'Already checking cameras',
          },
          origin
        )

        return
      }

      busy = true

      try {
        let body = ''

        for await (const chunk of req) {
          body += chunk.toString('utf8')

          if (
            Buffer.byteLength(body, 'utf8') >
            16000
          ) {
            throw Error('Payload too large')
          }
        }

        const ips =
          JSON.parse(body).ips

        if (
          !Array.isArray(ips) ||
          ips.length < 1 ||
          ips.length > 25 ||
          ips.length !== new Set(ips).size ||
          !ips.every(validPrivateIPv4)
        ) {
          response(
            res,
            400,
            {
              error:
                'Need 1-25 unique private IPv4 addresses',
            },
            origin
          )

          return
        }

        const results =
          await pingAll(ips)

        response(
          res,
          200,
          { results },
          origin
        )

      } catch (err) {

        response(
          res,
          400,
          {
            error: err.message,
          },
          origin
        )

      } finally {
        busy = false
      }

    }
  )

  server.on('error', err => {
    dialog.showErrorBox(
      'CCTV Ping Agent',
      `เปิดพอร์ต ${PORT} ไม่สำเร็จ: ${err.message}\nกรุณาปิด Agent ตัวเก่าก่อน`
    )

    app.quit()
  })

  server.listen(
    PORT,
    '127.0.0.1'
  )
}

/* ==========================================
   SYSTEM TRAY
========================================== */

/* ==========================================
   UPDATE SYSTEM TRAY MENU
========================================== */

function updateTrayMenu() {
  if (!tray) return

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `CCTV Ping Agent  v${app.getVersion()}`,
      enabled: false,
    },
    {
      type: 'separator',
    },
    // =====================================
    // USER CLICK TO UPDATE
    // =====================================
    ...(pendingUpdateVersion ? [
      {
        label: `⬆ อัปเดตเป็น v${pendingUpdateVersion}`,
        click: () => {

          // ห้ามติดตั้งระหว่าง Ping หรือขออนุญาตเว็บไซต์
          if (busy || pairingPromptOpen || isQuitting) {
            dialog.showMessageBox({
              type: 'info',
              title: 'CCTV Ping Agent',
              message: 'ยังไม่สามารถอัปเดตได้',
              detail: 'กรุณารอให้การตรวจสอบกล้องเสร็จสิ้นก่อน',
              buttons: ['ตกลง'],
            })
            return
          }

          writeUpdateLog(
            `USER INSTALL START: ${pendingUpdateVersion}`
          )

          try {
            autoUpdater.quitAndInstall(true, true)
          } catch (error) {
            writeUpdateLog(
              `INSTALL ERROR: ${error.message}`
            )
            dialog.showErrorBox(
              'อัปเดตไม่สำเร็จ',
              error.message
            )
          }
        },
      },
      {
        type: 'separator',
      },
    ] : []),
    {
      label: 'เปิดหน้าต่างโปรแกรม',
      click: () => {
        showWindow()
      },
    },
    {
      label: approvedOrigin
        ? 'สถานะ: เว็บไซต์ได้รับอนุญาตแล้ว'
        : 'สถานะ: รอการอนุญาตเว็บไซต์',
      enabled: false,
    },
    {
      label: 'ยกเลิกสิทธิ์เว็บไซต์',
      enabled: Boolean(approvedOrigin),
      click: () => {

        if (busy) {
          dialog.showMessageBox({
            type: 'info',
            title: 'CCTV Ping Agent',
            message: 'กำลังตรวจสอบกล้อง',
            detail: 'กรุณารอให้การ Ping เสร็จสิ้นก่อน',
            buttons: ['ตกลง'],
          })
          return
        }

        resetApproval()
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'ออกจากโปรแกรม',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
}

function createTray() {
  if (tray) return

  // ไอคอนขนาดเล็ก ฝังไว้ในโปรแกรม
  // ไม่ต้องโหลดไฟล์รูปภาพเพิ่มเติม
  const iconData =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7klEQVR42mNgGAUDDBixCfKurvxPC8s+h7Zj2MdEL8txmc2ISwFX9T6qWv6t1QlrSDDRw3J0M5HtYsGnkIGBgeFLvjlFFvNMPIliNnJIYE0D1LScGDOYaGk5MWaxkGvo3qRyONt5XifZjmOhxGJ0MXIcwjTQJSETpb4nRX7oh8CAO4BQIhuSiZDkbAjzJc3LAZ6JJ/GWYKRYilwfkBQF+DRSw3KsIfCt1QmlRqSGI7C1CTBCALmRgE0hrRokjPRskmFrFzIR03CkZaOUbMvQQ4pch4/WBYzkBjk58U12CJCTM4jVw0RN39ArN1EVAADkPmOqADrkGgAAAABJRU5ErkJggg=='

  const icon =
    nativeImage.createFromDataURL(iconData)

  tray = new Tray(icon)

  tray.setToolTip(
    'CCTV Ping Agent - พร้อมใช้งาน'
  )

  updateTrayMenu()

  tray.on('double-click', () => {
    showWindow()
  })
}



/* ==========================================
   AGENT WINDOW
========================================== */

function showWindow(startHidden = false) {

  if (
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    if (!startHidden) {
      mainWindow.show()
      mainWindow.focus()
    }
    return
  }

    mainWindow = new BrowserWindow({
    width: 520,
    height: 300,
    show: false,
    resizable: false,
    autoHideMenuBar: true,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  const html = `
  <!doctype html>
  <html lang="th">
  <head>
    <meta charset="utf-8">

    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'"
    >

    <style>
      body {
        font-family: Segoe UI, Tahoma, sans-serif;
        background: #121b29;
        color: #eef3fb;
        padding: 25px;
      }

      h2 {
        margin: 0 0 12px;
        color: #ffffff;
      }

      p {
        line-height: 1.7;
      }

      small {
        color: #9cabc2;
      }
    </style>
  </head>

  <body>
    <h2>CCTV Ping Agent</h2>

    <p>
      โปรแกรมพร้อมรับคำสั่งจากเว็บแล้ว
      <br>
      กลับไปหน้า CAMERA STATUS แล้วกด
      <b>ทดสอบเชื่อมต่อ Agent</b>
    </p>

    <small>
      ใช้งานเฉพาะเครื่องนี้ • 127.0.0.1:${PORT}
      <br>
      กด X เพื่อซ่อนหน้าต่าง • โปรแกรมยังทำงานใน System Tray
    </small>
  </body>
  </html>
  `

  mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  )

    // กด X = ซ่อนหน้าต่าง แต่ Agent ยังทำงาน
    mainWindow.on('close', event => {
        if (!isQuitting) {
        event.preventDefault()
        mainWindow.hide()
        }
    })

    mainWindow.on('closed', () => {
        mainWindow = null
    })
}


/* ==========================================
   AUTO UPDATE - CHECK ONLY
   ตรวจสอบเวอร์ชัน แต่ยังไม่ดาวน์โหลด/ติดตั้ง
========================================== */

const UPDATE_CHECK_INTERVAL_MS =
  6 * 60 * 60 * 1000

let updateCheckTimer = null
let updateCheckBusy = false

// เวอร์ชันใหม่ที่ดาวน์โหลดเสร็จและพร้อมติดตั้ง
let pendingUpdateVersion = null

// ==========================================
// AUTO UPDATE FILE LOGGER
// ==========================================

function writeUpdateLog(message) {
  try {
    const logFile = path.join(
      app.getPath('userData'),
      'update.log'
    )

    fs.appendFileSync(
      logFile,
      `[${new Date().toISOString()}] ${message}\n`,
      'utf8'
    )
  } catch (err) {
    console.error(
      '[UPDATE] Cannot write log:',
      err.message
    )
  }
}

function startUpdateChecks() {

  // ใช้เฉพาะโปรแกรมที่ติดตั้งจริง
  // ไม่ตรวจอัปเดตใน npm start
  if (!app.isPackaged) {
    console.log(
      '[UPDATE] Dev mode: checking disabled'
    )
    return
  }

  if (updateCheckTimer) return

  writeUpdateLog(
    `START - Agent v${app.getVersion()}`
  )

  // ยังไม่อนุญาตให้ดาวน์โหลดหรือติดตั้ง
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false

  // =====================================
  // UPDATE EVENTS
  // =====================================

  autoUpdater.on('checking-for-update', () => {
    console.log(
      '[UPDATE] Checking for a newer version'
    )
  })

  autoUpdater.on('update-available', info => {
    writeUpdateLog(
      `UPDATE AVAILABLE: ${info.version}`
    )

    console.log(
      '[UPDATE] New version found:',
      info.version
    )
  })

  

  // =====================================
  // DOWNLOAD COMPLETE - WAIT FOR USER
  // =====================================

  autoUpdater.on('update-downloaded', info => {
    writeUpdateLog(`DOWNLOAD COMPLETE: ${info.version}`)

    console.log(
      '[UPDATE] Download completed:',
      info.version
    )

    // จำเวอร์ชันที่พร้อมติดตั้ง
    pendingUpdateVersion = info.version

    // แสดงปุ่มอัปเดตใน System Tray
    updateTrayMenu()

    writeUpdateLog(
      `UPDATE READY FOR USER: ${info.version}`
    )
  })

  autoUpdater.on('update-not-available', () => {
    console.log(
      '[UPDATE] Already on the latest version'
    )
  })

  autoUpdater.on('error', error => {
    console.warn(
      '[UPDATE] Check failed:',
      error.message
    )
  })

  // =====================================
  // CHECK VERSION
  // =====================================

  async function checkNow() {

    // ไม่ตรวจซ้อน และไม่รบกวนช่วงกำลัง Ping
    if (
      updateCheckBusy ||
      busy ||
      isQuitting
    ) {
      return
    }

    updateCheckBusy = true

    try {

      writeUpdateLog('CHECK START')

      await autoUpdater.checkForUpdates()

      writeUpdateLog('CHECK COMPLETE')

    } catch (error) {

      writeUpdateLog(
        `CHECK ERROR: ${error.stack || error.message}`
      )

      console.warn(
        '[UPDATE] Request failed:',
        error.message
      )

    } finally {

      updateCheckBusy = false

    }
  }

  // ตรวจครั้งแรกหลังเปิด Agent 45 วินาที
  setTimeout(() => {
    void checkNow()
  }, 45 * 1000)

  // ตรวจซ้ำทุก 6 ชั่วโมง
  updateCheckTimer = setInterval(() => {
    void checkNow()
  }, UPDATE_CHECK_INTERVAL_MS)
}


/* ==========================================
   WINDOWS STARTUP
========================================== */

function configureWindowsStartup() {
  // ไม่ลงทะเบียน Electron รุ่นทดสอบใน Startup
  if (
    process.platform !== 'win32' ||
    !app.isPackaged
  ) {
    return
  }

  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: ['--hidden'],
  })
}


/* ==========================================
   APPLICATION START
========================================== */

const gotLock =
  app.requestSingleInstanceLock()

if (!gotLock) {

  app.quit()

} else {

  app.on('second-instance', () => {
    showWindow()
  })

  app.whenReady().then(() => {

    if (process.platform !== 'win32') {
      dialog.showErrorBox(
        'CCTV Ping Agent',
        'โปรแกรมนี้รองรับ Windows เท่านั้น'
      )

      app.quit()
      return
    }

        // สร้างหรือโหลดตัวตนประจำเครื่องอัตโนมัติ
        try {
        deviceIdentity = ensureDeviceIdentity()

        // แสดงเฉพาะ Device ID สำหรับทดสอบ
        // ห้ามแสดงกุญแจส่วนตัวใน Console
        console.log(
            'Device ID:',
            deviceIdentity.id
        )

        } catch (err) {
        dialog.showErrorBox(
            'CCTV Ping Agent',
            'ไม่สามารถโหลดข้อมูลประจำเครื่องได้\n' +
            err.message
        )

        app.quit()
        return
        }

    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(
        PROTOCOL
      )
    }

    // ลงทะเบียนให้เปิดพร้อม Windows
    configureWindowsStartup()

    // สร้าง System Tray ก่อน
    createTray()

    // ถ้าเปิดด้วย --hidden ให้ซ่อนหน้าต่าง
    const startHidden =
      process.argv.includes('--hidden')

    showWindow(startHidden)

    // เริ่ม Local Ping Server เหมือนเดิม
      startServer()

    // เริ่มส่ง Heartbeat อัตโนมัติ
      startHeartbeat()

    // ตรวจสอบเวอร์ชันใหม่
    // ยังไม่ดาวน์โหลดและติดตั้ง
      startUpdateChecks()

  })

    app.on('before-quit', () => {
        isQuitting = true

        if (server) {
        server.close()
        }
    })

  

}