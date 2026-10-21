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

const EMPTY_OVERVIEW = {
  total: 0,
  online: 0,
  offline: 0,
  unknown: 0,
  green: 0,
  yellow: 0,
  orange: 0,
  red: 0,
  pending: 0,
  notTested: 0,
  hasReport: false,
}

// รองรับทะเบียนมากกว่า 1,000 กล้อง
async function fetchCameraInventory(center, type) {
  const items = []

  for (let offset = 0; offset < 2000; offset += 1000) {
    const { data, error } = await supabase
      .from('camera_inventory')
      .select('id,name,ip,service_box,latitude,longitude')
      .eq('center_id', Number(center))
      .eq('network_type', type)
      .eq('is_active', true)
      .order('id')
      .range(offset, offset + 999)

    if (error) {
      return { data: null, error }
    }

    items.push(...(data || []))

    if ((data || []).length < 1000) break
  }

  return { data: items, error: null }
}

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

// ผล Agent รุ่นเดิม: green=ปกติ, orange=เฝ้าระวัง,
// red=Ping ตอบแต่ผิดปกติ, unreachable=Ping ไม่ได้
// แปลงเป็นสีใหม่ตามข้อกำหนด โดยเก็บค่าเดิมไว้ตรวจสอบย้อนหลัง
const normalizeAgentLevel = ping => {
  if (!ping || ping.level === 'not_tested') return 'not_tested'

  const loss = Number(ping.lossPct)
  if (
    ping.level === 'unreachable' ||
    (ping.lossPct != null && Number.isFinite(loss) && loss >= 100)
  ) return 'unreachable'

  if (ping.level === 'green') return 'green'
  if (ping.level === 'orange') return 'yellow'
  if (ping.level === 'red') return 'orange'

  return 'not_tested'
}

