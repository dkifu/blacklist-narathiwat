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
   DAILY DASHBOARD HELPERS
   - Derived from individual camera status
   - No inferred failures for untested cameras
========================================= */

const networkLabel = value => NETWORKS.find(x => x.value === value)?.label || value

const previewPercent = (count, total) =>
  total > 0 ? (Number(count || 0) / total) * 100 : 0

const previewPercentLabel = (count, total) =>
  `${previewPercent(count, total).toFixed(1)}%`

const previewThaiDate = value => {
  if (!value) return '-'
  return new Date(`${value}T12:00:00`).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

// A unit is a known Service Box, or the checkpoint identifier
// provided in the Service Box Excel column. Unknown unit IDs are
// NOT classified as full-unit outages.
function buildOutageData(rows, networkType) {
  const units = new Map()

  for (const camera of rows) {
    const label = String(camera.service_box || '').trim()
    const key = label
      ? `unit:${label.toLocaleUpperCase()}`
      : `unmapped:${camera.ip}`
    if (!units.has(key)) {
      units.set(key, {
        label: label || 'ไม่ระบุรหัสตู้/ด่าน',
        known: Boolean(label),
        cameras: [],
      })
    }
    units.get(key).cameras.push(camera)
  }

  let fullUnitCount = 0
  let fullUnitCameraCount = 0
  let partialOfflineCount = 0
  let unmappedOfflineCount = 0
  const repairItems = []
  const metadataByIp = {}
  const problemUnits = []

  for (const unit of units.values()) {
    const down = unit.cameras.filter(camera => camera.status === 'offline')
    const full = unit.known && down.length > 0 && down.length === unit.cameras.length

    if (full) {
      fullUnitCount += 1
      fullUnitCameraCount += down.length
    } else {
      partialOfflineCount += down.length
    }
    if (!unit.known) unmappedOfflineCount += down.length
    if (down.length) {
      problemUnits.push({
        name: unit.label,
        total: unit.cameras.length,
        down: down.length,
        full,
        known: unit.known,
      })
    }

    for (const camera of unit.cameras) {
      const isDown = camera.status === 'offline'
      const scope = isDown ? (full ? 'full_unit' : 'single_camera') : null
      metadataByIp[camera.ip] = {
        unit_label: unit.label,
        full_outage: full,
        outage_scope: scope,
      }
      if (!isDown) continue
      repairItems.push({
        network_type: networkType,
        unit_label: unit.label,
        camera_name: camera.name || '-',
        ip: camera.ip,
        outage_scope: scope,
        full_outage: full,
        location_known: unit.known,
        is_confirmed: Boolean(camera.confirmed),
        ping_level: camera.ping_level || 'not_tested',
        ping_source_level: camera.ping_source_level || null,
        loss_pct: camera.loss_pct ?? null,
        avg_ms: camera.avg_ms ?? null,
        latitude: camera.latitude ?? camera.lat ?? null,
        longitude: camera.longitude ?? camera.long ?? null,
        // Candidate only; this does NOT create a repair ticket.
        repair_status: 'not_created',
      })
    }
  }

  problemUnits.sort((a, b) => b.down - a.down || a.name.localeCompare(b.name, 'th'))
  return {
    fullUnitCount, fullUnitCameraCount,
    partialOfflineCount, unmappedOfflineCount,
    repairItems, problemUnits, metadataByIp,
  }
}

function buildDashboardNetwork(report, networkType, inventoryCount = 0) {
  const details = Array.isArray(report?.details) ? report.details : []
  const hasReport = Boolean(report) && details.length > 0
  const outage = buildOutageData(details, networkType)
  const checked = details.filter(row => row.ping_level && row.ping_level !== 'not_tested')
  const base = {
    total: details.length || inventoryCount,
    online: checked.filter(x => x.status === 'online').length,
    offline: checked.filter(x => x.status === 'offline').length,
    unknown: checked.filter(x => x.status === 'unknown').length,
    notTested: Math.max(0, details.length - checked.length),
  }
  const saved = report?.manual_summary || report?.final_summary
  // Only trust a manually edited saved total when its arithmetic is valid.
  const savedCounts = ['online', 'offline', 'unknown'].map(k => Number(saved?.[k]))
  const validSaved = saved && savedCounts.every(n => Number.isInteger(n) && n >= 0) &&
    savedCounts.reduce((a, b) => a + b, 0) === base.total
  const counts = validSaved
    ? { ...base, online: savedCounts[0], offline: savedCounts[1], unknown: savedCounts[2], notTested: 0 }
    : base

  const colors = { green: 0, yellow: 0, orange: 0, red: 0 }
  for (const row of details) {
    const level = displayPingLevel(row)
    const color = row.status === 'offline'
      ? 'red'
      : row.status === 'online'
        ? 'green'
        : level === 'yellow' ? 'yellow' : level === 'orange' ? 'orange' : null
    if (color) colors[color] += 1
  }

  return {
    networkType,
    label: networkType === 'general' ? 'กล้องทั่วไป' : 'กล้องด่าน',
    unitName: networkType === 'general' ? 'ตู้' : 'ด่าน',
    hasReport,
    isSaved: Boolean(report?.is_saved),
    isFinal: Boolean(report?.is_final),
    manualFromReport: Boolean(validSaved && report?.manual_summary),
    ...counts,
    ...colors,
    ...outage,
  }
}

function previewTextReport(snapshot) {
  const parts = [
    snapshot.title,
    `ศูนย์: ${snapshot.centerName}`,
    `วันที่: ${previewThaiDate(snapshot.reportDate)} • ${snapshot.shiftLabel}`,
    '',
  ]
  for (const item of [snapshot.general, snapshot.checkpoint]) {
    parts.push(item.label)
    if (!item.hasReport) {
      parts.push(`- ทะเบียน ${item.total} กล้อง • ยังไม่มีผลตรวจในกะนี้`, '')
      continue
    }
    parts.push(
      `- ทั้งหมด ${item.total} กล้อง`,
      `- ปกติ ${item.online} (${previewPercentLabel(item.online, item.total)})`,
      `- ดับ ${item.offline} (${previewPercentLabel(item.offline, item.total)})`,
      `- ตรวจสอบ/ผิดปกติ ${item.unknown} (${previewPercentLabel(item.unknown, item.total)})`,
      `- ดับทั้ง${item.unitName} ${item.fullUnitCount} ${item.unitName} รวม ${item.fullUnitCameraCount} กล้อง`,
      `- ดับรายตัว (ไม่ซ้ำกับทั้ง${item.unitName}) ${item.partialOfflineCount} กล้อง`,
      ''
    )
  }
  parts.push(
    `รายการกล้องดับรายตัวสำหรับเตรียมแจ้งซ่อม: ${snapshot.repairItems.length} กล้อง`,
    'รายการแจ้งซ่อมเป็นเพียงข้อมูลเตรียมงาน ยังไม่ได้สร้างใบแจ้งซ่อม',
  )
  if (snapshot.note) parts.push(`หมายเหตุ: ${snapshot.note}`)
  if (snapshot.edited) parts.push('หมายเหตุ: มีการปรับยอดเพื่อจัดทำพรีวิว ตัวเลขรายการซ่อมอ้างอิงสถานะรายกล้องจริง')
  if (snapshot.hasDraft) parts.push('ข้อมูลบางเครือข่ายยังไม่ได้บันทึกลงฐานข้อมูล')
  return parts.join('\n')
}

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

function CameraStatusReportCenter({
  profile,
  shift,
  initialCenterId,
  onCenterChange,
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
    useState(
      String(initialCenterId || profile?.center_id || '')
    )

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

  // Dashboard preview: the other network is loaded from the saved report.
  const previewRef = useRef(null)
  const [previewCache, setPreviewCache] = useState({ general: null, checkpoint: null })
  const [previewCacheScope, setPreviewCacheScope] = useState('')
  const [previewEditorOpen, setPreviewEditorOpen] = useState(false)
  const [previewTitle, setPreviewTitle] = useState('สรุปรายงานสถานะกล้องประจำวัน')
  const [previewNote, setPreviewNote] = useState('')
  const [previewOverrides, setPreviewOverrides] = useState({ general: null, checkpoint: null })
  const [exportingPreview, setExportingPreview] = useState(false)

  // Manual status edits are saved atomically by a server-side RPC.
  const [manualIpSearch, setManualIpSearch] = useState('')
  const [manualIpMatches, setManualIpMatches] = useState([])
  const [manualIpSearching, setManualIpSearching] = useState(false)
  const [manualIpBusy, setManualIpBusy] = useState(false)
  const [manualIpHistory, setManualIpHistory] = useState([])
  const [manualIpActive, setManualIpActive] = useState(null)
  const [manualIpMessage, setManualIpMessage] = useState('')

  // An edit to one day/center must never carry over to another report.
  useEffect(() => {
    setPreviewTitle('สรุปรายงานสถานะกล้องประจำวัน')
    setPreviewNote('')
    setPreviewOverrides({ general: null, checkpoint: null })
    setManualIpSearch('')
    setManualIpMatches([])
    setManualIpActive(null)
    setManualIpHistory([])
    setManualIpMessage('')
  }, [centerId, reportDate, shift])



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
    setPreviewCache({ general: null, checkpoint: null })
    setPreviewCacheScope('')

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
              'network_type,details,final_summary,manual_summary,is_final,updated_at'
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

      // Cache both saved reports. Never use a cache from another center/date/shift.
      setPreviewCache({
        general: (() => { const r = (reports.data || []).find(x => x.network_type === 'general'); return r ? { ...r, is_saved: true } : null })(),
        checkpoint: (() => { const r = (reports.data || []).find(x => x.network_type === 'checkpoint'); return r ? { ...r, is_saved: true } : null })(),
      })
      setPreviewCacheScope(`${centerId}|${reportDate}|${shift}`)

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
    manualIpBusy ||
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
      manualIpBusy ||
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
      manualIpBusy ||
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

      const outageSnapshot = buildOutageData(rows, network)
      const repairItemsToSave = outageSnapshot.repairItems.map(item => ({
        ...item,
        center_id: Number(centerId),
        report_date: reportDate,
        shift,
      }))

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
                  manual_override,
                  manual_original_status,
                  manual_original_confirmed,
                  manual_changed_at,
                  manual_changed_by,
                  manual_reason,
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
                  ...(manual_override ? {
                    manual_override,
                    manual_original_status,
                    manual_original_confirmed,
                    manual_changed_at,
                    manual_changed_by,
                    manual_reason,
                  } : {}),
                  // Snapshot of full-box/site outage classification at save time.
                  ...outageSnapshot.metadataByIp[ip],
                })
              ),

              ping_summary: {
                green: rows.filter(x => x.display_level === 'green').length,
                yellow: rows.filter(x => x.display_level === 'yellow').length,
                orange: rows.filter(x => x.display_level === 'orange').length,
                red: rows.filter(x => ['unreachable', 'red'].includes(x.display_level)).length,
                not_tested: rows.filter(x => x.display_level === 'not_tested').length,
              },

              final_summary: {
                ...summaryToSave,
                dashboard_preview: {
                  network_type: network,
                  full_unit_count: outageSnapshot.fullUnitCount,
                  full_unit_camera_count: outageSnapshot.fullUnitCameraCount,
                  partial_offline_count: outageSnapshot.partialOfflineCount,
                  unmapped_offline_count: outageSnapshot.unmappedOfflineCount,
                  source: 'camera_status_daily.details',
                },
                // Stored candidates, not actual created repair tickets.
                repair_items: repairItemsToSave,
              },

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
     MANUAL DOWN/RESTORE VIA SERVER RPC
     - Does not modify raw Ping measurements
     - Server writes the audit record in the same transaction
  ========================================= */

  async function findManualCamera(event) {
    event?.preventDefault()
    const ip = manualIpSearch.trim()
    setManualIpMessage('')
    setManualIpActive(null)
    setManualIpHistory([])
    setManualIpMatches([])
    if (!validIPv4(ip)) {
      setManualIpMessage('กรุณากรอก IPv4 ที่ถูกต้อง เช่น 172.17.2.96')
      return
    }
    if (!centerId) return
    setManualIpSearching(true)
    try {
      const { data, error } = await supabase
        .from('camera_inventory')
        .select('ip,name,service_box,network_type')
        .eq('center_id', Number(centerId))
        .eq('ip', ip)
        .eq('is_active', true)
        .order('network_type')
      if (error) throw error
      setManualIpMatches(data || [])
      if (!data?.length) setManualIpMessage('ไม่พบ IP นี้ในทะเบียนกล้องของศูนย์ที่เลือก')
    } catch (error) {
      setManualIpMessage(`ค้นหาไม่สำเร็จ: ${error.message}`)
    } finally {
      setManualIpSearching(false)
    }
  }

  async function loadManualHistory(camera) {
    const { data, error } = await supabase
      .from('camera_manual_status_audit')
      .select('id,action,previous_status,new_status,created_at,actor_id')
      .eq('center_id', Number(centerId))
      .eq('report_date', reportDate)
      .eq('shift', shift)
      .eq('network_type', camera.network_type)
      .eq('camera_ip', camera.ip)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) throw error
    setManualIpHistory(data || [])
  }

  async function chooseManualCamera(camera) {
    setManualIpActive(camera)
    setManualIpMessage('')
    setManualIpHistory([])
    try {
      await loadManualHistory(camera)
    } catch (error) {
      setManualIpMessage(`อ่านประวัติไม่สำเร็จ: ${error.message}`)
    }
  }

  async function applyManualCamera(action) {
    const camera = manualIpActive
    if (!camera || manualIpBusy || running || pingingIp || saving || importing || loading) return
    if (network === camera.network_type && Object.keys(results).length > 0 && !savedInfo) {
      setManualIpMessage('เครือข่ายนี้มีผล Ping ที่ยังไม่ได้บันทึก กรุณาบันทึกรายงานก่อนแก้ด้วย IP')
      return
    }
    const description = action === 'down' ? 'เพิ่มเป็นกล้องดับ' : action === 'up' ? 'นำออกจากกล้องดับและยืนยันว่าปกติ' : 'ย้อนกลับเป็นสถานะก่อนแก้ไขด้วยมือ'
    if (!window.confirm(`${description}\n${camera.name} (${camera.ip})\nศูนย์ ${centerId} / ${reportDate} / ${SHIFTS[shift]}\n\nยืนยันการบันทึกลง Supabase จริงหรือไม่?`)) return
    setManualIpBusy(true)
    setManualIpMessage('')
    try {
      const { error } = await supabase.rpc('camera_set_manual_outage', {
        p_center_id: Number(centerId),
        p_report_date: reportDate,
        p_shift: shift,
        p_network_type: camera.network_type,
        p_ip: camera.ip,
        p_action: action,
        p_reason: '', // Optional: audit records actor/time/previous/new status
      })
      if (error) throw error
      // Invalidate preview-only number edits; individual camera data is now authoritative.
      setPreviewOverrides({ general: null, checkpoint: null })
      setManualIpMessage(`บันทึกแล้ว: ${description} (${camera.ip}) พร้อมประวัติการแก้ไข`)
      // Re-query both network reports and active camera results.
      setReloadIndex(x => x + 1)
      await loadManualHistory(camera)
    } catch (error) {
      setManualIpMessage(`บันทึกไม่สำเร็จ: ${error.message}`)
    } finally {
      setManualIpBusy(false)
    }
  }

    /* =========================================
     RESET ALL MANUAL CAMERA OVERRIDES
     Selected center / date / shift
     Both general and checkpoint networks
  ========================================= */

  async function resetAllManualCameras() {
    if (
      !centerId ||
      manualIpBusy ||
      manualIpSearching ||
      running ||
      pingingIp ||
      saving ||
      importing ||
      loading
    ) return

    if (
      Object.keys(results).length > 0 &&
      !savedInfo
    ) {
      setMessage(
        'มีผลตรวจที่ยังไม่ได้บันทึก กรุณาบันทึกรายงานก่อนคืนค่าทั้งหมด'
      )
      return
    }

    const confirmed = window.confirm(
      `ต้องการคืนสถานะกล้องทั้งหมดที่แก้ไขด้วยมือหรือไม่?\n\n` +
      `วันที่: ${reportDate}\n` +
      `กะ: ${SHIFTS[shift]}\n` +
      `ศูนย์: ${
        centers.find(c =>
          String(c.id) === String(centerId)
        )?.name || centerId
      }\n\n` +
      `ครอบคลุมกล้องทั่วไปและกล้องด่าน\n` +
      `จะคืนสถานะก่อนแก้ด้วยมือของทุก IP\n` +
      `โดยไม่ลบผล Ping เดิมหรือประวัติการแก้ไข`
    )

    if (!confirmed) return

    setManualIpBusy(true)
    setManualIpMessage('')

    try {
      const { data, error } = await supabase.rpc(
        'camera_reset_all_manual_outages',
        {
          p_center_id: Number(centerId),
          p_report_date: reportDate,
          p_shift: shift,
        }
      )

      if (error) throw error

      const total = Number(data?.reset_count || 0)
      const general = Number(data?.general_count || 0)
      const checkpoint = Number(data?.checkpoint_count || 0)

      // คืนค่าการปรับพรีวิวด้วย
      setPreviewTitle('สรุปรายงานสถานะกล้องประจำวัน')
      setPreviewNote('')
      setPreviewOverrides({
        general: null,
        checkpoint: null,
      })

      // ล้าง IP ที่เลือกและประวัติบนหน้าจอ
      setManualIpSearch('')
      setManualIpMatches([])
      setManualIpActive(null)
      setManualIpHistory([])

      const text = total > 0
        ? `คืนค่าสำเร็จ ${total} กล้อง (ทั่วไป ${general}, ด่าน ${checkpoint})`
        : 'ไม่มีสถานะกล้องที่แก้ด้วยมือค้างอยู่ พรีวิวถูกคืนค่าเริ่มต้นแล้ว'

      setMessage(text)
      setManualIpMessage(text)

      // โหลดข้อมูลล่าสุดทั้งสองเครือข่าย
      setReloadIndex(x => x + 1)

    } catch (error) {
      const text = `คืนค่าทั้งหมดไม่สำเร็จ: ${error.message}`
      setMessage(text)
      setManualIpMessage(text)

    } finally {
      setManualIpBusy(false)
    }
  }

  /* =========================================
     PREVIEW / PNG / CLIPBOARD
     The editor changes presentation counts only; fault records always
     come from each individual confirmed or pending camera result.
  ========================================= */

  const overviewScope = `${centerId}|${reportDate}|${shift}`
  const readyPreviewCache = previewCacheScope === overviewScope
  const previewNetworks = useMemo(() => {
    const getReport = type => {
      if (type === network && selectedLoaded) {
        // Include current unsaved results only if a ping/report exists.
        const hasCurrent = Boolean(savedInfo || Object.keys(results).length)
        if (hasCurrent) {
          return {
            details: rows,
            final_summary: summary,
            manual_summary: manual,
            is_saved: Boolean(savedInfo),
            is_final: Boolean(savedInfo?.isFinal),
          }
        }
      }
      return readyPreviewCache ? previewCache[type] : null
    }
    return {
      general: buildDashboardNetwork(
        getReport('general'), 'general', networkOverview.general.total
      ),
      checkpoint: buildDashboardNetwork(
        getReport('checkpoint'), 'checkpoint', networkOverview.checkpoint.total
      ),
    }
  }, [network, selectedLoaded, rows, savedInfo, results, summary, manual,
      readyPreviewCache, previewCache, networkOverview])

  // Safe, preview-only number overrides; do not change camera fault records.
  const getPreviewValues = type => {
    const item = previewNetworks[type]
    const override = previewOverrides[type]
    if (!override || !item.hasReport) return item
    const values = ['online', 'offline', 'unknown'].map(k => Number(override[k]))
    const valid = values.every(Number.isInteger) && values.every(v => v >= 0) &&
      values.reduce((a, b) => a + b, 0) === item.total
    return valid ? {
      ...item, online: values[0], offline: values[1], unknown: values[2],
      notTested: 0, previewEdited: true,
    } : item
  }

  const generalPreview = getPreviewValues('general')
  const checkpointPreview = getPreviewValues('checkpoint')
  const previewEditError = NETWORKS.map(n => {
    const override = previewOverrides[n.value]
    const original = previewNetworks[n.value]
    if (!override) return ''
    if (!original.hasReport) return `ยังไม่มีรายงาน${n.label}ให้แก้ไข`
    const values = ['online', 'offline', 'unknown'].map(k => String(override[k]).trim())
    if (values.some(v => !/^\d+$/.test(v))) return `${n.label}: กรุณากรอกจำนวนเต็มไม่ติดลบ`
    if (values.map(Number).reduce((a, b) => a + b, 0) !== original.total)
      return `${n.label}: ยอดรวมต้องเท่ากับ ${original.total} กล้อง`
    return ''
  }).find(Boolean)

  const previewSnapshot = {
    title: previewTitle.trim() || 'สรุปรายงานสถานะกล้องประจำวัน',
    note: previewNote.trim(),
    centerName: centers.find(x => String(x.id) === String(centerId))?.name || '-',
    reportDate, shiftLabel: SHIFTS[shift] || '-',
    general: generalPreview,
    checkpoint: checkpointPreview,
    repairItems: [
      ...previewNetworks.general.repairItems.map(x => ({ ...x, network_label: 'กล้องทั่วไป' })),
      ...previewNetworks.checkpoint.repairItems.map(x => ({ ...x, network_label: 'กล้องด่าน' })),
    ],
    edited: Boolean(previewOverrides.general || previewOverrides.checkpoint),
    hasDraft: [generalPreview, checkpointPreview].some(x => x.hasReport && !x.isSaved),
  }

  // Keep report selection stable before preparing export.
  async function renderDashboardCanvas() {
    if (!previewRef.current) throw new Error('ไม่พบพื้นที่พรีวิว')
    const { default: html2canvas } = await import('html2canvas')
    return html2canvas(previewRef.current, {
      backgroundColor: '#0d1728',
      scale: 2,
      useCORS: true,
      logging: false,
    })
  }

  async function copyPreviewText() {
    if (previewEditError) { setMessage(previewEditError); return }
    try {
      await navigator.clipboard.writeText(previewTextReport(previewSnapshot))
      setMessage('คัดลอกข้อความสรุปแล้ว')
    } catch (error) {
      setMessage(`คัดลอกข้อความไม่สำเร็จ: ${error.message}`)
    }
  }

  async function exportPreviewPng(copyImage = false) {
    if (previewEditError || exportingPreview) {
      if (previewEditError) setMessage(previewEditError)
      return
    }
    setExportingPreview(true)
    try {
      const canvas = await renderDashboardCanvas()
      if (copyImage) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('แปลงภาพไม่สำเร็จ')
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
          throw new Error('เบราว์เซอร์นี้ไม่รองรับการคัดลอกรูป กรุณาบันทึก PNG แทน')
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setMessage('คัดลอกภาพรายงานแล้ว')
      } else {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('แปลงภาพไม่สำเร็จ')
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `cctv-daily-${centerId}-${reportDate}-${shift}.png`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1500)
        setMessage('บันทึก PNG สำเร็จ')
      }
    } catch (error) {
      setMessage(`ส่งออกพรีวิวไม่สำเร็จ: ${error.message}`)
    } finally {
      setExportingPreview(false)
    }
  }

  function editPreviewNumber(type, key, value) {
    if (!/^\d*$/.test(value)) return
    const item = previewNetworks[type]
    setPreviewOverrides(prev => ({
      ...prev,
      [type]: { ...(
        prev[type] || {
          online: String(item.online),
          offline: String(item.offline),
          unknown: String(item.unknown),
        }
      ), [key]: value },
    }))
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
            onChange={e => {
              const value = e.target.value

              setCenterId(value)

              // แจ้ง Component ด้านนอกว่าผู้ใช้เลือกศูนย์อะไร
              onCenterChange?.(value)
            }}
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

      {/* REPORT DASHBOARD PREVIEW - always below the report form */}
      <section className="csr-dashboard-section" aria-label="พรีวิวรายงานสรุปกล้อง">
        <div className="csr-dashboard-tools">
          <div>
            <span className="csr-dashboard-eyebrow">DAILY CCTV REPORT</span>
            <h3>พรีวิว Dashboard สำหรับส่งงาน</h3>
            <p>สรุปสองเครือข่ายจากผลรายกล้อง และเตรียมรายการกล้องดับไว้สำหรับหน้าการแจ้งซ่อม</p>
          </div>
          <div className="csr-dashboard-actions">
            <button type="button" onClick={() => setPreviewEditorOpen(x => !x)}>
              {previewEditorOpen ? 'ปิดแถบแก้ไข' : 'แก้ไขพรีวิว'}
            </button>
            <button
              type="button"
              className="csr-reset-all-btn"
              disabled={
                manualIpBusy ||
                manualIpSearching ||
                running ||
                !!pingingIp ||
                saving ||
                importing ||
                loading ||
                !centerId
              }
              onClick={resetAllManualCameras}
            >
              {manualIpBusy ? 'กำลังคืนค่า...' : '↺ คืนค่าทั้งหมด'}
            </button>
            <button type="button" disabled={!!previewEditError || exportingPreview} onClick={copyPreviewText}>
              คัดลอกข้อความ
            </button>
            <button type="button" disabled={!!previewEditError || exportingPreview} onClick={() => exportPreviewPng(true)}>
              คัดลอกรูป
            </button>
            <button type="button" className="csr-primary" disabled={!!previewEditError || exportingPreview} onClick={() => exportPreviewPng(false)}>
              {exportingPreview ? 'กำลังสร้างภาพ...' : 'บันทึก PNG'}
            </button>
          </div>
        </div>

        {previewEditorOpen && (
          <div className="csr-dashboard-editor">
            <div className="csr-dashboard-editor-head">
              <strong>แถบแก้ไขพรีวิว</strong>
              
               
            </div>
            <div className="csr-dashboard-editor-fields">
              <label>หัวข้อรายงาน
                <input type="text" value={previewTitle} maxLength={95} onChange={e => setPreviewTitle(e.target.value)} />
              </label>
              <label>ข้อความประกอบ
                <input type="text" value={previewNote} maxLength={220} placeholder="เช่น สถานการณ์โดยรวม / หมายเหตุประจำวัน" onChange={e => setPreviewNote(e.target.value)} />
              </label>
            </div>
            <div className="csr-dashboard-editor-networks">
              {NETWORKS.map(n => {
                const item = previewNetworks[n.value]
                return (
                  <div className="csr-dashboard-editor-network" key={n.value}>
                    <strong>{n.label}</strong>
                    <div className="csr-manual-ip-summary">
                      <span>ทั้งหมด <b>{item.total}</b></span>
                      <span>ติด <b>{item.online}</b></span>
                      <span>ดับ <b>{item.offline}</b></span>
                    </div>
                    <small>เปลี่ยนสถานะกล้องผ่าน IP ด้านล่าง เพื่อให้ยอดรวมและข้อมูลแจ้งซ่อมตรงกัน</small>
                  </div>
                )
              })}
            </div>
            <div className="csr-manual-ip-panel">
              <div className="csr-manual-ip-header">
                <strong>แก้กล้องดับจริงด้วย IP (บันทึกลง Supabase)</strong>
                <small>ต้องมีรายงานที่บันทึกแล้วของวัน/กะ/เครือข่ายนั้นก่อน</small>
              </div>
              <form onSubmit={findManualCamera} className="csr-manual-ip-search">
                <label>ค้นหา IP กล้องจากทะเบียนของศูนย์
                  <input type="text" value={manualIpSearch} onChange={e => setManualIpSearch(e.target.value)} placeholder="172.17.2.96" />
                </label>
                <button type="submit" disabled={manualIpSearching || manualIpBusy || !centerId}>
                  {manualIpSearching ? 'กำลังค้นหา...' : 'ค้นหา IP'}
                </button>
              </form>
              {!!manualIpMessage && <p className="csr-manual-ip-notice" role="status">{manualIpMessage}</p>}
              {manualIpMatches.map(camera => {
                const report = previewCacheScope === `${centerId}|${reportDate}|${shift}`
                  ? previewCache[camera.network_type] : null
                const savedRow = report?.details?.find(row => row.ip === camera.ip)
                const selected = manualIpActive?.ip === camera.ip && manualIpActive?.network_type === camera.network_type
                return (
                  <div className={`csr-manual-ip-result ${selected ? 'is-active' : ''}`} key={`${camera.network_type}:${camera.ip}`}>
                    <div><strong>{camera.name}</strong> <small>{camera.ip} · {networkLabel(camera.network_type)} · {camera.service_box || 'ไม่ระบุตู้/ด่าน'}</small></div>
                    <div><span className={savedRow?.status === 'offline' ? 'csr-manual-ip-red' : 'csr-manual-ip-green'}>{!report ? 'ยังไม่บันทึกรายงาน' : !savedRow ? 'ไม่พบในผลตรวจที่บันทึก' : savedRow.status === 'offline' ? 'กล้องดับ' : savedRow.status === 'online' ? 'กล้องติด' : 'รอตรวจสอบ'}</span>
                      <button type="button" disabled={!savedRow || manualIpBusy} onClick={() => chooseManualCamera(camera)}>เลือกแก้ไข</button>
                    </div>
                  </div>
                )
              })}
              {manualIpActive && (() => {
                const cam = manualIpActive
                const report = previewCacheScope === `${centerId}|${reportDate}|${shift}` ? previewCache[cam.network_type] : null
                const savedRow = report?.details?.find(r => r.ip === cam.ip)
                return (
                  <div className="csr-manual-ip-action-panel">
                    <strong>{cam.name} • {cam.ip}</strong>
                    <p>ผล Ping ดิบจะไม่ถูกแก้: {savedRow?.ping_level || 'ยังไม่มีผล'} • สถานะสรุปที่บันทึก: {savedRow?.status || 'ไม่พบ'}</p>
                    <div className="csr-manual-ip-actions">
                      <button type="button" className="csr-manual-ip-down" disabled={manualIpBusy || savedRow?.status === 'offline' || !savedRow} onClick={() => applyManualCamera('down')}>เพิ่มเป็นกล้องดับ</button>
                      <button type="button" className="csr-manual-ip-up" disabled={manualIpBusy || savedRow?.status === 'online' || !savedRow} onClick={() => applyManualCamera('up')}>นำออกจากกล้องดับ (ปกติ)</button>
                      
                    </div>
                    <div className="csr-manual-ip-history"><strong>ประวัติแก้ไขของ IP นี้ (สูงสุด 30 รายการ)</strong>
                      {manualIpHistory.length ? manualIpHistory.map(item => <div key={item.id}>
                        <span>{new Date(item.created_at).toLocaleString('th-TH')} · {item.previous_status} → {item.new_status}</span>
                        <small>ผู้ดำเนินการ {String(item.actor_id).slice(0, 8)}…</small>
                      </div>) : <small>ยังไม่มีประวัติการแก้ไขด้วยมือ</small>}
                    </div>
                  </div>
                )
              })()}
            </div>
            <p className="csr-dashboard-edit-note">ข้อมูลแจ้งซ่อมและยอดดับทั้งตู้/ด่านจะคำนวณจากสถานะรายกล้องที่บันทึกจริง ไม่ใช่การกรอกยอดรวม</p>
          </div>
        )}

        <div className="csr-dashboard-paper" ref={previewRef}>
          <header className="csr-dashboard-paper-head">
            <div>
              <span className="csr-dashboard-paper-kicker">CCTV NETWORK · DAILY STATUS</span>
              <h2>{previewSnapshot.title}</h2>
              <p>ศูนย์ {previewSnapshot.centerName} <span>•</span> {previewThaiDate(reportDate)} <span>•</span> {SHIFTS[shift]}</p>
            </div>
            <div className="csr-dashboard-report-date">รายงานประจำวัน</div>
          </header>
          {previewSnapshot.edited && <p className="csr-dashboard-warning">* มีการปรับตัวเลขเฉพาะเพื่อจัดทำพรีวิว รายการกล้องดับ/แจ้งซ่อมยังอ้างอิงข้อมูลรายกล้อง</p>}
          {previewSnapshot.hasDraft && <p className="csr-dashboard-warning">* มีผลตรวจที่ยังไม่ได้บันทึกในฐานข้อมูล แนะนำให้บันทึกรายงานก่อนส่งงาน</p>}
          {previewSnapshot.note && <p className="csr-dashboard-report-note">{previewSnapshot.note}</p>}

          <div className="csr-dashboard-network-grid">
            {[previewSnapshot.general, previewSnapshot.checkpoint].map(item => {
              const portions = item.total > 0 ? [
                { key: 'green', value: item.online, color: '#27c997' },
                { key: 'red', value: item.offline, color: '#f56876' },
                { key: 'unknown', value: item.unknown, color: '#fbbf67' },
              ] : []
              let progress = 0
              return (
                <article className="csr-dashboard-network-panel" key={item.networkType}>
                  <div className="csr-dashboard-panel-title">
                    <div><span>{item.networkType === 'general' ? '01 / CAMERA NETWORK' : '02 / CHECKPOINT NETWORK'}</span><h3>{item.label}</h3></div>
                    <div className={`csr-dashboard-data-label ${item.hasReport && item.isSaved ? 'is-saved' : 'is-unsaved'}`}>{!item.hasReport ? 'ยังไม่มีผลรายงาน' : item.isSaved ? (item.isFinal ? 'บันทึกแล้ว · ยืนยันครบ' : 'บันทึกแล้ว · ชั่วคราว') : 'ยังไม่บันทึก'}</div>
                  </div>
                  <div className="csr-dashboard-donut-row">
                    <div className="csr-dashboard-donut">
                      <svg viewBox="0 0 120 120" role="img" aria-label={`กล้องใช้งานได้ ${previewPercentLabel(item.online, item.total)}`}>
                        <circle cx="60" cy="60" r="49" fill="none" stroke="#27384e" strokeWidth="13" />
                        {item.hasReport && portions.map(portion => {
                          const current = progress
                          const length = previewPercent(portion.value, item.total)
                          progress += length
                          return <circle key={portion.key} cx="60" cy="60" r="49" fill="none" stroke={portion.color} strokeWidth="13" strokeDasharray={`${length * 3.07876} ${307.876 - length * 3.07876}`} strokeDashoffset={-current * 3.07876} transform="rotate(-90 60 60)" />
                        })}
                      </svg>
                      <div className="csr-dashboard-donut-center"><strong>{item.hasReport ? previewPercentLabel(item.online, item.total) : '—'}</strong><small>กล้องใช้งานได้</small></div>
                    </div>
                    <div className="csr-dashboard-mini-stats">
                      <div><small>กล้องทั้งหมด</small><strong>{item.total.toLocaleString('th-TH')}</strong></div>
                      <div><span className="csr-dot is-green"/><small>กล้องติด</small><strong>{item.hasReport ? item.online.toLocaleString('th-TH') : '—'}</strong></div>
                      <div><span className="csr-dot is-red"/><small>กล้องดับ</small><strong>{item.hasReport ? item.offline.toLocaleString('th-TH') : '—'}</strong></div>
                    </div>
                  </div>
                  <div className="csr-dashboard-outage-box">
                    <strong>{item.networkType === 'general' ? 'ปัญหาระดับตู้กล้อง' : 'ปัญหาระดับด่าน'}</strong>
                    <div className="csr-dashboard-outage-three">
                      <div><b>{item.hasReport ? item.fullUnitCount : '—'}</b><small>ดับทั้ง{item.unitName}</small></div>
                      <div><b>{item.hasReport ? item.fullUnitCameraCount : '—'}</b><small>กล้องใน{item.unitName}ที่ดับทั้งชุด</small></div>
                      <div><b>{item.hasReport ? item.partialOfflineCount : '—'}</b><small>กล้องดับรายตัว</small></div>
                    </div>
                    {item.unmappedOfflineCount > 0 && <p>มี {item.unmappedOfflineCount} กล้องไม่มีรหัสตู้/ด่าน จัดเป็นดับรายตัวเพื่อไม่สรุปว่าดับทั้งชุดผิดพลาด</p>}
                  </div>
                </article>
              )
            })}
          </div>

          <section className="csr-dashboard-repair-section">
            <div className="csr-dashboard-section-heading"><h3>รายการกล้องดับ — ข้อมูลเตรียมแจ้งซ่อม</h3><span>{previewSnapshot.repairItems.length} กล้อง</span></div>
            <div className="csr-dashboard-table-scroll"><table className="csr-dashboard-repair-table">
              <thead><tr><th>เครือข่าย</th><th>ตู้ / ด่าน</th><th>ชื่อกล้อง</th><th>IP</th><th>ประเภทการดับ</th><th>ยืนยัน</th></tr></thead>
              <tbody>
                {previewSnapshot.repairItems.slice(0, 12).map((item, i) => <tr key={`${item.network_type}-${item.ip}-${i}`}>
                  <td>{item.network_label}</td><td>{item.unit_label}</td><td>{item.camera_name}</td>
                  <td className="csr-dashboard-ip">{item.ip}</td>
                  <td>{item.outage_scope === 'full_unit' ? `ดับทั้ง${item.network_type === 'general' ? 'ตู้' : 'ด่าน'}` : 'ดับรายตัว'}</td>
                  <td>{item.is_confirmed ? 'ยืนยันแล้ว' : 'รอยืนยัน'}</td>
                </tr>)}
              </tbody>
            </table></div>
            {previewSnapshot.repairItems.length === 0 && <div className="csr-dashboard-nodata">ยังไม่พบกล้องดับในข้อมูลรายงาน</div>}
            {previewSnapshot.repairItems.length > 12 && <p className="csr-dashboard-overflow-note">แสดงในภาพ 12 รายการแรกจาก {previewSnapshot.repairItems.length} รายการ • ระบบเก็บรายละเอียดครบทุกตัวไว้ในฐานข้อมูลเมื่อกดบันทึกรายงาน</p>}
            <p className="csr-dashboard-footer-note">สรุปจากข้อมูลกล้องรายตัวตามวัน/กะที่เลือก • ยังไม่ได้สร้างใบแจ้งซ่อมหรือเปลี่ยนสถานะงานซ่อม</p>
          </section>
        </div>
      </section>

    </div>
  )
}

