
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './TechnicianRepair.css'
import { formatMemberPhone } from './Users'
import CctvRepairPrint from './daily/CctvRepairPrint'

// ขอบเขตการมองเห็นของช่าง (ตรวจสิทธิ์จริงซ้ำใน RLS)
const TEAM_CENTERS = {
  takbai: [1, 7, 8],
  pattani: [2, 4, 9],
}
const REPORT_CENTER_IDS = [1, 2, 4, 7, 8, 9]

const CENTER_NAMES = {
  1: 'ศูนย์นราธิวาส',
  2: 'ศูนย์ปัตตานี',
  4: 'ศูนย์หาดใหญ่',
  7: 'ศูนย์ตากใบ',
  8: 'ศูนย์สุไหง-โกลก',
  9: 'ศูนย์เบตง',
}

const TEAMS = {
  takbai: 'ชุดช่างตากใบ',
  pattani: 'ชุดช่างปัตตานี',
}

const OPEN_STATUSES = [
  'submitted',
  'accepted',
  'in_progress',
  'completed',
]

const STATUS = {
  submitted: 'เปิดงานแล้ว',
  accepted: 'รับงานแล้ว',
  in_progress: 'กำลังซ่อม',
  completed: 'ซ่อมเสร็จ',
  closed: 'ปิดงานแล้ว',
  cancelled: 'ยกเลิกแล้ว',
}

const EQUIPMENT = [
  'Camera',
  'Switch 8 port',
  'Power Supply 12 - 24V',
  'Media Converter',
  'Power supply 5 V',
  'สาย LAN',
  'ไฟฟ้า AC',
  'Fiber optic',
  'SFP',
  'NVR',
  'Computer',
  'Service Box',
  'มุมกล้อง',
  'ใช้งานได้จริง',
]

const PAGE_SIZE = 10

// รายงาน Log Book (ใช้ข้อมูลจริงจากใบแจ้งซ่อมเดิม)
// ไม่รวมรายการประเภทพิเศษเป็นประเภทอุปกรณ์ใหม่ และไม่สร้างตารางฐานข้อมูลเพิ่ม
const REPORT_PAGE_SIZE = 10
const REPORT_FETCH_SIZE = 500
const REPORT_UNITS_BATCH = 100
const REPORT_THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

const reportInitialFilters = () => {
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
  return {
    period: 'month', day: today, month: today.slice(0, 7),
    year: String(Number(today.slice(0, 4)) + 543), from: today, to: today,
    center: '', status: 'all',
  }
}

const reportNextDay = value => {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

const reportDateBounds = filters => {
  let first = ''
  let last = ''
  if (filters.period === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.day)) {
      throw new Error('กรุณาเลือกวันที่แจ้งซ่อม')
    }
    first = filters.day
    last = reportNextDay(first)
  } else if (filters.period === 'month') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month)) {
      throw new Error('กรุณาเลือกเดือน')
    }
    first = `${filters.month}-01`
    const [y, m] = filters.month.split('-').map(Number)
    last = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  } else if (filters.period === 'year') {
    const adYear = Number(filters.year) - 543
    if (!/^\d{4}$/.test(String(filters.year)) || adYear < 2000 || adYear > 9998) {
      throw new Error('กรุณาระบุปี พ.ศ. ให้ถูกต้อง')
    }
    first = `${adYear}-01-01`
    last = `${adYear + 1}-01-01`
  } else {
    if (!filters.from || !filters.to || filters.from > filters.to) {
      throw new Error('กรุณาเลือกวันเริ่มต้นและสิ้นสุดให้ถูกต้อง')
    }
    first = filters.from
    last = reportNextDay(filters.to)
  }
  return {
    start: `${first}T00:00:00+07:00`,
    end: `${last}T00:00:00+07:00`,
  }
}

const reportPeriodTitle = f => {
  if (f.period === 'day') return `ประจำวันที่ ${f.day}`
  if (f.period === 'month') {
    const [year, month] = f.month.split('-').map(Number)
    return `ประจำเดือน${REPORT_THAI_MONTHS[month - 1] || ''} ${year + 543}`
  }
  if (f.period === 'year') return `ประจำปี ${f.year}`
  return `ตั้งแต่ ${f.from} ถึง ${f.to}`
}

const reportInt = x => {
  const n = Number(x)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

const reportEquipmentCounts = (order, name) => {
  // ก่อนช่างปิดงาน ยังไม่ทราบผลตรวจ จึงไม่แสดงเป็นเลข 0
  if (order.status !== 'closed' || !Array.isArray(order.equipment_items)) {
    return { damaged: null, stuck: null }
  }
  let damaged = 0
  let stuck = 0
  for (const item of order.equipment_items) {
    if (item?.name !== name) continue
    if (item.is_damaged) damaged += reportInt(item.failed_count)
    // ช่องนี้คือ 'จำนวนค้าง/Reset' ตามนิยามของฟอร์มช่าง ไม่ใช่จำนวนอุปกรณ์เฉพาะตัว
    if (item.is_stuck) stuck += reportInt(item.reset_count)
  }
  return { damaged, stuck }
}

const reportEquipmentTotals = rows => {
  const totals = EQUIPMENT.map(name => ({ name, damaged: 0, stuck: 0 }))
  rows.forEach(order => {
    totals.forEach(item => {
      const counts = reportEquipmentCounts(order, item.name)
      item.damaged += counts.damaged || 0
      item.stuck += counts.stuck || 0
    })
  })
  return totals
}

const reportSafeExcelText = value => {
  const s = String(value ?? '')
  // ป้องกันข้อความจากฐานข้อมูลถูก Excel ตีความเป็นสูตร
  return /^[\s]*[=+\-@]/.test(s) ? `'${s}` : s
}

const reportCellDate = value => value ? formatDate(value) : '—'

const EMPTY_CENTER_IDS = []

const INITIAL_FILTERS = {
  center: '',
  ticket: '',
  status: 'all',
  period: 'all',
  month: '',
  from: '',
  to: '',
}

const equipmentBlank = name => ({
  name,
  is_damaged: false,
  is_stuck: false,
  is_replaced: false,
  failed_count: '1',
  reset_count: '1',
  old_sn: '',
  new_sn: '',
})

const localNow = () => {
  const iso = new Date(
    Date.now() + 7 * 3600000
  ).toISOString()

  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  }
}

const dateToInputs = value => {
  if (!value) return localNow()

  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return localNow()

  const iso = new Date(
    d.getTime() + 7 * 3600000
  ).toISOString()

  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  }
}

const makeForm = (profile, count, order = null) => {
  const done = order
    ? dateToInputs(order.repair_completed_at)
    : localNow()

  const saved = Array.isArray(order?.equipment_items)
    ? order.equipment_items
    : []

  const rows = EQUIPMENT.map(name => {
  const item = saved.find(x => x.name === name)

  if (!item) return equipmentBlank(name)

  const serials = Array.isArray(item.serial_numbers)
    ? item.serial_numbers
    : null

  return {
    ...equipmentBlank(name),
    ...item,
    is_damaged: Boolean(item.is_damaged),
    is_stuck: Boolean(item.is_stuck),
    is_replaced: Boolean(item.is_replaced),

    failed_count: String(
      Number(item.failed_count) > 0
        ? item.failed_count
        : 1
    ),
    reset_count: String(
      Number(item.reset_count) > 0
        ? item.reset_count
        : 1
    ),

    old_sn: serials
      ? serials.map(s => s.old_sn || '').join('\n')
      : String(item.old_sn || ''),

    new_sn: serials
      ? serials.map(s => s.new_sn || '').join('\n')
      : String(item.new_sn || ''),
  }
})

  return {
    problem: order?.repair_problem_found || '',
    method: order?.repair_fix_method || '',
    down: String(order?.repair_down_count ?? count),
    usable: String(order?.repair_usable_count ?? ''),
    unusable: String(order?.repair_unusable_count ?? ''),
    unusableReason: order?.repair_unusable_reason || '',
    doneDate: done.date,
    doneTime: done.time,
    slaChoice: order?.repair_sla_exceeded
      ? 'over'
      : 'within',
    slaReason: order?.repair_sla_reason || '',
  
    technician: order?.technician_names || '',
    phone: formatMemberPhone(order?.technician_phone)
      || order?.technician_phone || '',
    equipment: rows,

  }
}

const bangkokDate = (date, time) => {
  const d = String(date || '').slice(0, 10)
  const t = String(time || '').slice(0, 5)

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)
  ) {
    return null
  }

  const out = new Date(`${d}T${t}:00+07:00`)
  return Number.isNaN(out.getTime()) ? null : out
}

const formatDate = (value, withTime = true) => {
  if (!value) return 'ยังไม่ระบุ'

  const d = value instanceof Date
    ? value
    : new Date(value)

  if (Number.isNaN(d.getTime())) {
    return 'วันที่ไม่ถูกต้อง'
  }

  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }
      : {}),
  }).format(d)
}

const formatDay = value =>
  value
    ? formatDate(
        new Date(
          `${String(value).slice(0, 10)}T12:00:00+07:00`
        ),
        false
      )
    : 'ยังไม่ระบุ'

const plusOneDay = value => {
  const [y, m, d] = value.split('-').map(Number)

  return new Date(
    Date.UTC(y, m - 1, d + 1)
  ).toISOString().slice(0, 10)
}

const validInteger = s =>
  /^\d+$/.test(String(s).trim())

const serialParts = value =>
  String(value ?? '')
    .replace(/\r/g, '')
    .split('\n')

const serialAt = (value, index) =>
  serialParts(value)[index] ?? ''

const ticketLabel = o =>
  o?.ticket_no || `#${o?.id}`