const newResult = (camera, ping) => {
  const level = normalizeAgentLevel(ping)

  return {
    ip: camera.ip,
    name: camera.name,
    service_box: camera.service_box,
    lat: camera.latitude,
    long: camera.longitude,

    // ผลวิเคราะห์จาก Ping (ห้ามแก้ทับด้วยผลที่เจ้าหน้าที่ยืนยัน)
    ping_source_level: ping?.level ?? null,
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

// สีที่หน้าจอแสดงหลังเจ้าหน้าที่ตรวจสอบจริง
// ผล Ping ต้นทางยังคงอยู่ใน ping_level / ping_source_level
const displayPingLevel = row => {
  if (row.confirmed) {
    if (row.status === 'online') return 'green'
    if (row.status === 'offline') return 'unreachable'
    if (row.status === 'unknown') return 'orange'
  }

  // แปลงรายงานเก่าที่บันทึกก่อนเปลี่ยนระบบสี
  if (!row.ping_source_level) {
    if (row.ping_level === 'orange') return 'yellow'
    if (row.ping_level === 'red') return 'orange'
  }

  return row.ping_level || 'not_tested'
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
  yellow: 'ตรวจสอบ',
  orange: 'ผิดปกติ',
  red: 'กล้องดับ',
  unreachable: 'กล้องดับ',
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
    /เชื่อมต่อโปรแกรม Ping|นำเข้า\/อัปเดตทะเบียนกล้อง|แทนที่ทะเบียนกล้องสำเร็จ|Ping เสร็จแล้ว|Ping ใหม่สำเร็จ|บันทึก.*สำเร็จ/.test(message)
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

  // ใช้เฉพาะการ Ping ใหม่ทีละกล้อง
  const [pingingIp, setPingingIp] = useState('')

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

  const [networkOverview, setNetworkOverview] = useState({
    general: { ...EMPTY_OVERVIEW },
    checkpoint: { ...EMPTY_OVERVIEW },
  })

  const [loadedScope, setLoadedScope] = useState('')

  const scopeKey =
    `${centerId}|${network}|${reportDate}|${shift}`
  const currentScopeRef = useRef(scopeKey)
  currentScopeRef.current = scopeKey

  const selectedLoaded =
    loadedScope === scopeKey && !loading  

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
    setLoadedScope('')
    setInventory([])
    setPrincipal(null)
    setResults({})
    setManual(null)
    setSavedInfo(null)
    setCompleted(0)

    async function load() {
      const [a, b, c] = await Promise.all([

        fetchCameraInventory(centerId, network),

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
      setLoadedScope(
        `${centerId}|${network}|${reportDate}|${shift}`
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
    NETWORK OVERVIEW - BOTH NETWORKS
  ========================================= */

  useEffect(() => {
    if (!centerId || !shift) return

    let cancelled = false

    setNetworkOverview({
      general: { ...EMPTY_OVERVIEW },
      checkpoint: { ...EMPTY_OVERVIEW },
    })

    async function loadNetworkOverview() {
      const center = Number(centerId)

      const [generalCount, checkpointCount, reports] =
        await Promise.all([
          supabase
            .from('camera_inventory')
            .select('id', { count: 'exact', head: true })
            .eq('center_id', center)
            .eq('network_type', 'general')
            .eq('is_active', true),

          supabase
            .from('camera_inventory')
            .select('id', { count: 'exact', head: true })
            .eq('center_id', center)
            .eq('network_type', 'checkpoint')
            .eq('is_active', true),

          supabase
            .from('camera_status_daily')
            .select(
              'network_type,details,final_summary,manual_summary'
            )
            .eq('center_id', center)
            .eq('report_date', reportDate)
            .eq('shift', shift),
        ])

      if (cancelled) return

      const error =
        generalCount.error ||
        checkpointCount.error ||
        reports.error

      if (error) {
        setMessage(
          `โหลดสรุปสองเครือข่ายไม่สำเร็จ: ${error.message}`
        )
        return
      }

      const counts = {
        general: generalCount.count ?? 0,
        checkpoint: checkpointCount.count ?? 0,
      }

      const next = {}

      for (const item of NETWORKS) {
        const report = (reports.data || []).find(
          r => r.network_type === item.value
        )

        const details = Array.isArray(report?.details)
          ? report.details
          : []

        const tested = details.filter(
          r => r.ping_level &&
              r.ping_level !== 'not_tested'
        )

        const savedSummary =
          report?.manual_summary ||
          report?.final_summary

        const colors = { green: 0, yellow: 0, orange: 0, red: 0 }
        for (const camera of details) {
          const level = displayPingLevel(camera)
          const key = level === 'unreachable' ? 'red' : level
          if (key in colors) colors[key] += 1
        }

        next[item.value] = {
          ...colors,
          total: counts[item.value],

          online: Number(
            savedSummary?.online ??
            tested.filter(r => r.status === 'online').length
          ) || 0,

          offline: Number(
            savedSummary?.offline ??
            tested.filter(r => r.status === 'offline').length
          ) || 0,

          unknown: Number(
            savedSummary?.unknown ??
            tested.filter(r => r.status === 'unknown').length
          ) || 0,

          pending: tested.filter(
            r => !r.confirmed
          ).length,

          notTested: Math.max(
            0,
            counts[item.value] - tested.length
          ),

          hasReport: Boolean(report),
        }
      }

      setNetworkOverview(next)
    }

    loadNetworkOverview()

    return () => {
      cancelled = true
    }
  }, [
    centerId,
    reportDate,
    shift,
    reloadIndex,
  ])


  /* =========================================
     CALCULATE CURRENT RESULTS
  ========================================= */

  const rows = useMemo(
    () => inventory.map(camera => {
      const row = {
        ...camera,
        ...(results[camera.ip] || newResult(camera, null)),
      }

      return { ...row, display_level: displayPingLevel(row) }
    }),
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

    const notTestedCount = rows.filter(
      r => r.ping_level === 'not_tested'
    ).length

    function chooseNetwork(value) {
  if (
    value === network ||
    running ||
    !!pingingIp ||
    saving ||
    importing ||
    loading
  ) return

  const hasUnsavedResults =
    Object.keys(results).length > 0 &&
    !savedInfo

  if (hasUnsavedResults) {
    const confirmed = window.confirm(
      'มีผล Ping ที่ยังไม่ได้บันทึก\n\n' +
      'หากเปลี่ยนประเภทกล้อง ผลที่ยังไม่ได้บันทึกจะหายไป\n\n' +
      'ต้องการเปลี่ยนประเภทกล้องหรือไม่?'
    )

    if (!confirmed) return
  }

  setNetwork(value)
  setSearch('')
  setExpandedBoxes({})
  setShowPendingOnly(false)
}

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

      // สีเข้มที่สุดในตู้จากผล Ping + การยืนยันของเจ้าหน้าที่
      const levels = cameras.map(c => c.display_level)
      const level = levels.includes('unreachable') || levels.includes('red')
        ? 'red'
        : levels.includes('orange')
          ? 'orange'
          : levels.includes('yellow')
            ? 'yellow'
            : levels.every(x => x === 'green')
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

    if (!camera || running || pingingIp || saving || importing) return

    // เลือก "กล้องปกติ" จากรายการเหลือง => แสดงสีเขียวทันที
    // ยืนยัน "ผิดปกติ" => สีส้ม, ยืนยัน "กล้องดับ" => สีแดง
    // ไม่แก้ข้อมูลผล Ping ดิบ เพื่อรักษาหลักฐานเดิม
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
    TWO-SHEET EXCEL TEMPLATE
  ========================================= */

  async function downloadTemplate() {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()

    for (const item of NETWORKS) {
      const ws = wb.addWorksheet(item.label)

      ws.addRow(TEMPLATE_HEADERS)

      ws.columns = [
        { width: 34 },
        { width: 21 },
        { width: 28 },
        { width: 18 },
        { width: 18 },
      ]

      ws.views = [
        { state: 'frozen', ySplit: 1 },
      ]

      ws.autoFilter = {
        from: 'A1',
        to: 'E1',
      }

      const header = ws.getRow(1)

      header.height = 27
      header.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
      }

      header.alignment = {
        vertical: 'middle',
        horizontal: 'center',
      }

      header.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: item.value === 'general'
            ? 'FF9A193F'
            : 'FF147D91',
        },
      }
    }

    const bytes = await wb.xlsx.writeBuffer()

    const url = URL.createObjectURL(
      new Blob([bytes], {
        type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    )

    const a = document.createElement('a')
    a.href = url
    a.download = 'CCTV_Camera_2_Networks_Template.xlsx'
    a.click()

    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /* =========================================
    IMPORT TWO NETWORKS FROM ONE EXCEL
  ========================================= */

  async function importExcel(e) {
    const file = e.target.files?.[0]
    e.target.value = ''

    if (
      !file ||
      !centerId ||
      running ||
      !!pingingIp ||
      saving ||
      importing
    ) return

    if (file.size > 3 * 1024 * 1024) {
      setMessage('Excel ต้องไม่เกิน 3 MB')
      return
    }

    setImporting(true)

    const completedNetworks = []

    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()

      await wb.xlsx.load(await file.arrayBuffer())

      const parsed = {}

      for (const item of NETWORKS) {
        const ws = wb.getWorksheet(item.label)

        if (!ws) {
          throw new Error(
            `ไม่พบชีต "${item.label}" กรุณาใช้ Template ใหม่`
          )
        }

        const headers = TEMPLATE_HEADERS.map(
          (_, index) => asText(
            ws.getRow(1).getCell(index + 1).value
          )
        )

        if (headers.some(
          (value, index) => value !== TEMPLATE_HEADERS[index]
        )) {
          throw new Error(
            `หัวตารางชีต "${item.label}" ไม่ตรงกับ Template`
          )
        }

        const items = []
        const used = new Set()

        ws.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return

          const name = asText(row.getCell(1).value)
          const ip = asText(row.getCell(2).value)
          const serviceBox = asText(row.getCell(3).value)
          const latText = asText(row.getCell(4).value)
          const longText = asText(row.getCell(5).value)

          // ข้ามแถวว่างเท่านั้น
          if (
            !name &&
            !ip &&
            !serviceBox &&
            !latText &&
            !longText
          ) return

          const lat = latText === ''
            ? null
            : Number(latText)

          const long = longText === ''
            ? null
            : Number(longText)

          const invalid =
            !name ||
            name.length > 150 ||
            !privateIP(ip) ||
            used.has(ip) ||
            serviceBox.length > 150 ||
            (
              lat !== null &&
              (!Number.isFinite(lat) || Math.abs(lat) > 90)
            ) ||
            (
              long !== null &&
              (!Number.isFinite(long) || Math.abs(long) > 180)
            )

          if (invalid) {
            throw new Error(
              `ชีต "${item.label}" แถว ${rowNumber} ข้อมูลไม่ถูกต้องหรือ IP ซ้ำ`
            )
          }

          used.add(ip)

          items.push({
            name,
            ip,
            service_box: serviceBox || null,
            latitude: lat,
            longitude: long,
          })

          if (items.length > 2000) {
            throw new Error(
              `ชีต "${item.label}" ต้องไม่เกิน 2,000 กล้อง`
            )
          }
        })

        parsed[item.value] = items
      }

      // ชีตว่างจะไม่ลบทะเบียนเดิม
      const networksToReplace = NETWORKS.filter(
        item => parsed[item.value].length > 0
      )

      if (networksToReplace.length === 0) {
        throw new Error(
          'ไม่พบข้อมูลกล้องในทั้งสองชีต'
        )
      }

      const selectedCenter = centers.find(
        c => String(c.id) === String(centerId)
      )

      const centerName =
        selectedCenter?.name || 'ศูนย์ที่เลือก'

      const detail = NETWORKS.map(item => {
        const amount = parsed[item.value].length
        const oldAmount =
          networkOverview[item.value]?.total ?? 0

        return amount > 0
          ? `${item.label}: ${oldAmount} → ${amount} กล้อง`
          : `${item.label}: ชีตว่าง (คงทะเบียนเดิม)`
      }).join('\n')

      const confirmed = window.confirm(
        `ยืนยันนำเข้าทะเบียนกล้องจาก Excel?\n\n` +
        `ศูนย์: ${centerName}\n\n` +
        `${detail}\n\n` +
        `ระบบจะแทนที่ทะเบียนเดิมเฉพาะชีตที่มีข้อมูล\n` +
        `ชีตว่างจะไม่เปลี่ยนทะเบียนเดิม\n\n` +
        `การแทนที่แต่ละเครือข่ายเป็นคนละรายการบันทึก\n` +
        `หากรายการใดผิดพลาด รายการก่อนหน้าอาจสำเร็จแล้ว\n\n` +
        `ประวัติรายงานเดิมจะไม่ถูกลบ\n\n` +
        `ต้องการดำเนินการหรือไม่?`
      )

      if (!confirmed) {
        setMessage('ยกเลิกการนำเข้าทะเบียนกล้อง')
        return
      }

      // ใช้ RPC เดิมทีละเครือข่าย
      for (const item of networksToReplace) {
        const { error } = await supabase.rpc(
          'camera_replace_inventory',
          {
            p_center_id: Number(centerId),
            p_network_type: item.value,
            p_items: parsed[item.value],
          }
        )

        if (error) {
          throw new Error(
            `${item.label}: ${error.message}`
          )
        }

        completedNetworks.push(item.label)
      }

      setMessage(
        `แทนที่ทะเบียนกล้องสำเร็จ: ${completedNetworks.join(', ')}`
      )
    } catch (err) {
      const partial = completedNetworks.length
        ? `สำเร็จแล้ว: ${completedNetworks.join(', ')} • `
        : ''

      setMessage(
        `${partial}นำเข้าไม่สำเร็จ: ${err.message}`
      )
    } finally {
      if (completedNetworks.length) {
        setResults({})
        setManual(null)
        setSavedInfo(null)
        setCompleted(0)
        setReloadIndex(x => x + 1)
      }

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
      !selectedLoaded ||
      running ||
      !!pingingIp
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
          : 'Ping เสร็จแล้ว โปรดยืนยันกล้องสีเหลือง/ส้ม/แดงก่อนสรุป'
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
     RE-PING A SINGLE CAMERA (NO OTHER RESULTS RESET)
  ========================================= */

  async function pingOneCamera(ip) {
    if (
      running || pingingIp || saving || importing || loading ||
      !agentKey || !selectedLoaded
    ) return

    const camera = inventory.find(item => item.ip === ip)
    if (!camera) return
    const requestedScope = scopeKey

    setPingingIp(ip)
    setMessage(`กำลัง Ping ใหม่: ${camera.name} (${ip})`)

    try {
      const response = await fetch(`${AGENT_URL}/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Key': agentKey,
        },
        body: JSON.stringify({ ips: [ip] }),
      })

      if (!response.ok) {
        throw new Error(`Agent ส่ง HTTP ${response.status}`)
      }

      const payload = await response.json()
      const ping = (payload.results || []).find(item => item.ip === ip)
      if (!ping) {
        throw new Error('Agent ไม่ส่งผล Ping ของกล้องที่เลือก')
      }

      // หากผู้ใช้เปลี่ยนกะจากหน้าหลักระหว่างรอผล ให้ทิ้งผลที่ข้ามกะ
      if (currentScopeRef.current !== requestedScope) return

      // เปลี่ยนผลเฉพาะ IP นี้ ไม่แตะผลของกล้องตัวอื่น
      setResults(prev => ({
        ...prev,
        [ip]: newResult(camera, ping),
      }))
      setManual(null)
      setSavedInfo(null)
      setMessage(`Ping ใหม่สำเร็จ: ${camera.name} • ${levelLabel(normalizeAgentLevel(ping))} (ยังไม่ได้บันทึก)`)
    } catch (error) {
      // กรณีติดต่อ Agent ไม่ได้ ไม่เขียนทับผลเดิม
      if (currentScopeRef.current === requestedScope) {
        setMessage(`Ping กล้อง ${camera.name} ไม่สำเร็จ: ${error.message}`)
      }
    } finally {
      setPingingIp('')
    }
  }

  /* =========================================
     SAVE CONFIRMED / DRAFT REPORT
  ========================================= */

  async function saveReport() {
    if (
      !centerId ||
      !inventory.length ||
      !selectedLoaded ||
      saving ||
      running ||
      !!pingingIp
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
      raw.pending === 0 &&
      notTestedCount === 0

    if (
      !window.confirm(
        `บันทึก${SHIFTS[shift]} ${reportDate} ${NETWORKS.find(n => n.value === network)?.label}
สถานะ: ${isFinal ? 'ยืนยันครบ' : `ชั่วคราว (ยังไม่ Ping ${notTestedCount} กล้อง / รอยืนยัน ${autoSummary.pending} กล้อง)`}
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
                  ping_source_level,
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
                  ping_source_level,
                  avg_ms,
                  loss_pct,
                  status,
                  confirmed,
                })
              ),

              ping_summary: {
                green: rows.filter(x => x.display_level === 'green').length,
                yellow: rows.filter(x => x.display_level === 'yellow').length,
                orange: rows.filter(x => x.display_level === 'orange').length,
                red: rows.filter(x => ['unreachable', 'red'].includes(x.display_level)).length,
                not_tested: rows.filter(x => x.display_level === 'not_tested').length,
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
    <div className={`csr-root${pingingIp ? ' csr-ping-single-active' : ''}`}>

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

      <div className="csr-controls csr-main-filters">

        <label>
          ศูนย์

          <select
            value={centerId}
            disabled={
              !isAllCenters ||
              running ||
              !!pingingIp ||
              saving ||
              importing ||
              loading
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
          วันที่รายงาน

          <input
            type="date"
            value={reportDate}
            disabled={
              running ||
              !!pingingIp ||
              saving ||
              importing ||
              loading
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
            !!pingingIp ||
            saving ||
            loading ||
            !centerId
          }
          onClick={() =>
            fileRef.current?.click()
          }
        >
          {importing
            ? 'กำลังนำเข้า...'
            : 'อัปโหลดกล้องทั้งหมด'}
        </button>

        <input
          hidden
          ref={fileRef}
          type="file"
          accept=".xlsx"
          onChange={importExcel}
        />

        <small>
          Excel ไฟล์เดียวมี 2 ชีต: กล้องทั่วไป / กล้องด่าน
          • ชีตที่มีข้อมูลจะแทนที่ทะเบียนเดิม
          • ชีตว่างจะไม่เปลี่ยนข้อมูล
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
          {' • '}ตรวจสอบ/ผิดปกติ {principal.unknown}
        </p>
      )}


      {/* BOTH NETWORKS SUMMARY */}

        <div className="csr-network-overview">
          {NETWORKS.map(item => {
            const active = item.value === network

            const saved =
              networkOverview[item.value] ||
              EMPTY_OVERVIEW

            const stat = active && selectedLoaded
              ? {
                  ...saved,
                  total: inventory.length,
                  online: summary.online,
                  offline: summary.offline,
                  unknown: summary.unknown,
                  green: rows.filter(r => r.display_level === 'green').length,
                  yellow: rows.filter(r => r.display_level === 'yellow').length,
                  orange: rows.filter(r => r.display_level === 'orange').length,
                  red: rows.filter(r => ['unreachable', 'red'].includes(r.display_level)).length,
                  pending: autoSummary.pending,
                  notTested: notTestedCount,
                  hasReport:
                    !!savedInfo ||
                    Object.keys(results).length > 0,
                }
              : saved

            const metrics = [
              ['ทั้งหมด', stat.total, 'total'],
              ['ปกติ', stat.green, 'green'],
              ['ตรวจสอบ', stat.yellow, 'yellow'],
              ['ผิดปกติ', stat.orange, 'orange'],
              ['กล้องดับ', stat.red, 'red'],
              ['ยังไม่ Ping', stat.notTested, 'muted'],
            ]

            return (
              <div
                key={item.value}
                className={`csr-network-card ${
                  active ? 'is-active' : ''
                }`}
              >
                <div className="csr-network-card-header">
                  <div>
                    <strong>{item.label}</strong>
                    {stat.pending > 0 && (
                      <small className="csr-network-pending">
                        รอเจ้าหน้าที่ยืนยัน {stat.pending} กล้อง
                      </small>
                    )}
                    <small>
                      {active && selectedLoaded
                        ? 'ข้อมูลของเครือข่ายที่กำลังแสดง'
                        : stat.hasReport
                          ? 'ผลจากรายงานที่บันทึกไว้'
                          : 'ยังไม่มีผลรายงานในกะนี้'}
                    </small>
                  </div>

                  <span className="csr-network-total">
                    {stat.total.toLocaleString('th-TH')} กล้อง
                  </span>
                </div>

                <div className="csr-network-metrics">
                  {metrics.map(([label, value, tone]) => (
                    <div
                      className={`csr-network-metric ${tone}`}
                      key={label}
                    >
                      <small>{label}</small>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>


      {/* CAMERA NETWORK TABS */}

        <div
          className="csr-network-tabs"
          role="tablist"
          aria-label="เลือกประเภทกล้อง"
        >
          {NETWORKS.map(item => {
            const selected = network === item.value

            const amount =
              selected && selectedLoaded
                ? inventory.length
                : networkOverview[item.value]?.total ?? 0

            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? 'is-active' : ''}
                disabled={
                  running ||
                  !!pingingIp ||
                  saving ||
                  importing ||
                  loading
                }
                onClick={() => chooseNetwork(item.value)}
              >
                <span>{item.label}</span>
                <strong>{amount}</strong>
              </button>
            )
          })}
        </div>

        {/* PING CONTROLS FOR SELECTED NETWORK */}

        <div className="csr-network-runbar">
          <div className="csr-network-runinfo">
            <strong>
              {NETWORKS.find(
                item => item.value === network
              )?.label}
            </strong>

            <small>
              จำนวน {inventory.length} กล้อง
              {' • '}
              ตรวจสอบแยกจากอีกเครือข่าย
            </small>
          </div>

          <div className="csr-network-runbuttons">
            <button
              type="button"
              className="csr-primary"
              disabled={
                !agentKey ||
                !selectedLoaded ||
                !inventory.length ||
                running ||
                !!pingingIp ||
                loading ||
                importing ||
                saving
              }
              onClick={runPing}
            >
              {running
                ? `กำลัง Ping ${
                    NETWORKS.find(
                      item => item.value === network
                    )?.label
                  }`
                : `▶ Ping ${
                    NETWORKS.find(
                      item => item.value === network
                    )?.label
                  }`}
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
        </div>

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
            yellow: 'ตรวจสอบ',
            orange: 'ผิดปกติ',
            red: 'กล้องดับ',
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
                            <th>Ping รายตัว</th>
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
                                className={`csr-level ${r.display_level}`}
                                >
                                {levelLabel(r.display_level)}
                                </span>
                                {r.display_level === 'yellow' && (
                                  <small className="csr-review-hint">
                                    ตรวจสอบกล้องจริง หากปกติให้เลือก “ปกติ”
                                  </small>
                                )}
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
                                disabled={
                                  running || !!pingingIp || saving || importing ||
                                  !selectedLoaded || r.ping_level === 'not_tested'
                                }
                                value={r.status}
                                onChange={e =>
                                    updateResult(
                                    r.ip,
                                    e.target.value
                                    )
                                }
                                >
                                <option value="online">ปกติ (ตรวจสอบแล้ว)</option>
                                <option value="unknown">ตรวจสอบ / ผิดปกติ</option>
                                <option value="offline">กล้องดับ</option>
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
                                    !!pingingIp ||
                                    saving ||
                                    importing ||
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

                            <td>
                              <button
                                type="button"
                                className={`csr-camera-reping${pingingIp === r.ip ? ' csr-camera-reping--busy' : ''}`}
                                disabled={
                                  running || !!pingingIp || saving ||
                                  importing || loading || !selectedLoaded || !agentKey
                                }
                                onClick={() => pingOneCamera(r.ip)}
                                title={`Ping ใหม่เฉพาะ ${r.name}`}
                              >
                                {pingingIp === r.ip
                                  ? '⏳ กำลัง Ping...'
                                  : '↻ Ping ใหม่'}
                              </button>
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
        เขียว = ปกติ • เหลือง = ตรวจสอบ • ส้ม = ผิดปกติ (Ping ตอบ) • แดง = กล้องดับ (Ping ไม่ตอบ)
      </p>


      {/* MANUAL SUMMARY */}

      <div className="csr-manual">

        <label>
          <input
            type="checkbox"
            disabled={running || !!pingingIp || saving || importing || !selectedLoaded}
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
              ['unknown', 'ตรวจสอบ/ผิดปกติ'],
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
          {autoSummary.pending || notTestedCount
            ? `ยังไม่ Ping ${notTestedCount} กล้อง • รอยืนยัน ${autoSummary.pending} กล้อง — บันทึกได้เป็นฉบับชั่วคราว`
            : 'ตรวจสอบครบทุกรายการ — พร้อมบันทึกผลยืนยัน'}
        </span>

        <button
          type="button"
          className="csr-primary"
          disabled={
            loading ||
            running ||
            !!pingingIp ||
            saving ||
            importing ||
            !selectedLoaded ||
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