/* =========================================
   CENTRAL DASHBOARD - SAME JSX FILE
   READ ONLY / NOT MOUNTING PING COMPONENT
========================================= */

function CameraAllCentersView({ shift }) {
  const [day, setDay] = useState(todayTH)

  const [selectedShift, setSelectedShift] = useState(
    SHIFTS[shift] ? shift : 'morning'
  )

  const [reports, setReports] = useState([])
  const [outageUnitRows, setOutageUnitRows] = useState([])
  const [outageUnitsLoading, setOutageUnitsLoading] = useState(true)
  const [outageUnitsError, setOutageUnitsError] = useState('')
  const [loadingAll, setLoadingAll] = useState(true)
  const [allError, setAllError] = useState('')
  const [refreshAll, setRefreshAll] = useState(0)
  const [exportingAll, setExportingAll] = useState(false)

  const allReportRef = useRef(null)

  useEffect(() => {
    if (SHIFTS[shift]) setSelectedShift(shift)
  }, [shift])

  /* โหลดข้อมูลจาก Supabase */

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      setLoadingAll(true)
      setAllError('')

      const { data, error } = await supabase.rpc(
        'camera_all_centers_daily',
        {
          p_report_date: day,
          p_shift: selectedShift,
        }
      )

      if (cancelled) return

      setReports(error ? [] : (data || []))

      if (error) {
        setAllError(error.message)
      }

      setLoadingAll(false)
    }

    loadAll()

    return () => {
      cancelled = true
    }
  }, [day, selectedShift, refreshAll])

  /* =========================================
    LOAD OUTAGE UNITS FOR CENTRAL DASHBOARD
  ========================================= */

  useEffect(() => {
    let cancelled = false

    async function loadOutageUnits() {
      setOutageUnitsLoading(true)
      setOutageUnitsError('')
      setOutageUnitRows([])

      const { data, error } = await supabase.rpc(
        'camera_all_centers_outage_units',
        {
          p_report_date: day,
          p_shift: selectedShift,
        }
      )

      if (cancelled) return

      if (error) {
        setOutageUnitsError(error.message)
        setOutageUnitRows([])
      } else {
        setOutageUnitRows(data || [])
      }

      setOutageUnitsLoading(false)
    }

    loadOutageUnits()

    return () => {
      cancelled = true
    }
  }, [day, selectedShift, refreshAll])

  /* จัดกลุ่มข้อมูลรายศูนย์ และคำนวณยอดรวม */

  const overview = useMemo(() => {
    const map = new Map()

    // ไม่รวมศูนย์ศชต.ในยอดและสถานะการส่งรายงาน
    const fieldReports = reports.filter(
      report => !isCctvCentralCenter(report.center_name)
    )

    for (const report of fieldReports) {
      const id = String(report.center_id)

      if (!map.has(id)) {
        map.set(id, {
          id,
          name: report.center_name,
          general: null,
          checkpoint: null,
        })
      }

      if (
        report.network_type === 'general' ||
        report.network_type === 'checkpoint'
      ) {
        map.get(id)[report.network_type] = report
      }
    }

    const centers = [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'th')
    )

    const aggregate = type => {
      const saved = fieldReports.filter(
        x => x.network_type === type && x.is_saved
      )

      const sum = key =>
        saved.reduce(
          (acc, item) => acc + Number(item[key] || 0),
          0
        )

      return {
        label:
          type === 'general' ? 'กล้องทั่วไป' : 'กล้องด่าน',
        type,
        hasReport: saved.length > 0,
        total: sum('total'),
        online: sum('online'),
        offline: sum('offline'),
        unknown: sum('unknown'),
        fullUnitCount: sum('full_unit_count'),
        fullUnitCameraCount: sum('full_unit_camera_count'),
        partialOfflineCount: sum('single_camera_offline_count'),
      }
    }

    return {
      centers,
      general: aggregate('general'),
      checkpoint: aggregate('checkpoint'),
    }
  }, [reports])

  

    const formatCount = x =>
      Number(x || 0).toLocaleString('th-TH')

    // คำนวณเปอร์เซ็นต์กล้องที่ใช้งานได้
    const cameraPercent = (online, total) =>
      Number(total) > 0
        ? `${((Number(online) || 0) / Number(total) * 100).toFixed(2)}%`
        : '—'

    // รวมกล้องทั่วไป + กล้องด่าน
    const allCameraTotals = {
      hasReport:
        overview.general.hasReport ||
        overview.checkpoint.hasReport,

      total:
        overview.general.total +
        overview.checkpoint.total,

      online:
        overview.general.online +
        overview.checkpoint.online,

      offline:
        overview.general.offline +
        overview.checkpoint.offline,

      unknown:
        overview.general.unknown +
        overview.checkpoint.unknown,
    }

    const multiCenterOutageRows = useMemo(() => {
    // รวมเฉพาะศูนย์ที่อยู่ใน Dashboard หลัก
    // ไม่รวมศูนย์ศชต.
    const validCenterIds = new Set(
      overview.centers.map(c => String(c.id))
    )

    return outageUnitRows
      .filter(item =>
        validCenterIds.has(String(item.center_id)) &&
        Number(item.down_count) > 0
      )
      .map(item => ({
        centerId: item.center_id,
        centerName: item.center_name,
        networkType: item.network_type,
        networkName:
          item.network_type === 'general'
            ? 'กล้องทั่วไป'
            : 'กล้องด่าน',
        unitLabel: item.unit_label,
        totalCount: Number(item.total_count || 0),
        downCount: Number(item.down_count || 0),
        isFull: item.is_full === true,
      }))
      .sort((a, b) =>
        a.centerName.localeCompare(b.centerName, 'th') ||
        a.networkName.localeCompare(b.networkName, 'th') ||
        b.downCount - a.downCount ||
        a.unitLabel.localeCompare(b.unitLabel, 'th')
      )
  }, [outageUnitRows, overview.centers])

  const fmtDateTime = value =>
    value
      ? new Date(value).toLocaleString('th-TH', {
          timeZone: 'Asia/Bangkok',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—'

  const savedCell = (report, key) =>
    report?.is_saved ? formatCount(report[key]) : '—'

  /* คัดลอกข้อความ */

  async function copyAllText() {
    const lines = [
      'สรุปสถานะกล้อง CCTV ทุกศูนย์',
      `${previewThaiDate(day)} • ${SHIFTS[selectedShift]}`,
    ]

    for (const n of [overview.general, overview.checkpoint]) {
      lines.push(
        `${n.label}: ทั้งหมด ${n.total} ติด ${n.online} ` +
        `ดับ ${n.offline} ดับทั้ง` +
        `${n.type === 'general' ? 'ตู้' : 'ด่าน'} ` +
        `${n.fullUnitCount} จุด ดับรายตัว ${n.partialOfflineCount}`
      )
    }

    for (const c of overview.centers) {
      lines.push(
        `${c.name}: ` +
        `ทั่วไป ติด ${savedCell(c.general, 'online')} / ` +
        `ดับ ${savedCell(c.general, 'offline')}; ` +
        `ด่าน ติด ${savedCell(c.checkpoint, 'online')} / ` +
        `ดับ ${savedCell(c.checkpoint, 'offline')}`
      )
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      window.alert('คัดลอกข้อความแล้ว')
    } catch (error) {
      window.alert(`คัดลอกไม่สำเร็จ: ${error.message}`)
    }
  }

  /* คัดลอกรูป / บันทึก PNG */

  async function exportAllPng(copy = false) {
    if (exportingAll || !allReportRef.current) return

    setExportingAll(true)

    try {
      const { default: html2canvas } =
        await import('html2canvas')

      const element = allReportRef.current

      const canvas = await html2canvas(element, {
        backgroundColor: '#0d1728',
        scale: 2,
        useCORS: true,
        width: element.scrollWidth,
        windowWidth: Math.max(
          window.innerWidth,
          element.scrollWidth
        ),
      })

      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/png')
      )

      if (!blob) {
        throw new Error('สร้าง PNG ไม่สำเร็จ')
      }

      if (copy) {
        if (
          !navigator.clipboard?.write ||
          typeof ClipboardItem === 'undefined'
        ) {
          throw new Error('เบราว์เซอร์ไม่รองรับการคัดลอกรูป')
        }

        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ])

        
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')

        link.href = url
        link.download =
          `cctv-all-centers-${day}-${selectedShift}.png`

        link.click()

        setTimeout(() => URL.revokeObjectURL(url), 1500)
      }
    } catch (error) {
      window.alert(`ส่งออก PNG ไม่สำเร็จ: ${error.message}`)
    } finally {
      setExportingAll(false)
    }
  }

  return (
    <div className="csr-root csr-multi-root">

      {/* HEADER / FILTERS */}

      <div className="csr-dashboard-tools">
        <div>
          <span className="csr-dashboard-eyebrow">
            CCTV NETWORK · ALL CENTERS
          </span>

          <h3>สรุปสถานะกล้องทุกศูนย์</h3>

          <p>
            ภาพรวมแบบอ่านอย่างเดียว
            จากข้อมูลที่บันทึกใน Supabase
          </p>
        </div>

        <div className="csr-multi-filters">
          <label>
            วันที่รายงาน
            <input
              type="date"
              value={day}
              onChange={e => setDay(e.target.value)}
            />
          </label>

          <label>
            กะ
            <select
              value={selectedShift}
              onChange={e =>
                setSelectedShift(e.target.value)
              }
            >
              {Object.entries(SHIFTS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setRefreshAll(v => v + 1)}
          >
            รีเฟรช
          </button>
        </div>
      </div>

      {loadingAll ? (
        <p>กำลังโหลดภาพรวมทุกศูนย์...</p>
      ) : allError ? (
        <p className="csr-multi-error">
          โหลดข้อมูลไม่สำเร็จ: {allError}
        </p>
      ) : (
        <>

          {/* EXPORT ACTIONS */}

          <div className="csr-dashboard-actions csr-multi-actions">
            <button type="button" onClick={copyAllText}>
              คัดลอกข้อความ
            </button>

            <button
              type="button"
              disabled={exportingAll}
              onClick={() => exportAllPng(true)}
            >
              คัดลอกรูป
            </button>

            <button
              type="button"
              className="csr-primary"
              disabled={exportingAll}
              onClick={() => exportAllPng(false)}
            >
              {exportingAll
                ? 'กำลังส่งออก...'
                : 'บันทึก PNG'}
            </button>
          </div>

          {/* DASHBOARD: เฉพาะกรอบนี้ถูกส่งออก PNG */}

          <div className="csr-multi-scroll">
            <div
              className="csr-dashboard-paper csr-multi-paper"
              ref={allReportRef}
            >
              <header className="csr-dashboard-paper-head">
                <div>
                  <span className="csr-dashboard-paper-kicker">
                    CCTV NETWORK · DAILY STATUS
                  </span>

                  <h2>สรุปรายงานสถานะกล้องทุกศูนย์</h2>

                  <p>
                    {previewThaiDate(day)}
                    {' • '}
                    {SHIFTS[selectedShift]}
                  </p>
                </div>

                <div className="csr-dashboard-report-date">
                  รายงานส่วนกลาง
                </div>
              </header>

              {/* DONUTS: ข้อมูลรวมทุกศูนย์ */}

              <div className="csr-dashboard-network-grid">
                {[overview.general, overview.checkpoint].map(
                  item => {
                    const parts = item.total > 0
                      ? [
                          {
                            key: 'green',
                            value: item.online,
                            color: '#27c997',
                          },
                          {
                            key: 'red',
                            value: item.offline,
                            color: '#f56876',
                          },
                          {
                            key: 'unknown',
                            value: item.unknown,
                            color: '#fbbf67',
                          },
                        ]
                      : []

                    let currentPct = 0

                    return (
                      <article
                        className="csr-dashboard-network-panel"
                        key={item.type}
                      >
                        <div className="csr-dashboard-panel-title">
                          <div>
                            <span>
                              {item.type === 'general'
                                ? '01 / CAMERA NETWORK'
                                : '02 / CHECKPOINT NETWORK'}
                            </span>

                            <h3>{item.label}</h3>
                          </div>
                        </div>

                        <div className="csr-dashboard-donut-row">
                          <div className="csr-dashboard-donut">
                            <svg
                              viewBox="0 0 120 120"
                              role="img"
                              aria-label={
                                `ใช้งานได้ ${previewPercentLabel(
                                  item.online,
                                  item.total
                                )}`
                              }
                            >
                              <circle
                                cx="60"
                                cy="60"
                                r="49"
                                fill="none"
                                stroke="#27384e"
                                strokeWidth="13"
                              />

                              {parts.map(part => {
                                const offset = currentPct

                                const length = previewPercent(
                                  part.value,
                                  item.total
                                )

                                currentPct += length

                                return (
                                  <circle
                                    key={part.key}
                                    cx="60"
                                    cy="60"
                                    r="49"
                                    fill="none"
                                    stroke={part.color}
                                    strokeWidth="13"
                                    strokeDasharray={
                                      `${length * 3.07876} ` +
                                      `${307.876 - length * 3.07876}`
                                    }
                                    strokeDashoffset={
                                      -offset * 3.07876
                                    }
                                    transform="rotate(-90 60 60)"
                                  />
                                )
                              })}
                            </svg>

                            <div className="csr-dashboard-donut-center">
                              <strong>
                                {item.hasReport
                                  ? previewPercentLabel(
                                      item.online,
                                      item.total
                                    )
                                  : '—'}
                              </strong>

                              <small>กล้องใช้งานได้</small>
                            </div>
                          </div>

                          <div className="csr-dashboard-mini-stats">
                            <div>
                              <small>กล้องทั้งหมด</small>
                              <strong>
                                {item.hasReport
                                  ? formatCount(item.total)
                                  : '—'}
                              </strong>
                            </div>

                            <div>
                              <span className="csr-dot is-green" />
                              <small>กล้องติด</small>
                              <strong>
                                {item.hasReport
                                  ? formatCount(item.online)
                                  : '—'}
                              </strong>
                            </div>

                            <div>
                              <span className="csr-dot is-red" />
                              <small>กล้องดับ</small>
                              <strong>
                                {item.hasReport
                                  ? formatCount(item.offline)
                                  : '—'}
                              </strong>
                            </div>
                          </div>
                        </div>

                        <div className="csr-dashboard-outage-box">
                          <strong>
                            {item.type === 'general'
                              ? 'ปัญหาระดับตู้กล้อง'
                              : 'ปัญหาระดับด่าน'}
                          </strong>

                          <div className="csr-dashboard-outage-three">
                            <div>
                              <b>
                                {item.hasReport
                                  ? formatCount(item.fullUnitCount)
                                  : '—'}
                              </b>
                              <small>
                                ดับทั้ง
                                {item.type === 'general'
                                  ? 'ตู้'
                                  : 'ด่าน'}
                              </small>
                            </div>

                            <div>
                              <b>
                                {item.hasReport
                                  ? formatCount(item.fullUnitCameraCount)
                                  : '—'}
                              </b>
                              <small>
                                กล้องในจุดที่ดับทั้งชุด
                              </small>
                            </div>

                            <div>
                              <b>
                                {item.hasReport
                                  ? formatCount(item.partialOfflineCount)
                                  : '—'}
                              </b>
                              <small>กล้องดับรายตัว</small>
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  }
                )}
              </div>

              {/* SUMMARY BY CENTER */}

                            {/* SUMMARY BY CENTER — อยู่ในภาพ PNG */}
              <section className="csr-multi-breakdown">
                <h3>สรุปสถานะกล้องรายศูนย์</h3>

                <div className="csr-multi-scroll">
                  <table className="csr-multi-table">
                    <thead>
                      <tr>
                        <th rowSpan="2">ศูนย์</th>
                        <th colSpan="7">กล้องทั่วไป</th>
                        <th colSpan="7">กล้องด่าน</th>
                      </tr>

                      <tr>
                        <th>ทั้งหมด</th>
                        <th>ติด</th>
                        <th>ดับ</th>
                        <th>% ใช้งาน</th>
                        <th>ดับทั้งตู้ (ตู้)</th>
                        <th>กล้องในตู้ที่ดับ (กล้อง)</th>
                        <th>ดับรายตัว</th>

                        <th>ทั้งหมด</th>
                        <th>ติด</th>
                        <th>ดับ</th>
                        <th>% ใช้งาน</th>
                        <th>ดับทั้งด่าน (ด่าน)</th>
                        <th>กล้องในด่านที่ดับ (กล้อง)</th>
                        <th>ดับรายตัว</th>
                      </tr>
                    </thead>

                    <tbody>
                      {overview.centers.map(center => (
                        <tr key={center.id}>
                          <td>{center.name}</td>

                          {['general', 'checkpoint'].flatMap(type => {
                            const report = center[type]

                            return [
                              <td key={`${type}-total`}>
                                {savedCell(report, 'total')}
                              </td>,

                              <td key={`${type}-online`}>
                                {savedCell(report, 'online')}
                              </td>,

                              <td key={`${type}-offline`}>
                                {savedCell(report, 'offline')}
                              </td>,

                              <td key={`${type}-percent`}>
                                {report?.is_saved
                                  ? cameraPercent(report.online, report.total)
                                  : '—'}
                              </td>,

                              <td
                                key={`${type}-units`}
                                className={
                                  report?.is_saved && Number(report.full_unit_count) > 0
                                    ? 'csr-outage-alert'
                                    : ''
                                }
                              >
                                {savedCell(report, 'full_unit_count')}
                              </td>,

                              <td
                                key={`${type}-unit-cameras`}
                                className={
                                  report?.is_saved && Number(report.full_unit_camera_count) > 0
                                    ? 'csr-outage-alert'
                                    : ''
                                }
                              >
                                {savedCell(report, 'full_unit_camera_count')}
                              </td>,

                              <td
                                key={`${type}-single`}
                                className={
                                  report?.is_saved && Number(report.single_camera_offline_count) > 0
                                    ? 'csr-outage-alert'
                                    : ''
                                }
                              >
                                {savedCell(report, 'single_camera_offline_count')}
                              </td>,
                            ]
                          })}
                        </tr>
                      ))}
                    </tbody>

                    {/* รวมทุกศูนย์ */}
                    <tfoot>
                      <tr className="csr-multi-total-row">
                        <td>รวมทุกศูนย์</td>

                        {['general', 'checkpoint'].flatMap(type => {
                          const item = overview[type]

                          const show = key =>
                            item.hasReport
                              ? formatCount(item[key])
                              : '—'

                          return [
                            <td key={`${type}-total`}>
                              {show('total')}
                            </td>,

                            <td key={`${type}-online`}>
                              {show('online')}
                            </td>,

                            <td key={`${type}-offline`}>
                              {show('offline')}
                            </td>,

                            <td key={`${type}-percent`}>
                              {item.hasReport
                                ? cameraPercent(item.online, item.total)
                                : '—'}
                            </td>,

                            <td key={`${type}-units`}></td>,

                            <td key={`${type}-unit-cameras`}></td>,

                            <td key={`${type}-single`}></td>,
                          ]
                        })}
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* ตารางรวมทั้งสองประเภท */}
                <h3 className="csr-multi-overall-title">
                  ศูนย์ที่มีกล้องดับ / ตู้หรือด่านที่มีปัญหา
                </h3>

                <table className="csr-multi-table csr-multi-overall-table">
                  <thead>
                    <tr>
                      <th>ศูนย์</th>
                      <th>เครือข่าย</th>
                      <th>ตู้ / ด่าน</th>
                      <th>สถานะ</th>
                      <th>สรุปการดับ</th>
                    </tr>
                  </thead>

                  <tbody>
                    {outageUnitsLoading ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center' }}>
                          กำลังโหลดข้อมูลกล้องดับรายตู้/ด่าน...
                        </td>
                      </tr>
                    ) : outageUnitsError ? (
                      <tr>
                        <td
                          colSpan={5}
                          style={{ textAlign: 'center', color: '#f87171' }}
                        >
                          โหลดข้อมูลไม่สำเร็จ: {outageUnitsError}
                        </td>
                      </tr>
                    ) : multiCenterOutageRows.length > 0 ? (
                      multiCenterOutageRows.map((item, index) => (
                        <tr
                          key={`${item.centerId}-${item.networkType}-${item.unitLabel}-${index}`}
                        >
                          <td>{item.centerName}</td>

                          <td>{item.networkName}</td>

                          <td>{item.unitLabel}</td>

                          <td>
                            {item.isFull
                              ? item.networkType === 'general'
                                ? 'ดับทั้งตู้'
                                : 'ดับทั้งด่าน'
                              : 'ดับบางกล้อง'}
                          </td>

                          <td>
                            {`ดับ ${formatCount(item.downCount)} กล้อง`}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center' }}>
                          ไม่มีรายการกล้องดับจากรายงานที่บันทึกไว้
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <p>
                  แสดงเฉพาะศูนย์ที่บันทึกรายงานแล้ว และมีอย่างน้อย 1 กล้องดับ
                  {' • '}
                  ไม่แสดงรายละเอียดรายชื่อกล้องย่อย
                  {' • '}
                  ถ้าดับทั้งตู้/ด่าน จะแสดงเป็น “ดับ X กล้อง จาก X กล้อง”
                </p>
              </section>

            </div>
          </div>

          {/* SUBMISSION STATUS: นอกภาพ PNG */}

          <section className="csr-multi-submissions">
            <h3>
              ติดตามสถานะการบันทึกรายงานของแต่ละศูนย์
            </h3>

            <div className="csr-multi-scroll">
              <table className="csr-multi-table">
                <thead>
                  <tr>
                    <th>ศูนย์</th>
                    <th>กล้องทั่วไป</th>
                    <th>บันทึกล่าสุด</th>
                    <th>กล้องด่าน</th>
                    <th>บันทึกล่าสุด</th>
                  </tr>
                </thead>

                <tbody>
                  {overview.centers.map(center => (
                    <tr key={center.id}>
                      <td>{center.name}</td>

                      {['general', 'checkpoint'].map(type => {
                        const report = center[type]

                        return [
                          <td key={`${type}-status`}>
                            <span
                              className={`csr-multi-status ${
                                !report?.is_saved
                                  ? 'missing'
                                  : report.is_final
                                    ? 'complete'
                                    : 'draft'
                              }`}
                            >
                              {!report?.is_saved
                                ? 'ยังไม่บันทึก'
                                : report.is_final
                                  ? 'บันทึกแล้ว · ยืนยันครบ'
                                  : 'บันทึกแล้ว · ชั่วคราว'}
                            </span>
                          </td>,

                          <td key={`${type}-time`}>
                            {report?.is_saved
                              ? fmtDateTime(report.updated_at)
                              : '—'}
                          </td>,
                        ]
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </>
      )}
    </div>
  )
}

/* =========================================
   SAME PAGE - CENTER SELECTION ROUTER
   centercctv = Central dashboard
   Admin / Supervisor:
     ศูนย์ศชต. = Central dashboard
     Other center = Existing Ping page
========================================= */

function isCctvCentralCenter(name) {
  const normalized = String(name || '')
    .replace(/[\s.\u200B\uFF0E]/g, '')
    .toLowerCase()

  return (
    normalized === 'ศูนย์ศชต' ||
    normalized === 'ศชต'
  )
}

export default function CameraStatusReport(props) {
  const role = String(props.profile?.role || '').toLowerCase()

  // super เป็นคำเรียกย่อ แต่ Role จริงคือ supervisor
  const isManager =
    role === 'admin' ||
    role === 'supervisor'

  const [centralAccess, setCentralAccess] = useState(null)
  const [accessError, setAccessError] = useState('')

  const [allCenters, setAllCenters] = useState([])
  const [centerLoading, setCenterLoading] = useState(isManager)
  const [centerError, setCenterError] = useState('')

  const [selectedCenterId, setSelectedCenterId] = useState(
    () => String(props.profile?.center_id || '')
  )

  // ตรวจสิทธิ์ดูข้อมูลทุกศูนย์จาก Supabase
  useEffect(() => {
    let cancelled = false

    async function checkAccess() {
      setCentralAccess(null)
      setAccessError('')

      const { data, error } = await supabase.rpc(
        'camera_can_view_all_centers'
      )

      if (cancelled) return

      if (error) {
        setAccessError(error.message)
      } else {
        setCentralAccess(data === true)
      }
    }

    checkAccess()

    return () => {
      cancelled = true
    }
  }, [props.profile?.id])

  // Admin / Supervisor อ่านรายชื่อศูนย์เพื่อเลือกหน้า
  useEffect(() => {
    let cancelled = false

    if (!isManager) {
      setCenterLoading(false)
      setAllCenters([])
      return
    }

    async function loadCenters() {
      setCenterLoading(true)
      setCenterError('')

      const { data, error } = await supabase
        .from('centers')
        .select('id,name')
        .order('name')

      if (cancelled) return

      if (error) {
        setCenterError(error.message)
        setAllCenters([])
      } else {
        const items = data || []

        setAllCenters(items)

        setSelectedCenterId(previous => {
          const exists = items.some(
            c => String(c.id) === String(previous)
          )

          if (exists) return String(previous)

          const profileCenter = String(
            props.profile?.center_id || ''
          )

          const profileCenterExists = items.some(
            c => String(c.id) === profileCenter
          )

          return profileCenterExists
            ? profileCenter
            : String(items[0]?.id || '')
        })
      }

      setCenterLoading(false)
    }

    loadCenters()

    return () => {
      cancelled = true
    }
  }, [
    isManager,
    props.profile?.id,
    props.profile?.center_id,
  ])

  // หาศูนย์ที่ Admin/Supervisor กำลังเลือก
  const selectedCenter = allCenters.find(
    c => String(c.id) === String(selectedCenterId)
  )

  const selectedCentralCenter =
    isManager &&
    isCctvCentralCenter(selectedCenter?.name)

  // บัญชีส่วนกลางที่ได้รับสิทธิ์เข้า Dashboard โดยตรง
  // Admin/Supervisor ต้องเลือกศูนย์ศชต. ก่อน
  const showCentralDashboard = isManager
    ? selectedCentralCenter
    : centralAccess === true

  if (accessError) {
    return (
      <div className="csr-root">
        ตรวจสอบสิทธิ์ไม่สำเร็จ: {accessError}
      </div>
    )
  }

  if (centralAccess === null || (isManager && centerLoading)) {
    return (
      <div className="csr-root">
        กำลังตรวจสอบสิทธิ์และรายชื่อศูนย์...
      </div>
    )
  }

  if (isManager && centerError) {
    return (
      <div className="csr-root">
        โหลดรายชื่อศูนย์ไม่สำเร็จ: {centerError}
      </div>
    )
  }

  // เลือกศูนย์ศชต. แต่ยังไม่ได้รับสิทธิ์อ่านข้อมูลรวม
  if (selectedCentralCenter && !centralAccess) {
    return (
      <div className="csr-root">
        บัญชีนี้ยังไม่ได้รับสิทธิ์ดู Dashboard ทุกศูนย์
        กรุณาตรวจ SQL camera_can_view_all_centers
      </div>
    )
  }

  // =========================================
  // CENTRAL DASHBOARD
  // =========================================

  if (showCentralDashboard) {
    return (
      <>
        {/* Admin / Supervisor ต้องเลือกกลับไปศูนย์อื่นได้ */}
        {isManager && (
          <div className="csr-root csr-central-center-picker">
            <label>
              <span>เลือกศูนย์</span>

              <select
                value={selectedCenterId}
                onChange={e =>
                  setSelectedCenterId(e.target.value)
                }
              >
                {allCenters.map(center => (
                  <option
                    key={center.id}
                    value={center.id}
                  >
                    {center.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <CameraAllCentersView shift={props.shift} />
      </>
    )
  }

  // =========================================
  // ORIGINAL CCTV PING PAGE
  // =========================================

  return (
    <CameraStatusReportCenter
      {...props}
      initialCenterId={isManager ? selectedCenterId : undefined}
      onCenterChange={
        isManager ? setSelectedCenterId : undefined
      }
    />
  )
}