export default function TechnicianRepair({ profile }) {
  const role = String(
    profile?.role || ''
  ).toLowerCase()

  const team = String(
    profile?.repair_team_code || ''
  ).toLowerCase()

  const isTechnician = role === 'technician'
  const isAdmin = role === 'admin'
  const isManager =
    isAdmin || role === 'supervisor'

  const isCentral =
    role === 'center' &&
    Number(profile?.center_id) === 10 &&
    String(profile?.username || '').toLowerCase() ===
      'centercctv'

  const isCenter =
    role === 'center' && !isCentral

  const scopeIds =
    TEAM_CENTERS[team] || EMPTY_CENTER_IDS

  const authorized =
    profile?.active !== false &&
    (
      isManager ||
      isCentral ||
      (isTechnician && scopeIds.length > 0) ||
      (isCenter && Boolean(profile?.center_id))
    )

  
  const canManage = o =>
    Boolean(o) &&
    (
      isAdmin ||
      (
        isTechnician &&
        ['takbai', 'pattani'].includes(team) &&
        String(o.team_code || '').toLowerCase() === team &&
        scopeIds.includes(Number(o.center_id))
      )
    )


  const canClose = o =>
    canManage(o) &&
    OPEN_STATUSES.includes(o?.status)

  const canEdit = o =>
    canManage(o) &&
    o?.status === 'closed'

  const canCancel = o =>
    Boolean(o) &&
    OPEN_STATUSES.includes(o.status) &&
    (canManage(o) || isCentral || isManager)

  
  const canHardDelete = o =>
    isAdmin &&
    ['cancelled', 'closed'].includes(o?.status)


  const [orders, setOrders] = useState([])
  const [centers, setCenters] = useState([])
  

  const [selectedId, setSelectedId] = useState(null)
  const [units, setUnits] = useState([])
  const [history, setHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  const [unitError, setUnitError] = useState('')
  const [busyUnits, setBusyUnits] = useState(false)
  const [busyList, setBusyList] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  const [modalOrder, setModalOrder] = useState(null)
  const [modalMode, setModalMode] = useState('close')
  const [editReason, setEditReason] = useState('')
  const [form, setForm] = useState(
    () => makeForm(profile, 0)
  )
  const [modalCount, setModalCount] = useState(0)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalSaving, setModalSaving] = useState(false)
  const [modalError, setModalError] = useState('')
  const [technicians, setTechnicians] = useState([])
  const [techniciansError, setTechniciansError] = useState('')
  const [printPreview, setPrintPreview] = useState(null)
  const [printBusy, setPrintBusy] = useState(false)

  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')


  // หน้ารายงานใช้ข้อมูลที่อ่านได้ตาม RLS ของผู้ใช้ปัจจุบันเท่านั้น
  const [repairView, setRepairView] = useState('orders')
  const [reportFilters, setReportFilters] = useState(reportInitialFilters)
  const [reportRows, setReportRows] = useState([])
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportExportBusy, setReportExportBusy] = useState(false)
  const [reportPage, setReportPage] = useState(0)
  const [reportRefresh, setReportRefresh] = useState(0)

  const reportChangeFilter = (key, value) => {
    setReportFilters(old => ({ ...old, [key]: value }))
    setReportPage(0)
  }

  useEffect(() => {
    if (repairView !== 'report' || !authorized) return
    let live = true
    setReportBusy(true)
    setReportError('')
    setReportRows([])
    setReportPage(0)

    async function fetchReport() {
      try {
        const bounds = reportDateBounds(reportFilters)
        const found = []
        let offset = 0
        while (true) {
          let query = supabase
            .from('cctv_repair_orders')
            .select(`
              id, ticket_no, center_id, center_name_snapshot, team_code,
              submitted_at, outage_date, outage_time, status, repair_completed_at,
              repair_problem_found, repair_fix_method, repair_down_count,
              repair_usable_count, repair_unusable_count, technician_names,
              repair_sla_exceeded, equipment_items
            `)
            .neq('status', 'draft')
            .gte('submitted_at', bounds.start)
            .lt('submitted_at', bounds.end)

          // กรองศูนย์ตามสิทธิ์แบบเดียวกับหน้าใบงานเดิม (RLS ยังคุมฝั่งฐานข้อมูล)
          // กำหนดขอบเขตข้อมูลตามบัญชี
          if (isTechnician) {
            query = query.in('center_id', scopeIds)
          } else if (isCentral || isManager) {
            query = query.in('center_id', REPORT_CENTER_IDS)
          } else if (isCenter) {
            query = query.eq('center_id', Number(profile.center_id))
          }

          // กรองศูนย์เพิ่มเติมภายในขอบเขตที่ได้รับอนุญาต
          if (!isCenter && !isCentral && reportFilters.center) {
            const selectedCenter = Number(reportFilters.center)

            if (
              !REPORT_CENTER_IDS.includes(selectedCenter) ||
              (isTechnician && !scopeIds.includes(selectedCenter))
            ) {
              throw new Error('ไม่มีสิทธิ์ดูรายงานของศูนย์ที่เลือก')
            }

            query = query.eq('center_id', selectedCenter)
          }
          if (reportFilters.status === 'open') {
            query = query.in('status', OPEN_STATUSES)
          } else if (['closed', 'cancelled'].includes(reportFilters.status)) {
            query = query.eq('status', reportFilters.status)
          }
          const { data, error: err } = await query
            .order('submitted_at', { ascending: true, nullsFirst: false })
            .order('id', { ascending: true })
            .range(offset, offset + REPORT_FETCH_SIZE - 1)
          if (err) throw err
          if (!live) return
          const pageRows = data || []
          found.push(...pageRows)
          if (pageRows.length < REPORT_FETCH_SIZE) break
          offset += REPORT_FETCH_SIZE
        }

        // ดึงจุด / Service Box ตามใบงานที่ผ่านการกรองแล้วเท่านั้น
        const unitsByOrder = new Map()
        const ids = found.map(o => o.id)
        for (let i = 0; i < ids.length; i += REPORT_UNITS_BATCH) {
          const chunk = ids.slice(i, i + REPORT_UNITS_BATCH)
          const { data, error: err } = await supabase
            .from('cctv_repair_order_units')
            .select('order_id, unit_label, down_camera_count')
            .in('order_id', chunk)
          if (err) throw err
          if (!live) return
          for (const unit of (data || [])) {
            const previous = unitsByOrder.get(unit.order_id) || []
            previous.push(unit)
            unitsByOrder.set(unit.order_id, previous)
          }
        }
        const merged = found.map(o => ({
          ...o,
          reportUnits: unitsByOrder.get(o.id) || [],
        }))
        if (live) setReportRows(merged)
      } catch (err) {
        if (live) {
          setReportRows([])
          setReportError(err.message || 'โหลดรายงานไม่สำเร็จ')
        }
      } finally {
        if (live) setReportBusy(false)
      }
    }
    fetchReport()
    return () => { live = false }
  }, [
    repairView,
    reportFilters,
    reportRefresh,
    authorized,
    isTechnician,
    isCenter,
    isCentral,
    isManager,
    scopeIds,
    profile?.center_id,
  ])

  const reportTotals = useMemo(() => {
    const closed = reportRows.filter(x => x.status === 'closed')
    const equipment = reportEquipmentTotals(reportRows)
    return {
      count: reportRows.length,
      closed: closed.length,
      open: reportRows.filter(x => OPEN_STATUSES.includes(x.status)).length,
      late: closed.filter(x => x.repair_sla_exceeded === true).length,
      damaged: equipment.reduce((s, x) => s + x.damaged, 0),
      stuck: equipment.reduce((s, x) => s + x.stuck, 0),
      equipment,
    }
  }, [reportRows])

