import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { supabase } from '../../lib/supabase'
import './CameraStatusReport.css'

const AGENT_URL = 'http://127.0.0.1:8765'

const AGENT_DOWNLOAD_URL =
  'https://updates.melonman.uk/download/CCTV-Ping-Agent-Setup.exe'

const NETWORKS = [
  { value: 'general', label: 'กล้องทั่วไป' },
  { value: 'checkpoint', label: 'กล้องด่าน' },
]

const SHIFTS = {
  morning: 'กะเช้า',
  afternoon: 'กะบ่าย',
  night: 'กะดึก',
}

const TEMPLATE_HEADERS = [
  'ชื่อกล้อง',
  'IP กล้อง',
  'Service Box',
  'Latitude',
  'Longitude',
]

const todayTH = () =>
  new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Bangkok',
  })

const validIPv4 = ip => {
  const a = String(ip).trim().split('.')

  return a.length === 4 &&
    a.every(v =>
      /^\d{1,3}$/.test(v) && Number(v) <= 255
    )
}

const privateIP = ip => {
  if (!validIPv4(ip)) return false

  const a = ip.split('.').map(Number)

  return (
    a[0] === 10 ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168)
  )
}

const asText = value => {
  if (value == null) return ''

  if (typeof value === 'object') {
    if ('text' in value) return String(value.text)

    if ('richText' in value) {
      return value.richText.map(x => x.text).join('')
    }

    if ('result' in value) {
      return String(value.result ?? '')
    }
  }

  return String(value).trim()
}

const newResult = (camera, ping) => {
  const level =
    !ping || ping.level === 'not_tested'
      ? 'not_tested'
      : ping.level

  return {
    ip: camera.ip,
    name: camera.name,
    service_box: camera.service_box,
    lat: camera.latitude,
    long: camera.longitude,

    ping_level: level,
    avg_ms: ping?.avgMs ?? null,
    loss_pct: ping?.lossPct ?? null,

    status:
      level === 'green'
        ? 'online'
        : level === 'unreachable'
          ? 'offline'
          : 'unknown',

    confirmed: level === 'green',
  }
}

const summarize = rows => ({
  total: rows.length,

  online: rows.filter(
    x => x.status === 'online'
  ).length,

  offline: rows.filter(
    x => x.status === 'offline'
  ).length,

  unknown: rows.filter(
    x => x.status === 'unknown'
  ).length,

  pending: rows.filter(
    x => !x.confirmed
  ).length,
})

const levelLabel = level => ({
  green: 'ปกติ',
  orange: 'เฝ้าระวัง',
  red: 'ผิดปกติ',
  unreachable: 'Timeout',
  not_tested: 'ยังไม่ Ping',
})[level] || 'ยังไม่ Ping'

/* =========================================
   MESSAGE STATUS COLORS
========================================= */

const getMessageTone = (message) => {
  if (
    /ไม่สำเร็จ|ติดต่อ Agent ไม่ได้|ต้องมีทะเบียน|กรุณา|สรุป Manual ต้อง/.test(message)
  ) {
    return 'error'
  }

  if (
    /เชื่อมต่อโปรแกรม Ping|นำเข้า\/อัปเดตทะเบียนกล้อง|แทนที่ทะเบียนกล้องสำเร็จ|Ping เสร็จแล้ว|บันทึก.*สำเร็จ/.test(message)
    ) {
    return 'success'
    }

  if (/^หยุดแล้ว/.test(message)) {
    return 'warning'
  }

  return 'info'
}

