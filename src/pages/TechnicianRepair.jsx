
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './TechnicianRepair.css'
import { formatMemberPhone } from './Users'

// ขอบเขตการมองเห็นของช่าง (ตรวจสิทธิ์จริงซ้ำใน RLS)
const TEAM_CENTERS = {
  takbai: [1, 7, 8],
  pattani: [2, 4, 9],
}

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

const PAGE_SIZE = 20
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
    isAdmin && o?.status === 'cancelled'

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

  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

            <h2>งานซ่อม</h2>

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
            disabled={busyList}
            onClick={loadOrders}
          >
            รีเฟรชใบงาน
          </button>
        </div>

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

                  <span>
                    {STATUS[current.status] ||
                      current.status}
                  </span>
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
      </main>

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