/* REPAIR_LOGBOOK_EXCEL_V2 */
/* REPAIR_LOGBOOK_EXCEL_WIDTHS_V3 */
  const exportRepairLogBook = async () => {
    if (reportBusy || reportExportBusy || reportError || reportRows.length === 0) return
    setReportExportBusy(true)
    setReportError('')
    try {
      const excelModule = await import('exceljs-community')
      const ExcelJS = excelModule.default || excelModule
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'CCTV Repair Workspace'
      workbook.created = new Date()
      const sheet = workbook.addWorksheet('Log Book แจ้งซ่อม', {
        pageSetup: { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      })
      const baseHeaders = [
        ['ลำดับ', 6], ['เลขใบงาน', 15], ['ศูนย์', 18], ['วันที่แจ้ง', 18],
        ['วันที่กล้องดับ', 18], ['กำหนด SLA 72 ชม.', 18], ['สถานะ', 13], ['วันที่ซ่อมเสร็จ', 18],
        ['ช่างผู้ปฏิบัติงาน', 19], ['กล้องดับ (ตัว)', 11], ['ใช้งานได้ (ตัว)', 12], ['ยังใช้ไม่ได้ (ตัว)', 14],
        ['ผล SLA', 13],
      ]
      const baseCount = baseHeaders.length
      const totalCols = baseCount + EQUIPMENT.length * 2
      const dark = '20334D'
      const blue = '254A6F'
      // หัวอุปกรณ์แต่ละประเภทใช้โทนสีประจำกลุ่ม; light / alt เป็นสีแถวข้อมูล
      const equipmentPalette = [
        ['2B638E', 'E5F1FA', 'F2F8FD'], // Camera
        ['675392', 'EEE8F8', 'F7F3FC'], // Switch
        ['976B2E', 'FFF0D6', 'FFF8EA'], // Power supply 12-24V
        ['2B7779', 'DEF3F0', 'EFF9F7'], // Media Converter
        ['9A5479', 'F8E4EF', 'FDF2F8'], // Power supply 5V
        ['A66336', 'FCEBD9', 'FFF5E9'], // สาย LAN
        ['4F7E48', 'E7F3E2', 'F4FAF1'], // ไฟฟ้า AC
        ['536DA2', 'E4EBFA', 'F3F6FE'], // Fiber optic
        ['74599D', 'EDE6F8', 'F7F2FC'], // SFP
        ['3F6E86', 'E3EFF4', 'F2F8FA'], // NVR
        ['796B3B', 'F1EDDE', 'F9F7EF'], // Computer
        ['865E68', 'F4E6E9', 'FBF3F5'], // Service Box (อุปกรณ์)
        ['3B7C68', 'E1F2EB', 'F1F9F5'], // มุมกล้อง
        ['6C6B94', 'EBEAF6', 'F7F6FB'], // ใช้งานได้จริง
      ]
      const thinBorder = { style: 'hair', color: { argb: 'FFD2DCE8' } }
      /* REPAIR_LOGBOOK_LAYOUT_V6 */
      // สีเส้นตารางชัดกว่าของเดิม ขอบคู่คอลัมน์หนา / ภายในคู่เป็นเส้นบาง
      // เส้นตารางอุปกรณ์สีขาวตามไฟล์ตัวอย่าง (ไม่ใช้เส้นเทา/น้ำเงินแบบ V6)
      const reportGridLine = { style: 'thin', color: { argb: 'FFFFFFFF' } }
      const reportPairLine = { style: 'thin', color: { argb: 'FFFFFFFF' } }
      const reportEquipmentBorder = col => ({
        top: reportGridLine,
        bottom: reportGridLine,
        left: (col - baseCount) % 2 === 1 ? reportPairLine : reportGridLine,
        right: (col - baseCount) % 2 === 0 ? reportPairLine : reportGridLine,
      })
      const bg = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${argb}` } })
      sheet.mergeCells(1, 1, 1, totalCols)
      sheet.getCell(1, 1).value = 'LOG BOOK รายงานสรุปการแจ้งซ่อม CCTV'
      sheet.getCell(1, 1).font = { name: 'Tahoma', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
      sheet.getRow(1).height = 36
      sheet.getCell(1, 1).fill = bg(dark)

      const getCenterName = id =>
        centers.find(c => Number(c.id) === Number(id))?.name ||
        CENTER_NAMES[id] ||
        'ไม่ระบุศูนย์'

      let centreName = ''

      if (isCenter) {
        centreName = getCenterName(profile.center_id)
      } else if (isCentral) {
        centreName = 'ศชต. (รวม 6 ศูนย์)'
      } else if (isTechnician) {
        centreName = TEAMS[team] || 'ทีมช่าง'

        if (reportFilters.center) {
          centreName += ` - ${getCenterName(reportFilters.center)}`
        }
      } else if (reportFilters.center) {
        centreName = getCenterName(reportFilters.center)
      } else {
        centreName = 'รวม 6 ศูนย์'
      }
      const statusName = { all: 'ทุกสถานะ', open: 'ยังไม่ปิด', closed: 'ปิดแล้ว', cancelled: 'ยกเลิก' }[reportFilters.status]
      sheet.mergeCells(2, 1, 2, totalCols)
      sheet.getCell(2, 1).value = reportSafeExcelText(`${reportPeriodTitle(reportFilters)}  |  ${centreName}  |  ${statusName}  |  ออกรายงาน ${formatDate(new Date())}`)
      sheet.getCell(2, 1).font = { name: 'Tahoma', size: 11, color: { argb: 'FF27425F' } }
      sheet.getCell(2, 1).alignment = { vertical: 'middle', indent: 1 }
      sheet.getRow(2).height = 26
      sheet.getCell(2, 1).fill = bg('EDF4FA')

      // สรุป 6 KPI ให้อยู่บริเวณซ้ายบน (A3:L4) ไม่กินความกว้างทั้งชีต
      const topSummary = [
        { label: 'ใบงานทั้งหมด', value: reportTotals.count, color: 'E7F0FA', ink: '244D74' },
        { label: 'ปิดงานแล้ว', value: reportTotals.closed, color: 'DDF4E8', ink: '176447' },
        { label: 'ยังไม่ปิด', value: reportTotals.open, color: 'FFF1D8', ink: '84591C' },
        { label: 'เกิน SLA', value: reportTotals.late, color: 'FBE3E7', ink: '943047' },
        { label: 'อุปกรณ์เสีย', value: reportTotals.damaged, color: 'E9E5F9', ink: '594A93' },
        { label: 'ค้าง / Reset', value: reportTotals.stuck, color: 'DFF2F2', ink: '216D74' },
      ]
      topSummary.forEach((item, i) => {
        const rowNumber = 3 + Math.floor(i / 3)
        const firstColumn = 1 + (i % 3) * 4
        sheet.mergeCells(rowNumber, firstColumn, rowNumber, firstColumn + 3)
        const cell = sheet.getCell(rowNumber, firstColumn)
        cell.value = `${item.label}  :  ${Number(item.value).toLocaleString('th-TH')}`
        cell.fill = bg(item.color)
        cell.font = { name: 'Tahoma', size: 13, bold: true, color: { argb: `FF${item.ink}` } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      })
      sheet.getRow(3).height = 34
      sheet.getRow(4).height = 34

      sheet.mergeCells(5, 1, 5, baseCount)
      const primaryGroup = sheet.getCell(5, 1)
      primaryGroup.value = 'รายละเอียดใบแจ้งซ่อม'
      primaryGroup.fill = bg(blue)
      primaryGroup.font = { name: 'Tahoma', bold: true, color: { argb: 'FFFFFFFF' } }
      primaryGroup.alignment = { horizontal: 'center', vertical: 'middle' }
      /* REPAIR_LOGBOOK_TOTALS_TOP_V4 */
      /* REPAIR_LOGBOOK_TOTALS_SPLIT_V5 */
      /* REPAIR_LOGBOOK_TEMPLATE_WHITE_V7 */
      // จัดอุปกรณ์ให้อยู่แถวเดียวกับ KPI ฝั่งซ้าย ตามไฟล์ Excel ที่แก้เป็นตัวอย่าง
      // แถว 3: ชื่ออุปกรณ์ / แถว 4: ยอดรวม / แถว 5: เสีย-ค้าง / แถว 6: ยอดแยก
      EQUIPMENT.forEach((name, i) => {
        const firstCol = baseCount + i * 2 + 1
        sheet.mergeCells(3, firstCol, 3, firstCol + 1)
        const cell = sheet.getCell(3, firstCol)
        cell.value = name
        cell.fill = bg(equipmentPalette[i % equipmentPalette.length][0])
        cell.font = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.border = { left: reportPairLine, right: reportPairLine, bottom: reportGridLine }
      })

      const totalsRow = sheet.getRow(4)
      reportTotals.equipment.forEach((item, i) => {
        const col = baseCount + i * 2 + 1
        sheet.mergeCells(4, col, 4, col + 1)
        const cell = totalsRow.getCell(col)
        cell.value = item.damaged + item.stuck
        cell.fill = bg(equipmentPalette[i % equipmentPalette.length][0])
        cell.font = { name: 'Tahoma', size: 12, bold: true, color: { argb: 'FFFFFFFF' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = { top: reportGridLine, bottom: reportGridLine,
          left: reportPairLine, right: reportPairLine }
      })
      // แถว 3/4 เป็นความสูงเดียวกับ KPI ฝั่งซ้ายที่กำหนดไว้ก่อนหน้านี้

      // หัวข้อรายละเอียดด้านซ้ายอยู่แถว 5; ฝั่งขวาเป็นหัวเสีย/ค้าง
      sheet.getRow(5).height = 38
      const equipmentHeaderNames = EQUIPMENT.flatMap(() => ['เสีย', 'ค้าง/\nReset'])
      equipmentHeaderNames.forEach((name, index) => {
        const col = baseCount + index + 1
        const cell = sheet.getRow(5).getCell(col)
        const group = equipmentPalette[Math.floor(index / 2) % equipmentPalette.length]
        cell.value = name
        cell.font = { name: 'Tahoma', size: 10, bold: true,
          color: { argb: `FF${group[0]}` } }
        cell.fill = bg(group[1])
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        cell.border = reportEquipmentBorder(col)
      })

      // แถว 6 ซ้ายเป็นหัวข้อมูลใบงาน; แถว 6 ขวาเก็บยอดเสีย/ค้างแยก
      const baseHeaderNames = baseHeaders.map(x => x[0])
      sheet.getRow(6).values = baseHeaderNames
      sheet.getRow(6).height = 48
      baseHeaderNames.forEach((_, index) => {
        const cell = sheet.getRow(6).getCell(index + 1)
        cell.font = { name: 'Tahoma', size: 10, bold: true,
          color: { argb: 'FFFFFFFF' } }
        cell.fill = bg(blue)
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        cell.border = { top: thinBorder, bottom: thinBorder,
          left: thinBorder, right: thinBorder }
      })
      baseHeaders.forEach((x, i) => { sheet.getColumn(i + 1).width = x[1] })
      // ลดคอลัมน์อุปกรณ์ที่เป็นตัวเลขให้กระชับ แยกตามชนิดย่อย
      // เสีย (ชิ้น) = 8 / ค้าง-Reset = 11
      // ทุกคอลัมน์อุปกรณ์กว้างเท่ากัน
      for (let i = baseCount + 1; i <= totalCols; i++) {
        sheet.getColumn(i).width = 8
      }

      // แถว 6 (คอลัมน์ขวา): ยอดเสีย / ค้าง-Reset แยกในแนวเดียวกับหัวตารางซ้าย
      const splitTotalsRow = sheet.getRow(6)
      reportTotals.equipment.forEach((item, i) => {
        const firstCol = baseCount + i * 2 + 1
        const colors = equipmentPalette[i % equipmentPalette.length]
        ;[item.damaged, item.stuck].forEach((value, j) => {
          const col = firstCol + j
          const cell = splitTotalsRow.getCell(col)
          cell.value = value
          cell.fill = bg(colors[1])
          cell.font = { name: 'Tahoma', size: 11, bold: true,
            color: { argb: `FF${colors[0]}` } }
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
          cell.border = reportEquipmentBorder(col)
        })
      })
      splitTotalsRow.height = 48

      reportRows.forEach((order, rowIndex) => {
        const outage = bangkokDate(order.outage_date, order.outage_time)
        const deadline = outage ? new Date(outage.getTime() + 72 * 3600000) : null
        


        const downFromUnits = order.reportUnits.reduce((s, x) => s + (Number(x.down_camera_count) || 0), 0)
        const completed = order.status === 'closed'
        const values = [
          rowIndex + 1,
          reportSafeExcelText(ticketLabel(order)),
          reportSafeExcelText(order.center_name_snapshot || CENTER_NAMES[order.center_id] || ''),
          reportCellDate(order.submitted_at),
          outage ? formatDate(outage) : '—',
          deadline ? formatDate(deadline) : '—',
          reportSafeExcelText(STATUS[order.status] || order.status),
          completed ? reportCellDate(order.repair_completed_at) : 'รอผลซ่อม',
          completed ? reportSafeExcelText(order.technician_names || '') : '',
          
          completed ? (order.repair_down_count ?? downFromUnits) : (downFromUnits || ''),
          completed ? (order.repair_usable_count ?? '') : '',
          completed ? (order.repair_unusable_count ?? '') : '',
          completed ? (order.repair_sla_exceeded ? 'เกิน SLA' : 'ภายใน SLA') : 'รอผลซ่อม',
          ...EQUIPMENT.flatMap(name => {
            const counts = reportEquipmentCounts(order, name)
            return [counts.damaged ? counts.damaged : '', counts.stuck ? counts.stuck : '']
          }),
        ]
        const row = sheet.addRow(values)
        row.height = 29
        row.alignment = { vertical: 'middle' }
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.font = { name: 'Tahoma', size: 10, color: { argb: 'FF243A50' } }
          const equipmentIndex = col > baseCount ? Math.floor((col - baseCount - 1) / 2) : -1
          const palette = equipmentIndex >= 0 ? equipmentPalette[equipmentIndex % equipmentPalette.length] : null
          cell.fill = bg(palette ? palette[rowIndex % 2 ? 2 : 1] : (rowIndex % 2 ? 'F2F6FA' : 'FFFFFF'))
          cell.border = col > baseCount
            ? reportEquipmentBorder(col)
            : { bottom: thinBorder, right: thinBorder }
          cell.alignment = { vertical: 'middle', horizontal: col > baseCount ? 'center' : 'left', wrapText: false }
        })
        const statusCell = row.getCell(7)
        statusCell.font = { name: 'Tahoma', size: 10, bold: true, color: { argb: completed ? 'FF16754E' : order.status === 'cancelled' ? 'FFA13030' : 'FF996315' } }
        if (completed && order.repair_sla_exceeded) {
          row.getCell(baseCount).font = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FFC12338' } }
        }
      })
      sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: totalCols } }
      sheet.headerFooter.oddFooter = 'CCTV Repair Log Book | หน้า &P / &N'
      sheet.pageSetup.printTitlesRow = '1:6'
      sheet.pageSetup.printArea = `A1:${sheet.getColumn(totalCols).letter}${6 + reportRows.length}`

      const binary = await workbook.xlsx.writeBuffer()
      const blob = new Blob([binary], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safePeriod = reportFilters.period === 'custom'
        ? `${reportFilters.from}_${reportFilters.to}`
        : (reportFilters[reportFilters.period] || 'report')
      link.href = url
      link.download = `CCTV_Repair_LogBook_${safePeriod}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch (err) {
      setReportError(`สร้าง Excel ไม่สำเร็จ: ${err.message || 'ไม่ทราบสาเหตุ'}`)
    } finally {
      setReportExportBusy(false)
    }
  }

  const changeFilter = (key, value) => {
    setFilters(old => ({
      ...old,
      [key]: value,
    }))
    setPage(0)
  }

  const fetchUnits = useCallback(async id => {
    const { data, error: err } = await supabase
      .from('cctv_repair_order_units')
      .select(`
        id,
        unit_label,
        down_camera_count,
        latitude,
        longitude,
        camera_snapshot
      `)
      .eq('order_id', id)
      .order('id')

    if (err) throw err
    return data || []
  }, [])

  const loadOrders = useCallback(async () => {
    if (!authorized) {
      setOrders([])
      setTotal(0)
      return
    }

    setBusyList(true)
    setError('')

    try {
      let query = supabase
        .from('cctv_repair_orders')
        .select(`
          id,
          ticket_no,
          center_id,
          center_name_snapshot,
          team_code,
          report_date,
          submitted_at,
          outage_date,
          outage_time,
          status,
          created_at,
          repair_problem_found,
          repair_fix_method,
          repair_down_count,
          repair_usable_count,
          repair_unusable_count,
          repair_unusable_reason,
          repair_completed_at,
          repair_sla_exceeded,
          repair_sla_reason,
          technician_names,
          technician_phone,
          equipment_items
        `, { count: 'exact' })
        .neq('status', 'draft')

      if (isTechnician) {
        query = query.in('center_id', scopeIds)
      }

      if (isCenter) {
        query = query.eq(
          'center_id',
          Number(profile.center_id)
        )
      } else if (filters.center) {
        query = query.eq(
          'center_id',
          Number(filters.center)
        )
      }

      const keyword = filters.ticket
        .trim()
        .replace(/[%_\\]/g, '')

      if (keyword) {
        query = query.ilike(
          'ticket_no',
          `%${keyword}%`
        )
      }

      if (filters.status === 'open') {
        query = query.in('status', OPEN_STATUSES)
      }

      if (
        ['closed', 'cancelled'].includes(filters.status)
      ) {
        query = query.eq('status', filters.status)
      }

      if (
        filters.period === 'month' &&
        filters.month
      ) {
        const [y, m] = filters.month
          .split('-')
          .map(Number)

        const next = new Date(
          Date.UTC(y, m, 1)
        ).toISOString().slice(0, 10)

        query = query
          .gte(
            'submitted_at',
            `${filters.month}-01T00:00:00+07:00`
          )
          .lt(
            'submitted_at',
            `${next}T00:00:00+07:00`
          )
      }

      if (filters.period === 'custom') {
        if (
          filters.from &&
          filters.to &&
          filters.from > filters.to
        ) {
          throw new Error(
            'วันที่แจ้งเริ่มต้นต้องไม่เกินวันที่สิ้นสุด'
          )
        }

        if (filters.from) {
          query = query.gte(
            'submitted_at',
            `${filters.from}T00:00:00+07:00`
          )
        }

        if (filters.to) {
          query = query.lt(
            'submitted_at',
            `${plusOneDay(filters.to)}T00:00:00+07:00`
          )
        }
      }

      const { data, error: err, count } = await query
        .order('submitted_at', {
          ascending: false,
          nullsFirst: false,
        })
        .order('id', { ascending: false })
        .range(
          page * PAGE_SIZE,
          page * PAGE_SIZE + PAGE_SIZE - 1
        )

      if (err) throw err

      const items = data || []

      setOrders(items)
      setTotal(count || 0)

      setSelectedId(old =>
        items.some(
          x => String(x.id) === String(old)
        )
          ? old
          : (items[0]?.id ?? null)
      )
    } catch (err) {
      setOrders([])
      setTotal(0)
      setSelectedId(null)
      setError(err.message || 'โหลดใบงานไม่สำเร็จ')
    } finally {
      setBusyList(false)
    }
  }, [
    authorized,
    isTechnician,
    isCenter,
    scopeIds,
    profile?.center_id,
    filters,
    page,
  ])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  useEffect(() => {
    if (!authorized) return

    let cancelled = false

    async function loadCenters() {
      if (isTechnician) {
        // ใช้ Mapping ที่ตรวจสอบแล้ว
        setCenters(
          scopeIds.map(id => ({
            id,
            name: CENTER_NAMES[id],
          }))
        )
        return
      }

      const { data, error: err } = await supabase
        .from('centers')
        .select('id,name')
        .order('id')

      if (!cancelled) {
        if (err) {
          setCenters([])
        } else {
          setCenters(
            isCenter
              ? (data || []).filter(
                  c =>
                    Number(c.id) ===
                    Number(profile.center_id)
                )
              : (data || [])
          )
        }
      }
    }

    loadCenters()

    return () => {
      cancelled = true
    }
  }, [
    authorized,
    isTechnician,
    isCenter,
    team,
    profile?.center_id,
    scopeIds,
  ])

  useEffect(() => {
    if (!authorized || !selectedId) {
      setUnits([])
      setHistory([])
      return
    }

    let live = true

    setBusyUnits(true)
    setUnitError('')
    setHistoryError('')
    setUnits([])
    setHistory([])

    fetchUnits(selectedId)
      .then(rows => {
        if (live) setUnits(rows)
      })
      .catch(err => {
        if (live) {
          setUnitError(
            err.message || 'โหลดกล้องไม่สำเร็จ'
          )
        }
      })
      .finally(() => {
        if (live) setBusyUnits(false)
      })

    supabase
      .from('cctv_repair_history')
      .select('*')
      .eq('order_id', selectedId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error: err }) => {
        if (!live) return

        if (err) {
          setHistoryError(err.message)
        } else {
          setHistory(data || [])
        }
      })

    return () => {
      live = false
    }
  }, [authorized, selectedId, fetchUnits])

  const current = useMemo(
    () =>
      orders.find(
        x => String(x.id) === String(selectedId)
      ) || null,
    [orders, selectedId]
  )

  const outageAt = bangkokDate(
    current?.outage_date,
    current?.outage_time
  )

  const slaAt = outageAt
    ? new Date(
        outageAt.getTime() + 72 * 3600000
      )
    : null

  const modalOutage = bangkokDate(
    modalOrder?.outage_date,
    modalOrder?.outage_time
  )

  const completionAt = bangkokDate(
    form.doneDate,
    form.doneTime
  )

  const modalSla = modalOutage
    ? new Date(
        modalOutage.getTime() + 72 * 3600000
      )
    : null



  const selectedOver =
    form.slaChoice === 'over'

  
  const loadTechnicians = async orderId => {
    setTechniciansError('')
    setTechnicians([])

    const { data, error: err } = await supabase.rpc(
      'cctv_repair_list_technicians',
      {
        p_order_id: Number(orderId),
      }
    )

    if (err) {
      setTechniciansError(
        `โหลดทะเบียนสมาชิกชุดช่างไม่สำเร็จ: ${err.message}`
      )
      return
    }

    const members = data || []
    setTechnicians(members)

    if (members.length === 0) {
      setTechniciansError(
        'ยังไม่มีสมาชิกชุดช่างที่เปิดใช้งาน กรุณาให้ Admin เพิ่มสมาชิกในหน้าผู้ใช้งานระบบ'
      )
    }
  }

  