export default function CameraStatusReport({
  profile,
  shift,
}) {

  const role = String(
    profile?.role || ''
  ).toLowerCase()

  const isAllCenters = [
    'admin',
    'super',
    'supervisor',
  ].includes(role)

  const canUse =
    isAllCenters ||
    ['center', 'operator'].includes(role)

  const [centers, setCenters] =
    useState([])

  const [centerId, setCenterId] =
    useState(String(profile?.center_id || ''))

  const [network, setNetwork] =
    useState('general')

  const [reportDate, setReportDate] =
    useState(todayTH)

  const [inventory, setInventory] =
    useState([])

  const [results, setResults] =
    useState({})

  const [agentKey, setAgentKey] =
    useState('')
  
  // ตัวตน Agent สำหรับลงทะเบียนกับเซิร์ฟเวอร์
  // เก็บในหน่วยความจำเท่านั้น
  const agentIdentityRef = useRef(null)

  const [running, setRunning] =
    useState(false)

  const [completed, setCompleted] =
    useState(0)

  // =========================================
  // PING PROGRESS PERCENTAGE
  // =========================================

  const progressPercent = inventory.length > 0
    ? Math.min(
        100,
        Math.round(
          (completed / inventory.length) * 100
        )
      )
    : 0  

  const [saving, setSaving] =
    useState(false)

  const [importing, setImporting] =
    useState(false)

  const [loading, setLoading] =
    useState(false)

  const [message, setMessage] =
    useState('')

  const [savedInfo, setSavedInfo] =
    useState(null)

  const [manual, setManual] =
    useState(null)

  const [search, setSearch] =
    useState('')

  const [expandedBoxes, setExpandedBoxes] = useState({})
  const [showPendingOnly, setShowPendingOnly] = useState(false)  

  const [principal, setPrincipal] =
    useState(null)

  const [reloadIndex, setReloadIndex] =
    useState(0)

  const stopRef = useRef(false)
  const fileRef = useRef(null)


  /* =========================================
     LOAD CENTERS
  ========================================= */

  useEffect(() => {
    if (!canUse) return

    let cancelled = false

    async function loadCenters() {
      const { data, error } = await supabase
        .from('centers')
        .select('id,name')
        .order('name')

      if (cancelled) return

      if (error) {
        setMessage(
          `โหลดศูนย์ไม่สำเร็จ: ${error.message}`
        )
        return
      }

      const available = isAllCenters
        ? (data || [])
        : (data || []).filter(
            c =>
              String(c.id) ===
              String(profile?.center_id)
          )

      setCenters(available)

      setCenterId(prev =>
        available.some(
          c => String(c.id) === prev
        )
          ? prev
          : String(available[0]?.id || '')
      )
    }

    loadCenters()

    return () => {
      cancelled = true
    }
  }, [
    profile?.center_id,
    role,
    canUse,
    isAllCenters,
  ])


  /* =========================================
     LOAD INVENTORY AND SAVED REPORT
  ========================================= */

  useEffect(() => {
    if (!centerId || !shift) return

    let cancelled = false

    setLoading(true)
    setResults({})
    setManual(null)
    setSavedInfo(null)
    setCompleted(0)

    async function load() {
      const [a, b, c] = await Promise.all([

        supabase
          .from('camera_inventory')
          .select(
            'id,name,ip,service_box,latitude,longitude'
          )
          .eq('center_id', Number(centerId))
          .eq('network_type', network)
          .eq('is_active', true)
          .order('ip'),

        supabase
          .from('camera_status_daily')
          .select(
            'details,final_summary,manual_summary,is_final,updated_at'
          )
          .eq('center_id', Number(centerId))
          .eq('network_type', network)
          .eq('report_date', reportDate)
          .eq('shift', shift)
          .maybeSingle(),

        supabase
          .from('camera_status_daily')
          .select(
            'network_type,final_summary,is_final'
          )
          .eq('center_id', Number(centerId))
          .eq('report_date', reportDate)
          .eq('shift', 'morning'),

      ])

      if (cancelled) return

      setLoading(false)

      const err =
        a.error || b.error || c.error

      if (err) {
        setMessage(
          `โหลดข้อมูลไม่สำเร็จ: ${err.message}`
        )
        return
      }

      setInventory(a.data || [])

      const found = {}

      for (const item of (
        b.data?.details || []
      )) {
        found[item.ip] = item
      }

      setResults(found)

      setManual(
        b.data?.manual_summary || null
      )

      setSavedInfo(
        b.data
          ? {
              at: b.data.updated_at,
              isFinal: b.data.is_final,
            }
          : null
      )

      const totals = (c.data || [])
        .filter(x => x.is_final)
        .map(x => x.final_summary || {})

      setPrincipal(
        totals.length
          ? totals.reduce(
              (acc, x) => ({
                total:
                  acc.total +
                  (Number(x.total) || 0),

                online:
                  acc.online +
                  (Number(x.online) || 0),

                offline:
                  acc.offline +
                  (Number(x.offline) || 0),

                unknown:
                  acc.unknown +
                  (Number(x.unknown) || 0),
              }),
              {
                total: 0,
                online: 0,
                offline: 0,
                unknown: 0,
              }
            )
          : null
      )
    }

    load()

    return () => {
      cancelled = true
    }
  }, [
    centerId,
    network,
    reportDate,
    shift,
    reloadIndex,
  ])


  /* =========================================
     CALCULATE CURRENT RESULTS
  ========================================= */

  const rows = useMemo(
    () =>
      inventory.map(camera => ({
        ...camera,
        ...(
          results[camera.ip] ||
          newResult(camera, null)
        ),
      })),
    [inventory, results]
  )

  const autoSummary = useMemo(() => {
  const testedRows = rows.filter(
    r => r.ping_level !== 'not_tested'
  )

  return {
    total: inventory.length,

    online: testedRows.filter(
      r => r.status === 'online'
    ).length,

    offline: testedRows.filter(
      r => r.status === 'offline'
    ).length,

    unknown: testedRows.filter(
      r => r.status === 'unknown'
    ).length,

    pending: testedRows.filter(
      r => !r.confirmed
    ).length,
  }
}, [rows, inventory.length])

  const summary = manual
    ? {
        ...autoSummary,
        online: Number(manual.online),
        offline: Number(manual.offline),
        unknown: Number(manual.unknown),
      }
    : autoSummary

  /* =========================================
   GROUP CAMERAS BY SERVICE BOX
========================================= */

/* =========================================
   SORT IP NUMERICALLY
========================================= */

const compareCameraIp = (ipA, ipB) => {
  const a = String(ipA || '')
    .split('.')
    .map(Number)

  const b = String(ipB || '')
    .split('.')
    .map(Number)

  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) {
      return (a[i] || 0) - (b[i] || 0)
    }
  }

  return 0
}


/* =========================================
   GROUP CAMERAS BY SERVICE BOX
   SORT BY FIRST CAMERA IP
========================================= */

const boxGroups = useMemo(() => {
  const grouped = new Map()

  for (const camera of rows) {
    const serviceBox = String(
      camera.service_box || ''
    ).trim()

    const key = serviceBox
      ? `box:${serviceBox.toUpperCase()}`
      : `camera:${camera.ip}`

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        serviceBox: serviceBox || 'ไม่ระบุ Service Box',
        cameras: [],
      })
    }

    grouped.get(key).cameras.push(camera)
  }

  const keyword = search.trim().toLowerCase()

  return Array.from(grouped.values())

    .map(group => {

      // เรียงกล้องภายในตู้ตาม IP
      const cameras = [...group.cameras].sort(
        (a, b) => compareCameraIp(a.ip, b.ip)
      )

      // สีรุนแรงที่สุดในตู้
      const hasRed = cameras.some(c =>
        ['red', 'unreachable'].includes(c.ping_level)
      )

      const hasOrange = cameras.some(
        c => c.ping_level === 'orange'
      )

      const allGreen = cameras.every(
        c => c.ping_level === 'green'
      )

      const level = hasRed
        ? 'red'
        : hasOrange
          ? 'orange'
          : allGreen
            ? 'green'
            : 'idle'

      return {
        ...group,

        cameras,

        // ชื่อกล้องตัวแรกหลังเรียง IP
        name: cameras[0]?.name || '-',

        // IP กล้องตัวแรก ใช้เรียงตู้
        firstIp: cameras[0]?.ip || '',

        level,

        pending: cameras.filter(
          c =>
            c.ping_level !== 'not_tested' &&
            !c.confirmed
        ).length,
      }
    })

    // เรียงตู้ตาม IP กล้องตัวแรก
    .sort((a, b) =>
      compareCameraIp(a.firstIp, b.firstIp)
    )

    // กรองรายการ
    .filter(group => {

      if (
        showPendingOnly &&
        group.pending === 0
      ) {
        return false
      }

      if (!keyword) return true

      return (
        group.name.toLowerCase().includes(keyword) ||
        group.serviceBox.toLowerCase().includes(keyword) ||
        group.cameras.some(c =>
          `${c.name} ${c.ip}`
            .toLowerCase()
            .includes(keyword)
        )
      )
    })

}, [rows, search, showPendingOnly])


  /* =========================================
     USER CONFIRMS CAMERA STATUS
  ========================================= */

  const updateResult = (ip, status) => {
    const camera = inventory.find(
      c => c.ip === ip
    )

    if (!camera) return

    setResults(prev => ({
      ...prev,

      [ip]: {
        ...(
          prev[ip] ||
          newResult(camera, null)
        ),

        status,
        confirmed: true,
      },
    }))

    setManual(null)
    setSavedInfo(null)
  }


  /* =========================================
     DOWNLOAD EXCEL TEMPLATE
  ========================================= */

  async function downloadTemplate() {
    const { default: ExcelJS } =
      await import('exceljs')

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('CCTV Cameras')

    ws.addRow(TEMPLATE_HEADERS)

    ws.columns = [
      { width: 30 },
      { width: 22 },
      { width: 25 },
      { width: 17 },
      { width: 17 },
    ]

    ws.getRow(1).font = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
    }

    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',

      fgColor: {
        argb: 'FF9A193F',
      },
    }

    const bytes =
      await wb.xlsx.writeBuffer()

    const url = URL.createObjectURL(
      new Blob([bytes], {
        type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    )

    const a =
      document.createElement('a')

    a.href = url

    a.download =
      'CCTV_Camera_Template.xlsx'

    a.click()

    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    )
  }


  /* =========================================
     IMPORT CAMERA INVENTORY
  ========================================= */

  async function importExcel(e) {
    const file = e.target.files?.[0]

    e.target.value = ''

    if (
      !file ||
      !centerId ||
      running
    ) return

    if (file.size > 3 * 1024 * 1024) {
      setMessage(
        'Excel ต้องไม่เกิน 3 MB'
      )
      return
    }

    setImporting(true)

    try {
      const { default: ExcelJS } =
        await import('exceljs')

      const wb =
        new ExcelJS.Workbook()

      await wb.xlsx.load(
        await file.arrayBuffer()
      )

      const ws = wb.worksheets[0]

      if (!ws) {
        throw Error(
          'ไม่พบแผ่นงาน'
        )
      }

      const header = TEMPLATE_HEADERS.map(
        (_, i) =>
          asText(
            ws.getRow(1).getCell(i + 1).value
          )
      )

      if (
        header.some(
          (v, i) =>
            v !== TEMPLATE_HEADERS[i]
        )
      ) {
        throw Error(
          'หัวตารางไม่ตรงกับ Template ที่ระบบกำหนด'
        )
      }

      const items = []
      const used = new Set()

      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return

        const name = asText(
          row.getCell(1).value
        )

        const ip = asText(
          row.getCell(2).value
        )

        if (!name && !ip) return

        const serviceBox = asText(
          row.getCell(3).value
        )

        const latText = asText(
          row.getCell(4).value
        )

        const longText = asText(
          row.getCell(5).value
        )

        const lat =
          latText === ''
            ? null
            : Number(latText)

        const long =
          longText === ''
            ? null
            : Number(longText)

        if (
          !name ||
          name.length > 150 ||
          !privateIP(ip) ||
          used.has(ip) ||
          serviceBox.length > 150 ||
          (
            lat !== null &&
            (
              !Number.isFinite(lat) ||
              Math.abs(lat) > 90
            )
          ) ||
          (
            long !== null &&
            (
              !Number.isFinite(long) ||
              Math.abs(long) > 180
            )
          )
        ) {
          throw Error(
            `ข้อมูลแถว ${rowNumber} ไม่ถูกต้อง (ชื่อ/IP ส่วนตัว/พิกัด/ข้อมูลซ้ำ)`
          )
        }

        used.add(ip)

        items.push({
          center_id: Number(centerId),
          network_type: network,

          name,
          ip,

          service_box:
            serviceBox || null,

          latitude: lat,
          longitude: long,

          is_active: true,
        })
      })

      if (
        !items.length ||
        items.length > 2000
      ) {
        throw Error(
          'ต้องมีรายการกล้อง 1–2,000 ตัวต่อไฟล์'
        )
      }

      /* =========================================
    REPLACE ALL CAMERAS IN SELECTED NETWORK
    ========================================= */

    const centerName =
    centers.find(
        c => String(c.id) === String(centerId)
    )?.name || 'ศูนย์ที่เลือก'

    const networkName =
    NETWORKS.find(
        n => n.value === network
    )?.label || network

    const confirmed = window.confirm(
    `ยืนยันการแทนที่ทะเบียนกล้อง?

    ศูนย์: ${centerName}
    เครือข่าย: ${networkName}

    ทะเบียนเดิม: ${inventory.length} กล้อง
    ทะเบียนใหม่: ${items.length} กล้อง

    ระบบจะลบทะเบียนกล้องเดิมทั้งหมด
    เฉพาะศูนย์และเครือข่ายที่เลือก
    แล้วนำข้อมูลจาก Excel ใหม่มาแทนที่

    ประวัติรายงานที่เคยบันทึกจะไม่ถูกลบ

    ต้องการดำเนินการหรือไม่?`
    )

    if (!confirmed) {
    setMessage('ยกเลิกการแทนที่ทะเบียนกล้อง')
    return
    }

    const { data: replacedCount, error } =
    await supabase.rpc(
        'camera_replace_inventory',
        {
        p_center_id: Number(centerId),
        p_network_type: network,

        p_items: items.map(item => ({
            name: item.name,
            ip: item.ip,
            service_box: item.service_box,
            latitude: item.latitude,
            longitude: item.longitude,
        })),
        }
    )

    if (error) {
    throw error
    }

    setMessage(
    `แทนที่ทะเบียนกล้องสำเร็จ ${replacedCount} ตัว — ${centerName} / ${networkName}`
    )

    setResults({})
    setManual(null)
    setSavedInfo(null)
    setCompleted(0)

    setReloadIndex(
    x => x + 1
    )

    } catch (err) {
      setMessage(
        `นำเข้าไม่สำเร็จ: ${err.message}`
      )

    } finally {
      setImporting(false)
    }
  }


  /* =========================================
     CONNECT TO WINDOWS PING AGENT
  ========================================= */

  
  // =========================================
  // REGISTER AGENT WITH SUPABASE
  // =========================================

  async function callAgentRegistration(body) {
    const { data, error } = await supabase.functions.invoke(
      'agent-register',
      { body }
    )

    if (error) {
      let message = error.message

      try {
        const detail = await error.context?.json()
        message = detail?.error || detail?.message || message
      } catch {
        // ใช้ข้อความ Error เดิม
      }

      throw new Error(message)
    }

    if (!data?.success) {
      throw new Error(
        data?.error || 'Agent Registration ไม่สำเร็จ'
      )
    }

    return data
  }

  async function registerConnectedAgent(key, identity) {
    let registrationCenterId

    if (isAllCenters) {
      // Admin/Super ต้องยืนยันศูนย์ที่ติดตั้งเครื่องจริง
      // ห้ามผูกตามศูนย์ที่เลือกดูรายงานโดยไม่ยืนยัน
      const selectedCenter = centers.find(
        c => String(c.id) === String(centerId)
      )

      if (!selectedCenter) {
        throw new Error('กรุณาเลือกศูนย์สำหรับลงทะเบียนเครื่อง')
      }

      const confirmed = window.confirm(
        `ลงทะเบียนคอมพิวเตอร์เครื่องนี้กับศูนย์:\n\n` +
        `${selectedCenter.name}\n\n` +
        'โปรดยืนยันว่าเป็นศูนย์ที่ติดตั้งคอมพิวเตอร์เครื่องนี้จริง'
      )

      if (!confirmed) {
        return { cancelled: true }
      }

      registrationCenterId = Number(selectedCenter.id)
    } else {
      // เจ้าหน้าที่ทั่วไปใช้ศูนย์จากบัญชี Login เท่านั้น
      registrationCenterId = Number(profile?.center_id)
    }

    if (
      !Number.isSafeInteger(registrationCenterId) ||
      registrationCenterId <= 0
    ) {
      throw new Error('ไม่พบศูนย์ที่สังกัดสำหรับลงทะเบียน')
    }

    // 1. ขอ Challenge จาก Supabase
    const challenge = await callAgentRegistration({
      action: 'challenge',
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      agentVersion: identity.agentVersion,
      centerId: registrationCenterId,
    })

    if (
      !challenge.challengeId ||
      !challenge.nonce ||
      challenge.deviceId !== identity.deviceId
    ) {
      throw new Error('Challenge จาก Server ไม่สมบูรณ์')
    }

    // 2. ให้ Agent เซ็น Challenge ภายในเครื่อง
    const signResponse = await fetch(
      `${AGENT_URL}/sign-registration`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Key': key,
        },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          deviceId: challenge.deviceId,
          nonce: challenge.nonce,
        }),
      }
    )

    const signed = await signResponse.json()

    if (!signResponse.ok) {
      throw new Error(
        signed.error || `Agent HTTP ${signResponse.status}`
      )
    }

    if (
      signed.deviceId !== identity.deviceId ||
      signed.challengeId !== challenge.challengeId ||
      !signed.signature
    ) {
      throw new Error('ข้อมูลลายเซ็นจาก Agent ไม่ถูกต้อง')
    }

    // 3. ส่งลายเซ็นให้ Server ตรวจสอบและลงทะเบียน
    return await callAgentRegistration({
      action: 'register',
      challengeId: challenge.challengeId,
      signature: signed.signature,
    })
  }


  async function checkAgent() {
  try {
    const healthRes = await fetch(
      `${AGENT_URL}/health`,
      { cache: 'no-store' }
    )

    if (!healthRes.ok) {
      throw new Error(`HTTP ${healthRes.status}`)
    }

    const sessionRes = await fetch(
      `${AGENT_URL}/session`,
      { cache: 'no-store' }
    )

    if (!sessionRes.ok) {
      throw new Error(`HTTP ${sessionRes.status}`)
    }

    const session = await sessionRes.json()

    if (!session.key) {
      throw new Error('ไม่พบ Session Key')
    }

        // อ่านตัวตนเครื่องหลังผ่านการอนุญาต
    const identityRes = await fetch(
      `${AGENT_URL}/identity`,
      {
        cache: 'no-store',
        headers: {
          'X-Agent-Key': session.key,
        },
      }
    )

    if (!identityRes.ok) {
      throw new Error(
        `อ่านข้อมูลเครื่องไม่สำเร็จ HTTP ${identityRes.status}`
      )
    }

    const identity = await identityRes.json()

    if (
      !identity.deviceId ||
      !identity.publicKey
    ) {
      throw new Error(
        'ข้อมูลประจำเครื่องไม่สมบูรณ์'
      )
    }

    agentIdentityRef.current = {
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      agentVersion: identity.agentVersion,
    }

    setAgentKey(session.key)

        try {
      const registration = await registerConnectedAgent(
        session.key,
        agentIdentityRef.current
      )

      if (registration.cancelled) {
        setMessage(
          'เชื่อมต่อ Agent ได้แล้ว แต่ยังไม่ได้ลงทะเบียนเครื่อง'
        )
      } else {
        setMessage(
          registration.alreadyRegistered
            ? `เชื่อมต่อ Agent แล้ว • เครื่องลงทะเบียนอยู่แล้ว (${registration.status})`
            : `เชื่อมต่อ Agent แล้ว • ลงทะเบียนเครื่องสำเร็จ (${registration.status})`
        )
      }
    } catch (registrationError) {
      // แม้ลงทะเบียนไม่สำเร็จ ก็ไม่ตัดการเชื่อมต่อ Ping เดิม
      setMessage(
        `เชื่อมต่อ Agent ได้ แต่ลงทะเบียนไม่สำเร็จ: ${registrationError.message}`
      )
    }

  } catch (err) {
    agentIdentityRef.current = null
    setAgentKey('')

    setMessage(
      `ติดต่อ Agent ไม่ได้: ${err.message}`
    )
  }
}


  /* =========================================
     MANUAL PING
  ========================================= */

  async function runPing() {
    if (
      !inventory.length ||
      !agentKey ||
      running
    ) {
      setMessage(
        'ต้องมีทะเบียนกล้องและกรอกรหัส Agent ก่อน'
      )
      return
    }

    if (
      !window.confirm(
        `ตรวจ Ping ${inventory.length} กล้องของ${NETWORKS.find(n => n.value === network)?.label} จากคอมพิวเตอร์เครื่องนี้?`
      )
    ) return

    // =========================================
    // RESET PING SESSION IMMEDIATELY
    // =========================================

    stopRef.current = false

    flushSync(() => {
      // ล้างผล Ping รอบก่อน
      setResults({})

      // ล้างการปรับตัวเลขและสถานะบันทึก
      setManual(null)
      setSavedInfo(null)

      // เริ่มความคืบหน้าที่ 0
      setCompleted(0)

      // แสดงกล้องทุกตู้
      setShowPendingOnly(false)

      // แสดงแถบกำลัง Ping
      setRunning(true)

      setMessage(
        'กำลังตรวจสอบ... ยังไม่มีการบันทึกลงฐานข้อมูล'
      )
    })

    // ให้เบราว์เซอร์วาดหน้าจอที่เคลียร์แล้ว
    // ก่อนเริ่มส่งคำสั่ง Ping ชุดแรก
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
      })
    })

    
    // เรียง IP ก่อนตรวจ Ping
    const orderedCameras = [...inventory].sort(
        (a, b) => compareCameraIp(a.ip, b.ip)
    )

    const next = {}

    try {
    for (
        let i = 0;
        i < orderedCameras.length;
        i += 25
    ) {
        if (stopRef.current) break

        const batch =
        orderedCameras.slice(i, i + 25)

        const res = await fetch(
          `${AGENT_URL}/ping`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              'X-Agent-Key':
                agentKey,
            },

            body: JSON.stringify({
              ips: batch.map(
                c => c.ip
              ),
            }),
          }
        )

        if (!res.ok) {
          throw Error(
            `โปรแกรม Ping ส่ง HTTP ${res.status}`
          )
        }

        const payload =
          await res.json()

        const pingByIp =
          Object.fromEntries(
            (payload.results || [])
              .map(x => [x.ip, x])
          )

        for (const camera of batch) {
          next[camera.ip] =
            newResult(
              camera,
              pingByIp[camera.ip]
            )
        }

        setResults({
          ...next,
        })

        setCompleted(
          Math.min(
            i + batch.length,
            inventory.length
          )
        )
      }

      setMessage(
        stopRef.current
          ? 'หยุดแล้ว ผลที่ตรวจไม่ครบจะเป็นรายการรอตรวจสอบ'
          : 'Ping เสร็จแล้ว โปรดยืนยันรายการสีส้ม/แดงก่อนสรุป'
      )

    } catch (err) {
      setMessage(
        `Ping ไม่สำเร็จ: ${err.message} (ยังไม่ได้บันทึกผล)`
      )

    } finally {
      setRunning(false)
    }
  }


  /* =========================================
     SAVE CONFIRMED / DRAFT REPORT
  ========================================= */

  async function saveReport() {
    if (
      !centerId ||
      !inventory.length ||
      saving ||
      running
    ) return

    if (
      Object.keys(results).length === 0
    ) {
      setMessage(
        'กรุณา Ping หรือโหลดผลที่เคยบันทึกก่อน'
      )
      return
    }

    const raw = summarize(rows)

    if (manual) {
      const values = [
        manual.online,
        manual.offline,
        manual.unknown,
      ].map(Number)

      if (
        values.some(
          v =>
            !Number.isInteger(v) ||
            v < 0
        ) ||

        values.reduce(
          (a, b) => a + b,
          0
        ) !== rows.length ||

        !manual.reason?.trim()
      ) {
        setMessage(
          'สรุป Manual ต้องเป็นจำนวนเต็มไม่ติดลบ ผลรวมเท่ากับยอดกล้องทั้งหมด และระบุเหตุผล'
        )
        return
      }
    }

    const isFinal =
      raw.pending === 0

    if (
      !window.confirm(
        `บันทึก${SHIFTS[shift]} ${reportDate} ${NETWORKS.find(n => n.value === network)?.label}
สถานะ: ${isFinal ? 'ยืนยันครบ' : `ชั่วคราว (รอยืนยัน ${raw.pending} กล้อง)`}
การบันทึกใหม่จะทับผลของกะ/วัน/วงนี้เท่านั้น ยืนยันหรือไม่?`
      )
    ) return

    setSaving(true)

    try {
      const summaryToSave =
        manual ? summary : raw

      const { error } =
        await supabase
          .from('camera_status_daily')
          .upsert(
            {
              center_id:
                Number(centerId),

              network_type:
                network,

              report_date:
                reportDate,

              shift,

              details: rows.map(
                ({
                  ip,
                  name,
                  service_box,
                  lat,
                  long,
                  ping_level,
                  avg_ms,
                  loss_pct,
                  status,
                  confirmed,
                }) => ({
                  ip,
                  name,
                  service_box,
                  lat,
                  long,
                  ping_level,
                  avg_ms,
                  loss_pct,
                  status,
                  confirmed,
                })
              ),

              ping_summary: {
                green: rows.filter(
                  x =>
                    x.ping_level === 'green'
                ).length,

                orange: rows.filter(
                  x =>
                    x.ping_level === 'orange'
                ).length,

                red: rows.filter(
                  x =>
                    x.ping_level === 'red' ||
                    x.ping_level === 'unreachable'
                ).length,

                not_tested: rows.filter(
                  x =>
                    x.ping_level === 'not_tested'
                ).length,
              },

              final_summary:
                summaryToSave,

              manual_summary:
                manual || null,

              is_final:
                isFinal,

              updated_at:
                new Date().toISOString(),
            },
            {
              onConflict:
                'center_id,report_date,shift,network_type',
            }
          )

    if (error) throw error

    // =========================================
    // SAVE COMPLETED - KEEP AGENT CONNECTED
    // =========================================

    // ไม่เรียก /shutdown
    // ไม่ล้าง Agent Session Key
    // Agent ยังทำงานใน System Tray ตามปกติ

    setMessage(
      `บันทึก${isFinal ? 'ผลยืนยัน' : 'รายงานชั่วคราว'}สำเร็จ`
    )

    setReloadIndex(
      x => x + 1
    )  

    } catch (err) {
      setMessage(
        `บันทึกไม่สำเร็จ: ${err.message}`
      )

    } finally {
      setSaving(false)
    }
  }


  /* =========================================
     RENDER
  ========================================= */

  if (
    !canUse ||
    !SHIFTS[shift]
  ) {
    return (
      <div className="csr-root">
        บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้านี้
      </div>
    )
  }

  return (
    <div className="csr-root">

      {/* HEADER */}

      <div className="csr-title">
        <div>
          <span>
            CAMERA NETWORK STATUS
          </span>

          <h2>
            รายงานสถานะกล้อง • {SHIFTS[shift]}
          </h2>

          <p>
            ตรวจ Ping โดยเจ้าหน้าที่ •{' '}

            {shift === 'morning'
              ? 'ผลยืนยันกะเช้าเป็นสถิติหลักของวัน'
              : 'บันทึกผลติดตามแยกจากกะเช้า'}
          </p>
        </div>
      </div>


      {/* FILTERS */}

      <div className="csr-controls">

        <label>
          ศูนย์

          <select
            value={centerId}
            disabled={
              !isAllCenters ||
              running ||
              saving ||
              importing
            }
            onChange={e =>
              setCenterId(e.target.value)
            }
          >
            {centers.map(c => (
              <option
                key={c.id}
                value={c.id}
              >
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          เครือข่าย

          <select
            value={network}
            disabled={
              running ||
              saving ||
              importing
            }
            onChange={e =>
              setNetwork(e.target.value)
            }
          >
            {NETWORKS.map(n => (
              <option
                key={n.value}
                value={n.value}
              >
                {n.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          วันที่รายงาน

          <input
            type="date"
            value={reportDate}
            disabled={
              running ||
              saving ||
              importing
            }
            onChange={e =>
              setReportDate(e.target.value)
            }
          />
        </label>

      </div>


      {/* EXCEL ACTIONS */}

      <div className="csr-actions">

        <button
          type="button"
          onClick={downloadTemplate}
        >
          ดาวน์โหลด Template Excel
        </button>

        <button
          type="button"
          disabled={
            importing ||
            running ||
            !centerId
          }
          onClick={() =>
            fileRef.current?.click()
          }
        >
          {importing
            ? 'กำลังนำเข้า...'
            : 'อัปโหลดทะเบียนกล้อง'}
        </button>

        <input
          hidden
          ref={fileRef}
          type="file"
          accept=".xlsx"
          onChange={importExcel}
        />

        <small>
            อัปโหลด Excel ใหม่จะแทนที่ทะเบียนกล้องทั้งหมด
            เฉพาะศูนย์และเครือข่ายที่เลือก
        </small>

      </div>


      {/* LOCAL PING AGENT */}

      <div className="csr-agent">

        <div
          className={`csr-agent-ready ${
            agentKey
              ? 'is-connected'
              : 'is-disconnected'
          }`}
        >
          <div className="csr-agent-ready-head">
            <strong>CCTV Ping Agent</strong>

            <span
              className={`csr-agent-ready-badge ${
                agentKey
                  ? 'connected'
                  : 'disconnected'
              }`}
            >
              {agentKey
                ? 'เชื่อมต่อแล้ว'
                : 'ยังไม่เชื่อมต่อ'}
            </span>
          </div>

          <small>
            {agentKey
              ? 'พร้อมตรวจสอบกล้อง'
              : 'กรุณาเปิด Agent แล้วกดทดสอบเชื่อมต่อ'}
          </small>
        </div>

        <div className="csr-agent-actions">
          <button
            type="button"
            onClick={() => {
              window.location.assign(AGENT_DOWNLOAD_URL)
            }}
          >
            ⬇ ดาวน์โหลด CCTV Ping Agent
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href =
                'cctv-ping-agent://open'
            }}
          >
            เปิด Agent
          </button>

          <button
            type="button"
            onClick={checkAgent}
          >
            ทดสอบเชื่อมต่อ
          </button>

          <button
            type="button"
            className="csr-primary"
            disabled={
              !agentKey ||
              running ||
              loading ||
              importing ||
              saving ||
              !inventory.length
            }
            onClick={runPing}
          >
            {running
              ? 'กำลังตรวจสอบ Ping'
              : 'เริ่มตรวจสอบ Ping'}
          </button>

          {running && (
            <button
              type="button"
              onClick={() => {
                stopRef.current = true
              }}
            >
              หยุดหลังจบชุดนี้
            </button>
          )}
        </div>

        <div className="csr-agent-progress">
          {completed}/{inventory.length} กล้อง
        </div>

      </div>


      {/* MESSAGES */}

      {/* =========================================
          LIVE PING PROGRESS
      ========================================= */}

      {running && (
        <div className="csr-live-progress">

          <div className="csr-live-progress-header">

            <span
              className="csr-live-spinner"
              aria-hidden="true"
            />

            <div className="csr-live-progress-title">
              <strong>กำลังตรวจสอบสถานะกล้อง CCTV</strong>
              <small>ยังไม่มีการบันทึกลงฐานข้อมูล</small>
            </div>

            <strong className="csr-live-progress-percent">
              {progressPercent}%
            </strong>

          </div>

          <div
            className="csr-live-progress-track"
            role="progressbar"
            aria-label="ความคืบหน้าการ Ping กล้อง"
            aria-valuemin={0}
            aria-valuemax={inventory.length}
            aria-valuenow={completed}
          >
            <div
              className="csr-live-progress-fill"
              style={{
                width: `${progressPercent}%`,
              }}
            />
          </div>

          <div className="csr-live-progress-footer">
            <span>
              ตรวจสอบแล้ว {completed} / {inventory.length} กล้อง
            </span>

            <span className="csr-live-progress-working">
              กำลัง Ping...
            </span>
          </div>

        </div>
      )}


      {/* =========================================
          NORMAL STATUS MESSAGE
      ========================================= */}

      {!running && !!message && (
        <div
          role="status"
          className={`csr-message csr-message--${getMessageTone(message)}`}
        >
          <span className="csr-message-icon">
            {getMessageTone(message) === 'success'
              ? '✓'
              : getMessageTone(message) === 'error'
                ? '✕'
                : getMessageTone(message) === 'warning'
                  ? '!'
                  : 'ℹ'}
          </span>

          <span>{message}</span>
        </div>
      )}

      {savedInfo && (
        <p className="csr-hint">
          ผลที่บันทึกล่าสุด:{' '}

          {new Date(
            savedInfo.at
          ).toLocaleString('th-TH')}

          {' • '}

          {savedInfo.isFinal
            ? 'ยืนยันแล้ว'
            : 'รายงานชั่วคราว'}
        </p>
      )}

      {principal && (
        <p className="csr-hint">
          สถิติหลักกะเช้าวันนี้
          (รวมวงที่บันทึกแบบยืนยันแล้ว):

          {' '}ทั้งหมด {principal.total}
          {' • '}ติด {principal.online}
          {' • '}ดับ {principal.offline}
          {' • '}ตรวจสอบไม่ได้ {principal.unknown}
        </p>
      )}


      {/* SUMMARY CARDS */}

      <div className="csr-stats">

        {[
          [
            'กล้องทั้งหมด',
            summary.total,
            '',
          ],
          [
            'กล้องติด',
            summary.online,
            'green',
          ],
          [
            'กล้องดับ',
            summary.offline,
            'red',
          ],
          [
            'ตรวจสอบไม่ได้',
            summary.unknown,
            'orange',
          ],
          [
            'รอยืนยันรายตัว',
            autoSummary.pending,
            'orange',
          ],
        ].map(([label, value, cls]) => (

          <div
            className={`csr-stat ${cls}`}
            key={label}
          >
            <small>
              {label}
            </small>

            <strong>
              {value}
            </strong>
          </div>

        ))}

      </div>


      {/* CAMERA TABLE */}

      <div className="csr-table-head">

        <h3>
          รายการกล้องและการยืนยันสถานะ
        </h3>

        <input
          aria-label="ค้นหากล้อง"
          placeholder="ค้นหาชื่อกล้อง / IP / Service Box"
          value={search}
          onChange={e =>
            setSearch(e.target.value)
          }
        />

      </div>


      <div className="csr-table-scroll">

        {/* =========================================
            SERVICE BOX GROUPED VIEW
        ========================================= */}

        <div className="csr-box-toolbar">

        <label>
            <input
            type="checkbox"
            checked={showPendingOnly}
            onChange={e =>
                setShowPendingOnly(e.target.checked)
            }
            />
            แสดงเฉพาะตู้ที่มีรายการรอยืนยัน
            ({autoSummary.pending} กล้อง)
        </label>

        <div className="csr-box-toolbar-actions">

            <button
            type="button"
            onClick={() =>
                setExpandedBoxes(
                Object.fromEntries(
                    boxGroups.map(g => [g.key, true])
                )
                )
            }
            >
            ขยายทั้งหมด
            </button>

            <button
            type="button"
            onClick={() => setExpandedBoxes({})}
            >
            ยุบทั้งหมด
            </button>

        </div>

        </div>


        <div className="csr-box-list">

        {boxGroups.map(group => {

            const isOpen = !!expandedBoxes[group.key]

            const levelText = {
            green: 'ปกติ',
            orange: 'เฝ้าระวัง',
            red: 'ผิดปกติ',
            idle: 'ยังไม่ตรวจครบ',
            }[group.level]

            return (

            <div
                key={group.key}
                className={`csr-box-item level-${group.level}`}
            >

                {/* SERVICE BOX HEADER */}

                <button
                type="button"
                className="csr-box-toggle"
                aria-expanded={isOpen}
                onClick={() =>
                    setExpandedBoxes(prev => ({
                    ...prev,
                    [group.key]: !prev[group.key],
                    }))
                }
                >

                <span className="csr-box-chevron">
                    {isOpen ? '⌄' : '›'}
                </span>

                <div className="csr-box-info">

                    <strong>
                    {group.name}
                    </strong>

                    <small>
                    {group.serviceBox}
                    {' • '}
                    {group.cameras.length} กล้อง
                    </small>

                </div>

                <div className="csr-box-right">

                    <span
                    className={`csr-box-badge ${group.level}`}
                    >
                    {levelText}
                    </span>

                    {group.pending > 0 && (
                    <small className="csr-box-pending">
                        รอยืนยัน {group.pending} ตัว
                    </small>
                    )}

                </div>

                </button>


                {/* CAMERAS INSIDE SERVICE BOX */}

                {isOpen && (

                <div className="csr-box-details">

                    <div className="csr-table-scroll">

                    <table className="csr-table">

                        <thead>
                        <tr>
                            <th>ชื่อกล้อง / IP / พิกัด</th>
                            <th>ผล Ping</th>
                            <th>Time / Loss</th>
                            <th>สถานะสรุป</th>
                            <th>การยืนยัน</th>
                        </tr>
                        </thead>

                        <tbody>

                        {group.cameras.map(r => (

                            <tr key={r.ip}>

                            <td>
                                <b>{r.name}</b>

                                <small>
                                IP: {r.ip}
                                </small>

                                <small>
                                Lat: {r.latitude ?? r.lat ?? '-'}
                                {' | '}
                                Long: {r.longitude ?? r.long ?? '-'}
                                </small>
                            </td>

                            <td>
                                <span
                                className={`csr-level ${r.ping_level}`}
                                >
                                {levelLabel(r.ping_level)}
                                </span>
                            </td>

                            <td>
                                {r.avg_ms == null
                                ? '-'
                                : `${r.avg_ms} ms`}

                                <small>
                                Loss{' '}
                                {r.loss_pct == null
                                    ? '-'
                                    : `${r.loss_pct}%`}
                                </small>
                            </td>

                            <td>
                                <select
                                disabled={running}
                                value={r.status}
                                onChange={e =>
                                    updateResult(
                                    r.ip,
                                    e.target.value
                                    )
                                }
                                >
                                <option value="online">
                                    กล้องติด / ปกติ
                                </option>

                                <option value="offline">
                                    กล้องดับ
                                </option>

                                <option value="unknown">
                                    ตรวจสอบไม่ได้
                                </option>
                                </select>
                            </td>

                            <td>

                                {r.confirmed ? (

                                <span className="csr-yes">
                                    ยืนยันแล้ว
                                </span>

                                ) : (

                                <button
                                    type="button"
                                    disabled={
                                    running ||
                                    r.ping_level === 'not_tested'
                                    }
                                    onClick={() =>
                                    updateResult(
                                        r.ip,
                                        r.status
                                    )
                                    }
                                >
                                    ยืนยันผล
                                </button>

                                )}

                            </td>

                            </tr>

                        ))}

                        </tbody>

                    </table>

                    </div>

                </div>

                )}

            </div>

            )
        })}

        {boxGroups.length === 0 && (
            <div className="csr-box-empty">
            ไม่พบรายการตู้กล้องที่ตรงกับเงื่อนไข
            </div>
        )}

        </div>

      </div>

      <p className="csr-hint">
        แสดงรายการแยกตาม Service Box •
        กดชื่อตู้เพื่อเปิด/ปิดรายละเอียดกล้อง •
        ค่า Lat/Long แสดงแยกตามกล้อง •
        ผล Ping สีส้ม/แดงต้องตรวจสอบและยืนยัน
      </p>


      {/* MANUAL SUMMARY */}

      <div className="csr-manual">

        <label>
          <input
            type="checkbox"
            disabled={running}
            checked={!!manual}
            onChange={e =>
              setManual(
                e.target.checked
                  ? {
                      online:
                        autoSummary.online,

                      offline:
                        autoSummary.offline,

                      unknown:
                        autoSummary.unknown,

                      reason: '',
                    }
                  : null
              )
            }
          />

          ปรับตัวเลขสรุป Manual
          (ผล Ping รายตัวยังถูกเก็บไว้)
        </label>

        {manual && (

          <div className="csr-controls">

            {[
              ['online', 'กล้องติด'],
              ['offline', 'กล้องดับ'],
              ['unknown', 'ตรวจสอบไม่ได้'],
            ].map(([key, label]) => (

              <label key={key}>
                {label}

                <input
                  inputMode="numeric"
                  type="text"
                  value={manual[key]}
                  onChange={e =>
                    setManual(m => ({
                      ...m,

                      [key]:
                        e.target.value,
                    }))
                  }
                />
              </label>

            ))}

            <label className="csr-wide">
              เหตุผลที่ปรับยอด

              <input
                value={manual.reason}
                onChange={e =>
                  setManual(m => ({
                    ...m,

                    reason:
                      e.target.value,
                  }))
                }
                placeholder="จำเป็นต้องระบุ"
              />
            </label>

          </div>

        )}

      </div>


      {/* SAVE */}

      <div className="csr-footer">

        <span>
          {autoSummary.pending
            ? `ยังไม่ยืนยัน ${autoSummary.pending} ตัว — บันทึกได้เป็นฉบับชั่วคราว`
            : 'ตรวจสอบครบทุกรายการ — พร้อมบันทึกผลยืนยัน'}
        </span>

        <button
          type="button"
          className="csr-primary"
          disabled={
            loading ||
            running ||
            saving ||
            importing ||
            !inventory.length
          }
          onClick={saveReport}
        >
          {saving
            ? 'กำลังบันทึก...'
            : 'ยืนยันและบันทึกผล'}
        </button>

      </div>

    </div>
  )
}