const openSavedPrint = async (order) => {
  if (
    !order ||
    !(
      OPEN_STATUSES.includes(order.status) ||
      order.status === 'closed'
    ) ||
    printBusy
  ) return

  setPrintBusy(true)
  setError('')

  try {
    const [orderResult, unitsResult] = await Promise.all([
      supabase
        .from('cctv_repair_orders')
        .select('*')
        .eq('id', order.id)
        .single(),

      supabase
        .from('cctv_repair_order_units')
        .select('*')
        .eq('order_id', order.id)
        .order('id'),
    ])

    if (orderResult.error) throw orderResult.error
    if (unitsResult.error) throw unitsResult.error

    if (
      !OPEN_STATUSES.includes(orderResult.data?.status) &&
      orderResult.data?.status !== 'closed'
    ) {
      throw new Error('ใบงานนี้ไม่อยู่ในสถานะที่เปิดดูได้')
    }

    setPrintPreview({
      order: orderResult.data,
      units: unitsResult.data || [],
    })
  } catch (err) {
    setError(
      `เปิดใบงาน A4 ไม่สำเร็จ: ${err.message || 'เกิดข้อผิดพลาด'}`
    )
  } finally {
    setPrintBusy(false)
  }
}


  const openModal = async (
    order,
    mode = 'close'
  ) => {
    if (
      !(
        mode === 'edit'
          ? canEdit(order)
          : canClose(order)
      )
    ) {
      return
    }

    setModalMode(mode)
    setEditReason('')
    setModalOrder(order)
    setModalBusy(true)
    setModalError('')
    setModalCount(0)
    setSelectedId(order.id)

    try {
      const rows = await fetchUnits(order.id)

      const count = rows.reduce(
        (n, x) =>
          n + Number(x.down_camera_count || 0),
        0
      )

      const next = makeForm(
        profile,
        count,
        mode === 'edit' ? order : null
      )

      if (mode === 'close') {
        const outage = bangkokDate(
          order.outage_date,
          order.outage_time
        )

        next.slaChoice =
          outage &&
          Date.now() >
            outage.getTime() + 72 * 3600000
            ? 'over'
            : 'within'
      }

      setForm(next)
      setModalCount(count)

      await loadTechnicians(order.id)
    } catch (err) {
      setModalError(
        err.message || 'โหลดข้อมูลปิดงานไม่สำเร็จ'
      )
    } finally {
      setModalBusy(false)
    }
  }

  const changeForm = (key, value) =>
    setForm(old => ({
      ...old,
      [key]: value,
    }))


  const changeCameraCount = (field, value) => {
    const input = String(value).replace(/\D/g, '')
    const other =
      field === 'usable' ? 'unusable' : 'usable'

    setForm(old => {
      if (input === '') {
        return {
          ...old,
          [field]: '',
        }
      }

      const total = Number(old.down)
      const count = Number(input)

      if (
        !Number.isSafeInteger(count) ||
        count > total
      ) {
        return {
          ...old,
          [field]: input,
          [other]: '',
        }
      }

      return {
        ...old,
        [field]: String(count),
        [other]: String(total - count),
      }
    })
  }

  const completeCameraCount = field => {
    const other =
      field === 'usable' ? 'unusable' : 'usable'

    setForm(old => {
      if (old[field] !== '') return old

      if (
        !validInteger(old.down) ||
        !validInteger(old[other])
      ) {
        return old
      }

      const remaining =
        Number(old.down) - Number(old[other])

      if (remaining < 0) return old

      return {
        ...old,
        [field]: String(remaining),
      }
    })
  }


  const changeEquipment = (index, patch) =>
    setForm(old => ({
      ...old,
      equipment: old.equipment.map(
        (item, i) =>
          i === index
            ? { ...item, ...patch }
            : item
      ),
    }))

  const changeSerial = (equipmentIndex, field, serialIndex, value) => {
    setForm(old => ({
      ...old,
      equipment: old.equipment.map((item, index) => {
        if (index !== equipmentIndex) return item

        const parts = serialParts(item[field])

        while (parts.length <= serialIndex) {
          parts.push('')
        }

        parts[serialIndex] = value.replace(/[\r\n]/g, ' ')

        const joined = parts.join('\n')

        return {
          ...item,
          [field]: joined,
          ...(field === 'new_sn'
            ? {
                is_replaced: parts.some(x => x.trim() !== ''),
              }
            : {}),
        }
      }),
    }))
  }

  const closeModal = () => {
    if (!modalSaving) {
      setModalOrder(null)
      setModalError('')
    }
  }

    
  const submitClose = async () => {
    const isEditing = modalMode === 'edit'

    if (
      !modalOrder ||
      modalBusy ||
      modalSaving ||
      !(isEditing
        ? canEdit(modalOrder)
        : canClose(modalOrder))
    ) {
      return
    }

    if (isEditing && editReason.trim().length < 10) {
      setModalError(
        'กรุณาระบุเหตุผลการแก้ไขอย่างน้อย 10 ตัวอักษร'
      )
      return
    }

    // ส่วนตรวจข้อมูลเดิม ตั้งแต่ const down ลงไป
    // ให้คงไว้ทั้งหมด


    const down = Number(form.down)
    const good = Number(form.usable)
    const bad = Number(form.unusable)

    if (
      !form.problem.trim() ||
      !form.method.trim() ||
      !form.technician.trim()
    ) {
      setModalError(
        'กรุณากรอกปัญหา วิธีแก้ และเลือกผู้ปฏิบัติงาน'
      )
      return
    }

    if (
      ![
        form.down,
        form.usable,
        form.unusable,
      ].every(validInteger) ||
      down !== modalCount ||
      good + bad !== down
    ) {
      setModalError(
        'จำนวนกล้องดับต้องตรงกับใบงาน และใช้งานได้ + ' +
        'ไม่ได้ต้องเท่ากับจำนวนกล้องดับ'
      )
      return
    }

    if (
      bad > 0 &&
      !form.unusableReason.trim()
    ) {
      setModalError(
        'กรุณาระบุเหตุผลที่กล้องยังใช้งานไม่ได้'
      )
      return
    }

    if (
      !completionAt ||
      !modalOutage ||
      completionAt < modalOutage ||
      completionAt.getTime() > Date.now()
    ) {
      setModalError(
        'วันเวลาซ่อมเสร็จต้องไม่ก่อนกล้องดับและไม่เกินปัจจุบัน'
      )
      return
    }

    if (
      selectedOver &&
      !form.slaReason.trim()
    ) {
      setModalError(
        'กรุณาระบุเหตุผลที่เกิน SLA'
      )
      return
    }

    // RPC v2 ยังบันทึก SLA จากสูตร ไม่ใช่ค่าที่ช่างเลือก
    // ป้องกันการบันทึกค่าไม่ตรงกับที่เลือก



    const equipment = []

    for (const x of form.equipment) {
      if (!x.is_damaged && !x.is_stuck) continue

      // ตรวจจำนวนอุปกรณ์เสียและค้าง
      if (
        (x.is_damaged && (
          !validInteger(x.failed_count) ||
          Number(x.failed_count) < 1 ||
          !Number.isSafeInteger(Number(x.failed_count))
        )) ||
        (x.is_stuck && (
          !validInteger(x.reset_count) ||
          Number(x.reset_count) < 1 ||
          !Number.isSafeInteger(Number(x.reset_count))
        ))
      ) {
        setModalError(`จำนวนอุปกรณ์ไม่ถูกต้อง: ${x.name}`)
        return
      }

      const failedTotal = x.is_damaged
        ? Number(x.failed_count)
        : 0

      // S/N ของอุปกรณ์แต่ละตัว
      const oldSerials = Array.from(
        { length: failedTotal },
        (_, i) => serialAt(x.old_sn, i).trim()
      )

      const newSerials = Array.from(
        { length: failedTotal },
        (_, i) => serialAt(x.new_sn, i).trim()
      )

      // อุปกรณ์เสียทุกตัวต้องมี S/N เดิม
      if (x.is_damaged && oldSerials.some(sn => !sn)) {
        setModalError(
          `กรุณากรอก S/N อุปกรณ์เสียให้ครบ ${failedTotal} ตัว: ${x.name}`
        )
        return
      }

      // สร้างข้อมูลส่งให้ RPC
        equipment.push({
          name: x.name,
          is_damaged: x.is_damaged,
          is_stuck: x.is_stuck,

          // มี S/N ใหม่อย่างน้อยหนึ่งตัว ถือว่ามีการเปลี่ยน
          is_replaced: newSerials.some(Boolean),

          failed_count: failedTotal,

          reset_count: x.is_stuck
            ? Number(x.reset_count)
            : 0,

          // เก็บรูปแบบเดิมเพื่อรองรับ RPC ปัจจุบัน
          old_sn: oldSerials.join('\n'),
          new_sn: newSerials.join('\n'),

          // ข้อมูล S/N แยกตามอุปกรณ์แต่ละตัว
          serial_numbers: oldSerials.map((old_sn, i) => ({
            old_sn,
            new_sn: newSerials[i],
          })),
        })
      }



      if (
        !window.confirm(
          `${isEditing
            ? 'ยืนยันแก้ไขผลซ่อม'
            : 'ยืนยันบันทึกและปิดงาน'} ${ticketLabel(modalOrder)}?`
        )
      ) {
        return
      }

      setModalSaving(true)
      setModalError('')

      try {
        
  const rpcParams = {
    p_order_id: modalOrder.id,
    p_problem_found: form.problem.trim(),
    p_fix_method: form.method.trim(),
    p_camera_down_count: down,
    p_usable_count: good,
    p_unusable_count: bad,
    p_unusable_reason: form.unusableReason.trim(),
    p_completed_at: completionAt.toISOString(),
    p_sla_exceeded: selectedOver,
    p_sla_reason: selectedOver
      ? form.slaReason.trim()
      : '',
    p_equipment_items: equipment,
    p_technician_name: form.technician.trim(),
    p_technician_phone: form.phone.trim().replace(/\D/g, ''),
  }

  const { data, error: err } = await supabase.rpc(
    isEditing
      ? 'cctv_repair_technician_edit_closed'
      : 'cctv_repair_technician_close_v3',
    isEditing
      ? {
          ...rpcParams,
          p_edit_reason: editReason.trim(),
        }
      : rpcParams
  )


      if (err) throw err

      
      if (data !== true) {
        throw new Error(
          isEditing
            ? 'ฐานข้อมูลไม่ยืนยันการแก้ไขผลซ่อม'
            : 'ฐานข้อมูลไม่ยืนยันการปิดงาน'
        )
      }


      
      const ticket = ticketLabel(modalOrder)
      const updatedOrderId = modalOrder.id

      setModalOrder(null)
      await loadOrders()

      // รีเฟรชประวัติหลังแก้ไขงานที่ปิดแล้ว
      if (
        isEditing &&
        String(selectedId) === String(updatedOrderId)
      ) {
        const { data: updatedHistory, error: historyErr } =
          await supabase
            .from('cctv_repair_history')
            .select('*')
            .eq('order_id', updatedOrderId)
            .order('created_at', { ascending: false })
            .limit(100)

        if (historyErr) {
          setHistoryError(historyErr.message)
        } else {
          setHistory(updatedHistory || [])
          setHistoryError('')
        }
      }

      setNotice(
        isEditing
          ? `แก้ไขผลซ่อม ${ticket} เรียบร้อยแล้ว`
          : `บันทึกผลและปิดงาน ${ticket} แล้ว`
      )

    } catch (err) {
      setModalError(
        err.message || (
          isEditing
            ? 'แก้ไขผลซ่อมไม่สำเร็จ'
            : 'ปิดงานไม่สำเร็จ'
        )
      )
    } finally {
      setModalSaving(false)
    }
  }

  const submitCancel = async () => {
    if (
      !canCancel(cancelTarget) ||
      cancelBusy
    ) {
      return
    }

    if (cancelReason.trim().length < 5) {
      setCancelError(
        'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'
      )
      return
    }

    if (
      !window.confirm(
        `ยืนยันยกเลิก ${ticketLabel(cancelTarget)}?`
      )
    ) {
      return
    }

    setCancelBusy(true)
    setCancelError('')

    try {
      const { data, error: err } = await supabase.rpc(
        'cctv_repair_cancel_v2',
        {
          p_order_id: cancelTarget.id,
          p_reason: cancelReason.trim(),
        }
      )

      if (err) throw err

      if (data !== true) {
        throw new Error(
          'ฐานข้อมูลไม่ยืนยันการยกเลิก'
        )
      }

      const ticket = ticketLabel(cancelTarget)

      setCancelTarget(null)
      await loadOrders()

      setNotice(
        `ยกเลิกใบงาน ${ticket} แล้ว`
      )
    } catch (err) {
      setCancelError(
        err.message || 'ยกเลิกไม่สำเร็จ'
      )
    } finally {
      setCancelBusy(false)
    }
  }

  const submitHardDelete = async () => {
    if (
      !canHardDelete(deleteTarget) ||
      deleteBusy
    ) {
      return
    }

    const ticket = ticketLabel(deleteTarget)

    if (
      deleteConfirm.trim() !== ticket ||
      deleteReason.trim().length < 10
    ) {
      setDeleteError(
        'ระบุเหตุผลอย่างน้อย 10 ตัวอักษรและพิมพ์เลขใบงานให้ตรงกัน'
      )
      return
    }

    if (
      !window.confirm(
        `ยืนยันลบถาวร ${ticket}?\n` +
        'ลบแล้วกู้คืนผ่านเว็บไม่ได้'
      )
    ) {
      return
    }

    setDeleteBusy(true)
    setDeleteError('')

    try {
      const { data, error: err } = await supabase.rpc(
        'cctv_repair_admin_hard_delete_cancelled',
        {
          p_order_id: deleteTarget.id,
          p_confirmation: deleteConfirm.trim(),
          p_reason: deleteReason.trim(),
        }
      )

      if (err) throw err

      if (data !== true) {
        throw new Error(
          'ฐานข้อมูลไม่ยืนยันการลบ'
        )
      }

      setDeleteTarget(null)
      await loadOrders()

      setNotice(`ลบถาวร ${ticket} แล้ว`)
    } catch (err) {
      setDeleteError(
        err.message || 'ลบถาวรไม่สำเร็จ'
      )
    } finally {
      setDeleteBusy(false)
    }
  }

  if (!authorized) {
    return (
      <div className="tech-panel">
        บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้างานซ่อม
      </div>
    )
  }

  return (
    <>
      <main className="tech-page">
        <div className="tech-head">
          <div>
            <div className="tech-kicker">
              CCTV REPAIR WORKSPACE
            </div>

            <h2>{repairView === 'report' ? 'รายงานสรุปการแจ้งซ่อม' : 'งานซ่อม'}</h2>

            <p>
              {isTechnician
                ? TEAMS[team]
                : isCentral
                  ? 'ศชต. · ภาพรวมทุกศูนย์'
                  : isCenter
                    ? 'ศูนย์ของฉัน · ดูอย่างเดียว'
                    : 'มุมมองผู้ดูแล · ทุกศูนย์'}
            </p>
          </div>

          <button
            type="button"
            className="tech-refresh"
            disabled={repairView === 'report' ? reportBusy : busyList}
            onClick={repairView === 'report' ? () => setReportRefresh(x => x + 1) : loadOrders}
          >
            {repairView === 'report' ? 'รีเฟรชรายงาน' : 'รีเฟรชใบงาน'}
          </button>
        </div>

        <nav className="tech-view-tabs" aria-label="เลือกมุมมองงานซ่อม">
          <button type="button" className={repairView === 'orders' ? 'is-active' : ''}
            onClick={() => setRepairView('orders')}>รายการใบแจ้งซ่อม</button>
          <button type="button" className={repairView === 'report' ? 'is-active' : ''}
            onClick={() => setRepairView('report')}>รายงานสรุปการแจ้งซ่อม</button>
        </nav>

        {repairView === 'report' ? (
          <section className="tech-panel tech-report-panel">
            <div className="tech-report-topline">
              <div>
                <h3>Log Book รายงานสรุปการแจ้งซ่อม</h3>
                <p className="tech-muted">เลือกช่วงตามวันที่แจ้งซ่อม · แสดงข้อมูลเท่าที่บัญชีมีสิทธิ์อ่าน</p>
              </div>
              <button type="button" className="tech-report-export"
                disabled={reportBusy || reportExportBusy || Boolean(reportError) || !reportRows.length}
                onClick={exportRepairLogBook}>
                {reportExportBusy ? 'กำลังสร้างไฟล์...' : 'Export Excel (1 Sheet)'}
              </button>
            </div>

            <div className="tech-report-filters">
              <label>รูปแบบช่วงเวลา
                <select value={reportFilters.period} onChange={e => reportChangeFilter('period', e.target.value)}>
                  <option value="day">รายวัน</option>
                  <option value="month">รายเดือน</option>
                  <option value="year">รายปี</option>
                  <option value="custom">กำหนดเอง</option>
                </select>
              </label>
              {reportFilters.period === 'day' && (
                <label>วันที่แจ้งซ่อม
                  <input type="date" value={reportFilters.day} onChange={e => reportChangeFilter('day', e.target.value)}/>
                </label>
              )}
              {reportFilters.period === 'month' && (
                <label>เดือน
                  <input type="month" value={reportFilters.month} onChange={e => reportChangeFilter('month', e.target.value)}/>
                </label>
              )}
              {reportFilters.period === 'year' && (
                <label>ปี พ.ศ.
                  <input type="number" min="2543" max="9999" value={reportFilters.year}
                    onChange={e => reportChangeFilter('year', e.target.value)}/>
                </label>
              )}
              {reportFilters.period === 'custom' && (
                <>
                  <label>เริ่มต้น
                    <input type="date" value={reportFilters.from} onChange={e => reportChangeFilter('from', e.target.value)}/>
                  </label>
                  <label>สิ้นสุด
                    <input type="date" value={reportFilters.to} onChange={e => reportChangeFilter('to', e.target.value)}/>
                  </label>
                </>
              )}
              {!isCenter && !isCentral && (
                <label>ศูนย์
                  <select value={reportFilters.center} onChange={e => reportChangeFilter('center', e.target.value)}>
                    <option value="">{isTechnician ? 'ศูนย์ที่รับผิดชอบทั้งหมด' : 'ทุกศูนย์ตามสิทธิ์'}</option>
                    {centers.filter(c => [1, 2, 4, 7, 8, 9].includes(Number(c.id))).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>สถานะ
                <select value={reportFilters.status} onChange={e => reportChangeFilter('status', e.target.value)}>
                  <option value="all">ทุกสถานะ</option>
                  <option value="open">ยังไม่ปิด</option>
                  <option value="closed">ปิดงานแล้ว</option>
                  <option value="cancelled">ยกเลิกแล้ว</option>
                </select>
              </label>
            </div>

            <p className="tech-report-period">{reportPeriodTitle(reportFilters)}</p>
            {reportBusy && <p className="tech-muted">กำลังรวบรวมใบงานและข้อมูลจุดซ่อม...</p>}
            {reportError && <p className="tech-error" role="alert">{reportError}</p>}

            <div className="tech-report-kpis">
              {[
                ['ใบแจ้งซ่อม', reportTotals.count],
                ['ปิดงานแล้ว', reportTotals.closed],
                ['ยังไม่ปิด', reportTotals.open],
                ['ปิดเกิน SLA', reportTotals.late],
                ['อุปกรณ์เสีย', reportTotals.damaged],
                ['ค้าง / Reset', reportTotals.stuck],
              ].map(([label, value]) => (
                <div className="tech-report-kpi" key={label}>
                  <small>{label}</small><strong>{reportBusy ? '—' : value.toLocaleString('th-TH')}</strong>
                </div>
              ))}
            </div>

            

            <div className="tech-report-list-title">
              <h4 className="tech-report-subhead">ทะเบียนใบแจ้งซ่อม</h4>
              <small className="tech-muted">{reportRows.length} ใบงาน · แสดงหน้าละ {REPORT_PAGE_SIZE}</small>
            </div>
            <div className="tech-report-table-wrap">
              <table className="tech-report-table">
                <thead><tr>
                  <th>เลขใบงาน</th><th>วันแจ้ง</th><th>ศูนย์ / จุดแจ้งซ่อม</th>
                  <th>สถานะ</th><th>วันปิดงาน</th><th>SLA</th>
                  <th>อุปกรณ์เสีย</th><th>ค้าง / Reset</th><th>ข้อมูลเพิ่มเติม</th>
                </tr></thead>
                <tbody>
                  {!reportBusy && reportRows.length === 0 && (
                    <tr><td colSpan={9}>ไม่พบใบงานตามเงื่อนไขที่เลือก</td></tr>
                  )}
                  {reportRows.slice(reportPage * REPORT_PAGE_SIZE, (reportPage + 1) * REPORT_PAGE_SIZE).map(order => {
                    const pieces = EQUIPMENT.map(name => ({ name, ...reportEquipmentCounts(order, name) }))
                    const damaged = pieces.reduce((n, p) => n + (p.damaged || 0), 0)
                    const stuck = pieces.reduce((n, p) => n + (p.stuck || 0), 0)
                    const closed = order.status === 'closed'
                    const boxNames = [...new Set(order.reportUnits.map(u => u.unit_label).filter(Boolean))].join(', ')
                    
                    return (
                      <tr key={order.id}>
                        <td><strong>{ticketLabel(order)}</strong></td>
                        <td>{reportCellDate(order.submitted_at)}</td>
                        
                        <td>
                          {order.center_name_snapshot || CENTER_NAMES[order.center_id] || '—'}

                          <small
                            className="tech-report-boxnames"
                            title={boxNames || 'ยังไม่ระบุจุด'}
                          >
                            {boxNames || 'ยังไม่ระบุจุด'}
                          </small>
                        </td>

                        <td><span className={`tech-report-status ${closed ? 'is-done' : order.status === 'cancelled' ? 'is-cancelled' : 'is-open'}`}>
                          {STATUS[order.status] || order.status}</span></td>
                        <td>{closed ? reportCellDate(order.repair_completed_at) : '—'}</td>
                        <td>{closed ? (order.repair_sla_exceeded ? 'เกิน SLA' : 'ภายใน SLA') : 'รอผลซ่อม'}</td>
                        <td className="tech-report-num">{closed ? damaged : '—'}</td>
                        <td className="tech-report-num">{closed ? stuck : '—'}</td>
                        <td><details className="tech-report-more">
                          <summary>ดูรายละเอียด</summary>
                          <div><b>ปัญหา:</b> {closed ? (order.repair_problem_found || '—') : 'รอผลซ่อม'}</div>
                          <div><b>วิธีแก้:</b> {closed ? (order.repair_fix_method || '—') : 'รอผลซ่อม'}</div>
                          <div><b>ผู้ปฏิบัติงาน:</b> {closed ? (order.technician_names || '—') : '—'}</div>
                          {pieces.filter(p => (p.damaged || 0) + (p.stuck || 0) > 0).map(p => (
                            <div key={p.name}>{p.name}: เสีย {p.damaged} / ค้าง-Reset {p.stuck}</div>
                          ))}
                        </details></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="tech-report-footer">
              <p className="tech-muted">หมายเหตุ: รายการยังไม่ปิดงานไม่มีผลตรวจอุปกรณ์ · “ค้าง/Reset” ใช้จำนวนตามที่ช่างบันทึกไว้</p>
              <nav className="tech-pagination" aria-label="แบ่งหน้ารายงาน">
                <button type="button" disabled={reportBusy || reportPage === 0}
                  onClick={() => setReportPage(p => Math.max(0, p - 1))}>ก่อนหน้า</button>
                <span>หน้า {reportPage + 1} / {Math.max(1, Math.ceil(reportRows.length / REPORT_PAGE_SIZE))}</span>
                <button type="button" disabled={reportBusy || (reportPage + 1) * REPORT_PAGE_SIZE >= reportRows.length}
                  onClick={() => setReportPage(p => p + 1)}>ถัดไป</button>
              </nav>
            </div>
          </section>
        ) : (
          <>

        <div className="tech-stats">
          <div className="tech-panel">
            <span>ใบงานที่ค้นพบ</span>
            <strong>{total}</strong>
          </div>

          <div className="tech-panel">
            <span>ยังไม่ปิด (หน้านี้)</span>
            <strong>
              {
                orders.filter(x =>
                  OPEN_STATUSES.includes(x.status)
                ).length
              }
            </strong>
          </div>

          <div className="tech-panel">
            <span>ปิดแล้ว (หน้านี้)</span>
            <strong>
              {
                orders.filter(
                  x => x.status === 'closed'
                ).length
              }
            </strong>
          </div>

          <div className="tech-panel">
            <span>ยกเลิก (หน้านี้)</span>
            <strong>
              {
                orders.filter(
                  x => x.status === 'cancelled'
                ).length
              }
            </strong>
          </div>
        </div>

        {error && (
          <div className="tech-error" role="alert">
            {error}
          </div>
        )}

        {notice && (
          <div className="tech-success" role="status">
            {notice}
          </div>
        )}

        <section className="tech-panel tech-filter-panel">
          <h3>ค้นหาและกรองประวัติใบแจ้งซ่อม</h3>

          <div className="tech-filter-grid">
            {!isCenter && (
              <label>
                ศูนย์
                <select
                  value={filters.center}
                  onChange={e =>
                    changeFilter(
                      'center',
                      e.target.value
                    )
                  }
                >
                  <option value="">
                    {isTechnician
                      ? 'ทั้ง 3 ศูนย์ที่รับผิดชอบ'
                      : 'ทุกศูนย์'}
                  </option>

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
            )}

            <label>
              เลขใบงาน
              <input
                value={filters.ticket}
                onChange={e =>
                  changeFilter(
                    'ticket',
                    e.target.value
                  )
                }
                placeholder="ค้นหาเลขใบงาน"
              />
            </label>

            <label>
              สถานะ
              <select
                value={filters.status}
                onChange={e =>
                  changeFilter(
                    'status',
                    e.target.value
                  )
                }
              >
                <option value="all">ทุกสถานะ</option>
                <option value="open">ยังไม่ปิด</option>
                <option value="closed">ปิดแล้ว</option>
                <option value="cancelled">ยกเลิก</option>
              </select>
            </label>

            <label>
              รูปแบบวันที่แจ้ง
              <select
                value={filters.period}
                onChange={e =>
                  changeFilter(
                    'period',
                    e.target.value
                  )
                }
              >
                <option value="all">ทุกช่วงเวลา</option>
                <option value="month">เลือกเดือน</option>
                <option value="custom">
                  กำหนดช่วงวันที่เอง
                </option>
              </select>
            </label>

            {filters.period === 'month' && (
              <label>
                เดือนที่แจ้ง
                <input
                  type="month"
                  value={filters.month}
                  onChange={e =>
                    changeFilter(
                      'month',
                      e.target.value
                    )
                  }
                />
              </label>
            )}

            {filters.period === 'custom' && (
              <>
                <label>
                  วันที่แจ้งเริ่มต้น
                  <input
                    type="date"
                    value={filters.from}
                    onChange={e =>
                      changeFilter(
                        'from',
                        e.target.value
                      )
                    }
                  />
                </label>

                <label>
                  วันที่แจ้งสิ้นสุด
                  <input
                    type="date"
                    value={filters.to}
                    onChange={e =>
                      changeFilter(
                        'to',
                        e.target.value
                      )
                    }
                  />
                </label>
              </>
            )}
          </div>

          <div className="tech-filter-bottom">
            <span>
              กรองด้วย <strong>วันที่ส่งแจ้งซ่อม</strong>
              {' '}ไม่ใช่วันที่กล้องดับ
            </span>

            <button
              type="button"
              onClick={() => {
                setFilters(INITIAL_FILTERS)
                setPage(0)
              }}
            >
              ล้างตัวกรอง
            </button>
          </div>
        </section>

        <div className="tech-grid">
          <section className="tech-panel">
            <h3>รายการใบแจ้งซ่อม</h3>

            {busyList && (
              <p className="tech-muted">
                กำลังโหลดใบงาน...
              </p>
            )}

            {!busyList && orders.length === 0 && (
              <p className="tech-muted">
                ไม่พบใบงานตามเงื่อนไข
              </p>
            )}

            <div className="tech-order-list">
              {orders.map(o => (
                <article
                  key={o.id}
                  className={`tech-list-card ${
                    String(selectedId) === String(o.id)
                      ? 'is-selected'
                      : ''
                  }`}
                >
                  <button
                    type="button"
                    className="tech-list-select"
                    onClick={() => setSelectedId(o.id)}
                  >
                    <strong>{ticketLabel(o)}</strong>

                    <span>
                      {o.center_name_snapshot ||
                        CENTER_NAMES[o.center_id] ||
                        '-'}
                      {' · '}
                      {TEAMS[o.team_code] ||
                        'ไม่ระบุชุดช่าง'}
                    </span>

                    <small>
                      {formatDate(o.submitted_at)}
                      {' · '}
                      {STATUS[o.status] || o.status}
                    </small>
                  </button>

                  <div className="tech-list-actions">
                    {canClose(o) && (
                      <button
                        className="tech-btn-close"
                        type="button"
                        onClick={() => openModal(o)}
                      >
                        ปิดงาน
                      </button>
                    )}

                    {canEdit(o) && (
                      <button
                        className="tech-btn-edit"
                        type="button"
                        onClick={() =>
                          openModal(o, 'edit')
                        }
                      >
                        แก้ไขผลซ่อม
                      </button>
                    )}

                    {canCancel(o) && (
                      <button
                        className="tech-btn-cancel"
                        type="button"
                        onClick={() => {
                          setCancelTarget(o)
                          setCancelReason('')
                          setCancelError('')
                        }}
                      >
                        ยกเลิก
                      </button>
                    )}

                    {canHardDelete(o) && (
                      <button
                        className="tech-btn-delete"
                        type="button"
                        onClick={() => {
                          setDeleteTarget(o)
                          setDeleteReason('')
                          setDeleteConfirm('')
                          setDeleteError('')
                        }}
                      >
                        ลบถาวร
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>

            <nav
              className="tech-pagination"
              aria-label="แบ่งหน้าใบงาน"
            >
              <button
                type="button"
                disabled={page === 0 || busyList}
                onClick={() =>
                  setPage(n => Math.max(0, n - 1))
                }
              >
                ก่อนหน้า
              </button>

              <span>
                หน้า {page + 1} /{' '}
                {Math.max(
                  1,
                  Math.ceil(total / PAGE_SIZE)
                )}
              </span>

              <button
                type="button"
                disabled={
                  busyList ||
                  (page + 1) * PAGE_SIZE >= total
                }
                onClick={() =>
                  setPage(n => n + 1)
                }
              >
                ถัดไป
              </button>
            </nav>
          </section>

          <section className="tech-panel">
            <h3>รายละเอียดใบงาน</h3>

            {!current ? (
              <p className="tech-muted">
                เลือกใบงานจากรายการเพื่อดูรายละเอียด
              </p>
            ) : (
              <>
                
              <div className="tech-detail-head">
                <strong>
                  {ticketLabel(current)}
                </strong>

                <div className="tech-detail-actions">
                  {(OPEN_STATUSES.includes(current.status) || current.status === 'closed') && (
                    <button
                      type="button"
                      className="tech-print-button"
                      disabled={printBusy}
                      onClick={() => openSavedPrint(current)}
                    >
                      {printBusy ? 'กำลังโหลด...' : 'ดูใบงาน A4'}
                    </button>
                  )}

                  <span>
                    {STATUS[current.status] || current.status}
                  </span>
                </div>
              </div>


                <p className="tech-muted">
                  ศูนย์ผู้แจ้ง:{' '}
                  {current.center_name_snapshot || '-'}
                </p>

                <div className="tech-order-dates">
                  <div>
                    <small>วันที่ส่งแจ้งซ่อม</small>
                    <strong>
                      {formatDate(current.submitted_at)}
                    </strong>
                  </div>

                  <div>
                    <small>วันที่รายงาน</small>
                    <strong>
                      {formatDay(current.report_date)}
                    </strong>
                  </div>

                  <div>
                    <small>วันเวลาที่กล้องดับ</small>
                    <strong>
                      {formatDate(outageAt)}
                    </strong>
                  </div>

                  <div>
                    <small>กำหนด SLA 72 ชม.</small>
                    <strong>
                      {formatDate(slaAt)}
                    </strong>
                  </div>
                </div>

                <h4>อุปกรณ์ / จุดที่แจ้งซ่อม</h4>

                {unitError && (
                  <div className="tech-error">
                    {unitError}
                  </div>
                )}

                {busyUnits ? (
                  <p className="tech-muted">
                    กำลังโหลดรายการกล้อง...
                  </p>
                ) : units.length === 0 ? (
                  <p className="tech-muted">
                    ไม่มีรายการกล้อง
                  </p>
                ) : (
                  units.map(u => (
                    <div
                      className="tech-unit"
                      key={u.id}
                    >
                      <div className="tech-unit-headline">
                        <strong>
                          {u.unit_label || '-'}
                        </strong>

                        <span>
                          กล้องดับ{' '}
                          {u.down_camera_count ?? 0} ตัว
                        </span>
                      </div>

                      <small className="tech-unit-coordinates">
                        Lat: {u.latitude ?? '-'}
                        {' · '}
                        Long: {u.longitude ?? '-'}
                      </small>

                      {Array.isArray(u.camera_snapshot) &&
                        u.camera_snapshot.length > 0 && (
                          <details className="tech-unit-camera-details">
                            <summary>
                              รายชื่อกล้องที่แจ้งซ่อม
                              {' '}({u.camera_snapshot.length} ตัว)
                            </summary>

                            <div className="tech-unit-camera-list">
                              {u.camera_snapshot.map(
                                (cam, i) => (
                                  <div
                                    key={`${cam.ip || 'camera'}-${i}`}
                                    className="tech-unit-camera-row"
                                  >
                                    <span>
                                      {i + 1}.{' '}
                                      {cam.name ||
                                        'ไม่ระบุชื่อกล้อง'}
                                    </span>

                                    <small>
                                      IP: {cam.ip || '-'}
                                    </small>
                                  </div>
                                )
                              )}
                            </div>
                          </details>
                        )}
                    </div>
                  ))
                )}

                {current.status === 'closed' && (
                  <section className="tech-closed-summary">
                    <h4>ผลการปิดงาน</h4>

                    <p>
                      <b>ปัญหาที่พบ:</b>{' '}
                      {current.repair_problem_found || '-'}
                    </p>

                    <p>
                      <b>วิธีแก้ไข:</b>{' '}
                      {current.repair_fix_method || '-'}
                    </p>

                    <p>
                      <b>กล้องดับ:</b>{' '}
                      {current.repair_down_count ?? '-'} ตัว
                      {' · '}
                      <b>ใช้งานได้:</b>{' '}
                      {current.repair_usable_count ?? '-'} ตัว
                      {' · '}
                      <b>ใช้งานไม่ได้:</b>{' '}
                      {current.repair_unusable_count ?? '-'} ตัว
                    </p>

                    {current.repair_unusable_reason && (
                      <p>
                        สาเหตุที่ยังใช้ไม่ได้:{' '}
                        {current.repair_unusable_reason}
                      </p>
                    )}

                    <p>
                      ซ่อมเสร็จ:{' '}
                      {formatDate(
                        current.repair_completed_at
                      )}
                      {' · '}
                      SLA:{' '}
                      {current.repair_sla_exceeded == null
                        ? '-'
                        : current.repair_sla_exceeded
                          ? 'เกิน'
                          : 'ไม่เกิน'}
                    </p>

                    {current.repair_sla_reason && (
                      <p>
                        เหตุผล SLA:{' '}
                        {current.repair_sla_reason}
                      </p>
                    )}

                    <p>
                      ผู้ปฏิบัติงาน:{' '}
                      {current.technician_names || '-'}
                      {' · '}
                      โทร. {formatMemberPhone(current.technician_phone)
                        || current.technician_phone || '-'}
                    </p>

                    {Array.isArray(
                      current.equipment_items
                    ) &&
                      current.equipment_items.length > 0 && (
                        <details>
                          <summary>
                            รายละเอียดอุปกรณ์ที่บันทึก
                            {' '}({current.equipment_items.length})
                          </summary>

                          <div className="tech-saved-equipment">
                            {current.equipment_items.map(
                              (e, i) => (
                                <div key={i}>
                                  <strong>{e.name}</strong>
                                  {' · '}
                                  {e.is_damaged ? 'เสีย' : ''}
                                  {' '}
                                  {e.is_stuck ? 'ค้าง' : ''}
                                  {e.old_sn &&
                                    ` · S/N เสีย: ${e.old_sn}`}
                                  {e.new_sn &&
                                    ` · S/N ใหม่: ${e.new_sn}`}
                                </div>
                              )
                            )}
                          </div>
                        </details>
                      )}
                  </section>
                )}

                <details className="tech-history">
                  <summary>
                    ประวัติการดำเนินการ
                    {' '}({history.length})
                  </summary>

                  {historyError ? (
                    <p className="tech-muted">
                      ยังไม่สามารถโหลดประวัติ:{' '}
                      {historyError}
                    </p>
                  ) : history.length === 0 ? (
                    <p className="tech-muted">
                      ยังไม่พบประวัติ
                    </p>
                  ) : (
                    history.map((item, i) => (
                      <div
                        key={item.id ?? i}
                        className="tech-history-row"
                      >
                        <strong>
                          {item.action || '-'}
                        </strong>
                        {' · '}
                        {formatDate(item.created_at)}

                        <small>
                          {item.previous_status || '-'}
                          {' → '}
                          {item.new_status || '-'}
                        </small>
                      </div>
                    ))
                  )}
                </details>
              </>
            )}
          </section>
        </div>
          </>
        )}
      </main>

      
      {printPreview && (
        <CctvRepairPrint
          order={printPreview.order}
          units={printPreview.units}
          onClose={() => setPrintPreview(null)}
        />
      )}


      {modalOrder && (
        <div
          className="tech-overlay"
          onMouseDown={e => {
            if (e.target === e.currentTarget) {
              closeModal()
            }
          }}
        >
          <section
            className="tech-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="บันทึกผลการซ่อม"
          >
            <header className="tech-dialog-head">
              <div>
                <small>CCTV REPAIR WORKSPACE</small>

                <h3>
                  {modalMode === 'edit'
                    ? 'แก้ไขผลซ่อม'
                    : 'บันทึกผลและปิดงาน'}
                  {' '}
                  {ticketLabel(modalOrder)}
                </h3>
              </div>

              <button
                type="button"
                disabled={modalSaving}
                onClick={closeModal}
              >
                ปิดหน้าต่าง
              </button>
            </header>

            <div className="tech-dialog-body">
              {modalError && (
                <div
                  className="tech-error"
                  role="alert"
                >
                  {modalError}
                </div>
              )}

              {modalBusy ? (
                <p>กำลังโหลดฟอร์ม...</p>
              ) : (
                <>
                  <p className="tech-muted">
                    {modalOrder.center_name_snapshot}
                    {' · '}
                    กล้องดับ {modalCount} ตัว
                  </p>

                  <label>
                    1. ปัญหาที่พบ *
                    <textarea
                      rows={2}
                      value={form.problem}
                      onChange={e =>
                        changeForm(
                          'problem',
                          e.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    2. วิธีการแก้ไข *
                    <textarea
                      rows={2}
                      value={form.method}
                      onChange={e =>
                        changeForm(
                          'method',
                          e.target.value
                        )
                      }
                    />
                  </label>


                  <div className="tech-form-grid three">
                    <label>
                      3. กล้องที่ดับ (ตัว)
                      <input
                        value={form.down}
                        readOnly
                      />
                    </label>

                    <label>
                      4. ใช้งานได้ (ตัว) *
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.usable}
                        onChange={e =>
                          changeCameraCount('usable', e.target.value)
                        }
                        onBlur={() => completeCameraCount('usable')}
                        placeholder="ระบุจำนวน"
                      />
                    </label>

                    <label>
                      5. ใช้งานไม่ได้ (ตัว) *
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.unusable}
                        onChange={e =>
                          changeCameraCount('unusable', e.target.value)
                        }
                        onBlur={() => completeCameraCount('unusable')}
                        placeholder="คำนวณอัตโนมัติ"
                      />
                    </label>
                  </div>

                  {Number(form.unusable) > 0 && (
                    <label>
                      เนื่องจากอะไร *
                      <input
                        value={form.unusableReason}
                        onChange={e =>
                          changeForm(
                            'unusableReason',
                            e.target.value
                          )
                        }
                      />
                    </label>
                  )}

                  <div className="tech-form-grid two">
                    <label>
                      6. วันที่ดำเนินการเสร็จ *
                      <input
                        type="date"
                        value={form.doneDate}
                        onChange={e =>
                          changeForm(
                            'doneDate',
                            e.target.value
                          )
                        }
                      />
                    </label>

                    <label>
                      7. เวลาดำเนินการเสร็จ *
                      <input
                        type="time"
                        value={form.doneTime}
                        onChange={e =>
                          changeForm(
                            'doneTime',
                            e.target.value
                          )
                        }
                      />
                    </label>
                  </div>

                  <section className="tech-sla">
                    <strong>
                      8. SLA (ช่างเลือกเอง)
                    </strong>

                    <div className="tech-sla-options">
                      <label>
                        <input
                          type="radio"
                          name="sla-choice"
                          checked={
                            form.slaChoice === 'within'
                          }
                          onChange={() =>
                            changeForm(
                              'slaChoice',
                              'within'
                            )
                          }
                        />
                        ไม่เกิน SLA
                      </label>

                      <label>
                        <input
                          type="radio"
                          name="sla-choice"
                          checked={
                            form.slaChoice === 'over'
                          }
                          onChange={() =>
                            changeForm(
                              'slaChoice',
                              'over'
                            )
                          }
                        />
                        เกิน SLA
                      </label>
                    </div>

                    <small>
                      ครบกำหนดตามใบงาน:{' '}
                      {formatDate(modalSla)}
                    </small>

                    {selectedOver && (
                      <label>
                        เหตุผลที่เกิน SLA *
                        <input
                          value={form.slaReason}
                          onChange={e =>
                            changeForm(
                              'slaReason',
                              e.target.value
                            )
                          }
                        />
                      </label>
                    )}
                  </section>

                  <h4>
                    9. สาเหตุ / อุปกรณ์เสียหรือค้าง
                  </h4>

                  <p className="tech-muted">
                    เลือกเสียและค้างพร้อมกันได้
                    {' · '}
                    S/N ใหม่กรอกเมื่อเปลี่ยนอุปกรณ์
                  </p>

                  <div className="tech-equipment-list">
                    {form.equipment.map((e, index) => (
                      <section
                        key={e.name}
                        className="tech-equipment-item"
                      >
                        <strong>{e.name}</strong>

                        <div className="tech-equipment-checks">
                          <label>
                            <input
                              type="checkbox"
                              checked={e.is_damaged}
                              onChange={ev =>
                                changeEquipment(
                                  index,
                                  {
                                    is_damaged:
                                      ev.target.checked,
                                    ...(
                                      !ev.target.checked
                                        ? {
                                            is_replaced: false,
                                            old_sn: '',
                                            new_sn: '',
                                          }
                                        : {}
                                    ),
                                  }
                                )
                              }
                            />
                            เสีย
                          </label>

                          <label>
                            <input
                              type="checkbox"
                              checked={e.is_stuck}
                              onChange={ev =>
                                changeEquipment(
                                  index,
                                  {
                                    is_stuck:
                                      ev.target.checked,
                                  }
                                )
                              }
                            />
                            ค้าง
                          </label>
                        </div>

                        {(e.is_damaged || e.is_stuck) && (
                          <div className="tech-equipment-fields">
                            {e.is_damaged && (
                              <>
                                <label>
                                  จำนวนเสีย
                                  <input
                                    inputMode="numeric"
                                    value={e.failed_count}
                                    onChange={ev =>
                                      changeEquipment(index, {
                                        failed_count: ev.target.value,
                                      })
                                    }
                                  />
                                </label>

                                {validInteger(e.failed_count) &&
                                Number(e.failed_count) > 0 ? (
                                  <div className="tech-serial-rows">
                                    {Array.from(
                                      { length: Number(e.failed_count) },
                                      (_, serialIndex) => (
                                        <div
                                          className="tech-serial-pair"
                                          key={serialIndex}
                                        >
                                          <strong>
                                            อุปกรณ์ตัวที่ {serialIndex + 1}
                                          </strong>

                                          <label>
                                            S/N ตัวที่เสีย *
                                            <input
                                              value={serialAt(
                                                e.old_sn,
                                                serialIndex
                                              )}
                                              onChange={ev =>
                                                changeSerial(
                                                  index,
                                                  'old_sn',
                                                  serialIndex,
                                                  ev.target.value
                                                )
                                              }
                                              placeholder={`S/N เสีย ตัวที่ ${serialIndex + 1}`}
                                            />
                                          </label>

                                          <label>
                                            S/N ตัวใหม่
                                            <input
                                              value={serialAt(
                                                e.new_sn,
                                                serialIndex
                                              )}
                                              onChange={ev =>
                                                changeSerial(
                                                  index,
                                                  'new_sn',
                                                  serialIndex,
                                                  ev.target.value
                                                )
                                              }
                                              placeholder={`S/N ใหม่ ตัวที่ ${serialIndex + 1}`}
                                            />
                                          </label>
                                        </div>
                                      )
                                    )}
                                  </div>
                                ) : (
                                  <p className="tech-muted">
                                    ระบุจำนวนเสียอย่างน้อย 1 ตัว
                                    เพื่อแสดงช่อง S/N
                                  </p>
                                )}
                              </>
                            )}

                            {e.is_stuck && (
                              <label>
                                จำนวนค้าง / Reset
                                <input
                                  inputMode="numeric"
                                  value={e.reset_count}
                                  onChange={ev =>
                                    changeEquipment(
                                      index,
                                      {
                                        reset_count:
                                          ev.target.value,
                                      }
                                    )
                                  }
                                />
                              </label>
                            )}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>

                  <h4>10. ผู้ปฏิบัติงาน</h4>

                  {techniciansError && (
                    <p className="tech-muted">
                      {techniciansError}
                    </p>
                  )}

                  <div className="tech-form-grid two">
                    <label>
                      ชื่อช่าง *
                      <select
                        value={form.technician}
                        onChange={ev => {
                          const p = technicians.find(
                            t =>
                              t.display_name ===
                              ev.target.value
                          )

                          setForm(old => ({
                            ...old,
                            technician: ev.target.value,
                            
                              phone: p
                                ? (formatMemberPhone(p.contact_phone) || p.contact_phone || '')
                                : '',
                          }))
                        }}
                      >
                        <option value="">
                          เลือกชื่อช่าง
                        </option>

                        {form.technician &&
                          !technicians.some(
                            x =>
                              x.display_name ===
                              form.technician
                          ) && (
                            <option value={form.technician}>
                              {form.technician}
                            </option>
                          )}

                        {technicians.map(p => (
                          <option
                            key={p.user_id}
                            value={p.display_name}
                          >
                            {p.display_name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      เบอร์โทร
                      <input
                        type="tel"
                        value={form.phone}
                        
                        onBlur={e => {
                          const formatted = formatMemberPhone(e.target.value)
                          if (formatted) changeForm('phone', formatted)
                        }}

                        onChange={e =>
                          changeForm(
                            'phone',
                            e.target.value
                          )
                        }
                      />
                    </label>
                  </div>

                  
                  {modalMode === 'edit' && (
                    <>
                      <p className="tech-warning">
                        การแก้ไขผลซ่อมหลังปิดงานจะถูกบันทึก
                        ประวัติก่อนและหลังแก้ไข พร้อมเหตุผล
                        และบัญชีผู้แก้ไข
                      </p>

                      <label>
                        เหตุผลการแก้ไข *
                        <textarea
                          rows={3}
                          value={editReason}
                          onChange={e => setEditReason(e.target.value)}
                          placeholder="ระบุเหตุผลอย่างน้อย 10 ตัวอักษร"
                        />
                      </label>
                    </>
                  )}

                </>
              )}
            </div>

            <footer className="tech-dialog-foot">
              <button
                type="button"
                disabled={modalSaving}
                onClick={closeModal}
              >
                ยกเลิก
              </button>

              <button
                type="button"
                className="tech-btn-close"
                
                disabled={
                  modalBusy ||
                  modalSaving ||
                  (
                    modalMode === 'edit' &&
                    editReason.trim().length < 10
                  )
                }

                onClick={submitClose}
              >
                {modalSaving
                  ? 'กำลังบันทึก...'
                  : modalMode === 'edit'
                    ? 'บันทึกการแก้ไข'
                    : 'บันทึกและปิดงาน'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {cancelTarget && (
        <div className="tech-overlay">
          <section
            className="tech-dialog tech-small-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="ยกเลิกใบงาน"
          >
            <header className="tech-dialog-head">
              <h3>
                ยกเลิกใบงาน{' '}
                {ticketLabel(cancelTarget)}
              </h3>
            </header>

            <div className="tech-dialog-body">
              {cancelError && (
                <div className="tech-error">
                  {cancelError}
                </div>
              )}

              <p className="tech-muted">
                {cancelTarget.center_name_snapshot}
                {' · '}
                ใบงานจะอยู่ในประวัติต่อไป
              </p>

              <label>
                เหตุผลการยกเลิก *
                <textarea
                  rows={4}
                  value={cancelReason}
                  onChange={e =>
                    setCancelReason(e.target.value)
                  }
                  disabled={cancelBusy}
                />
              </label>
            </div>

            <footer className="tech-dialog-foot">
              <button
                disabled={cancelBusy}
                type="button"
                onClick={() =>
                  setCancelTarget(null)
                }
              >
                กลับ
              </button>

              <button
                disabled={
                  cancelBusy ||
                  cancelReason.trim().length < 5
                }
                type="button"
                className="tech-btn-cancel"
                onClick={submitCancel}
              >
                ยืนยันยกเลิก
              </button>
            </footer>
          </section>
        </div>
      )}

      {deleteTarget && isAdmin && (
        <div className="tech-overlay">
          <section
            className="tech-dialog tech-small-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="ลบถาวร"
          >
            <header className="tech-dialog-head">
              <h3>
                ลบใบงานถาวร{' '}
                {ticketLabel(deleteTarget)}
              </h3>
            </header>

            <div className="tech-dialog-body">
              <p className="tech-warning">
                ข้อมูลใบงานและรายการกล้องจะถูกลบจริง
                และกู้คืนผ่านหน้าเว็บไม่ได้
              </p>

              {deleteError && (
                <div className="tech-error">
                  {deleteError}
                </div>
              )}

              <label>
                1. เหตุผลการลบ (อย่างน้อย 10 ตัวอักษร)
                <textarea
                  rows={3}
                  value={deleteReason}
                  disabled={deleteBusy}
                  onChange={e =>
                    setDeleteReason(e.target.value)
                  }
                />
              </label>

              <label>
                2. พิมพ์เลขใบงาน{' '}
                {ticketLabel(deleteTarget)}
                {' '}เพื่อยืนยัน
                <input
                  value={deleteConfirm}
                  disabled={deleteBusy}
                  onChange={e =>
                    setDeleteConfirm(e.target.value)
                  }
                />
              </label>

              <p className="tech-muted">
                3. ระบบจะถามยืนยันอีกครั้งก่อนลบจริง
              </p>
            </div>

            <footer className="tech-dialog-foot">
              <button
                disabled={deleteBusy}
                type="button"
                onClick={() =>
                  setDeleteTarget(null)
                }
              >
                กลับ
              </button>

              <button
                disabled={
                  deleteBusy ||
                  deleteReason.trim().length < 10 ||
                  deleteConfirm.trim() !==
                    ticketLabel(deleteTarget)
                }
                type="button"
                className="tech-btn-delete"
                onClick={submitHardDelete}
              >
                ลบถาวร
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
