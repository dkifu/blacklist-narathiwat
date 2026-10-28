import { useCallback, useEffect, useMemo, useRef, useState } from 'react'



import {

  ClipboardList,

  Plus,

  Trash2,

  Wrench,

  FileText,

  Pencil,

} from 'lucide-react'



import { supabase } from '../../lib/supabase'

import './CctvRepairOrders.css'



import CctvRepairPrint from './CctvRepairPrint'



/* =========================================

   THAI BUDDHIST ERA DATE HELPERS

   Display: DD/MM/BBBB

   Database: YYYY-MM-DD

========================================= */



// ค.ศ. -> พ.ศ. สำหรับแสดงบนหน้าเว็บ

const formatRepairBE = value => {

  if (!value) return ''



  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(

    String(value).slice(0, 10)

  )



  if (!match) return ''



  const yearBE = Number(match[1]) + 543



  return `${match[3]}/${match[2]}/${yearBE}`

}



// พ.ศ. -> ค.ศ. สำหรับส่งเข้า Supabase

const parseRepairBE = value => {

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(

    String(value || '').trim()

  )



  if (!match) return ''



  const day = Number(match[1])

  const month = Number(match[2])

  const yearBE = Number(match[3])



  if (yearBE < 2400 || yearBE > 3000) return ''



  const year = yearBE - 543

  const date = new Date(Date.UTC(year, month - 1, day))



  if (

    date.getUTCFullYear() !== year ||

    date.getUTCMonth() + 1 !== month ||

    date.getUTCDate() !== day

  ) {

    return ''

  }



  return [

    String(year).padStart(4, '0'),

    String(month).padStart(2, '0'),

    String(day).padStart(2, '0'),

  ].join('-')

}



// วันที่ก่อนหน้าของวันที่รายงาน 1 วัน

const previousRepairBE = isoDate => {

  const value = String(isoDate || '').slice(0, 10)



  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {

    return ''

  }



  const date = new Date(`${value}T12:00:00Z`)



  if (Number.isNaN(date.getTime())) return ''



  date.setUTCDate(date.getUTCDate() - 1)



  return formatRepairBE(

    date.toISOString().slice(0, 10)

  )

}



const todayTH = () =>

  new Date().toLocaleDateString('sv-SE', {

    timeZone: 'Asia/Bangkok',

  })



const SHIFT_LABELS = {

  morning: 'กะเช้า',

  afternoon: 'กะบ่าย',

  night: 'กะดึก',

}



const STATUS_LABELS = {

  draft: 'ฉบับร่าง',

  submitted: 'เปิดงานแล้ว',

  accepted: 'รับงานแล้ว',

  in_progress: 'กำลังดำเนินการ',

  completed: 'ซ่อมเสร็จ',

  closed: 'ปิดงาน',

  cancelled: 'ยกเลิก',

}



const TEAM_LABELS = {

  takbai: 'ช่างตากใบ',

  pattani: 'ช่างปัตตานี',

}



export default function CctvRepairOrders({ profile, initialSelection }) {

  const role = String(profile?.role || '').toLowerCase()

  const isAdmin = ['admin', 'supervisor'].includes(role)



  // บัญชีเจ้าหน้าที่ศูนย์ ศชต. ตัวจริง

    const isCentralAccount =

    role === 'center' &&

    Number(profile?.center_id) === 10 &&

    String(profile?.username || '').toLowerCase() === 'centercctv'



    const [centers, setCenters] = useState([])



    const [centerId, setCenterId] = useState(

    initialSelection?.centerId
        ? String(initialSelection.centerId)
        : !isAdmin && !isCentralAccount && profile?.center_id

        ? String(profile.center_id)

        : ''

    )



    // Admin / Supervisor เลือกศูนย์ ศชต.

    // เพื่อดูใบแจ้งซ่อมรวมจากทุกศูนย์

    const isCentral =

    isCentralAccount ||

    (isAdmin && String(centerId) === '10')



  const [reportDateBE, setReportDateBE] = useState(

    () => formatRepairBE(initialSelection?.reportDate || todayTH())

    )



    // วันที่ ค.ศ. สำหรับใช้กับ RPC และฐานข้อมูล

  const reportDate = parseRepairBE(reportDateBE)

  const [shift, setShift] = useState(initialSelection?.shift || 'morning')



  const [availableUnits, setAvailableUnits] = useState([])

  const [orders, setOrders] = useState([])

  const [ticketNo, setTicketNo] = useState('')



  const [lastTicketNo, setLastTicketNo] = useState('')



  const [ticketLoading, setTicketLoading] = useState(false)

  const [ticketError, setTicketError] = useState('')

  const [editingTicketId, setEditingTicketId] = useState('')

  const [editingTicketNo, setEditingTicketNo] = useState('')

  const [editingTicketReason, setEditingTicketReason] = useState('')

  const [currentOrderId, setCurrentOrderId] = useState('')

  const [orderUnits, setOrderUnits] = useState([])



  const [busy, setBusy] = useState(false)

  const [loadingUnits, setLoadingUnits] = useState(false)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')

  const [printData, setPrintData] = useState(null)

  const [dragOver, setDragOver] = useState(false)

  const dragInsideRef = useRef(false)

  const [members, setMembers] = useState([])

  const [reporterMemberId, setReporterMemberId] = useState('')



  const [outageDate, setOutageDate] = useState(

    () => previousRepairBE(todayTH())

  )



  const [outageTime, setOutageTime] = useState('')



  const currentOrder = useMemo(

    () =>

      orders.find(

        order => String(order.id) === String(currentOrderId)

      ) || null,

    [orders, currentOrderId]

  )



  // ต้องเลือกใบ Draft ที่ตรงกับศูนย์ วันที่ และกะ

    // ป้องกันการนำผล Ping คนละวันลงใบงาน

    const canAddToCurrentOrder =

    !isCentral &&

    currentOrder?.status === 'draft' &&

    String(currentOrder?.center_id) === String(centerId) &&

    currentOrder?.report_date === reportDate &&

    currentOrder?.shift === shift



  // โหลดสมาชิกตามศูนย์ของใบงานที่เลือก

    useEffect(() => {

    let cancelled = false



    async function loadMembers() {

        if (!currentOrder?.center_id || isCentral) {

        setMembers([])

        return

        }



        const { data, error } = await supabase

        .from('center_members')

        .select('id, name, rank, phone')

        .eq('center_id', currentOrder.center_id)

        .order('name')



        if (cancelled) return



        if (error) {

        setMessageType('error')  

        setMessage(error.message)

        setMembers([])

        return

        }



        setMembers(data || [])

    }



    loadMembers()



    return () => {

        cancelled = true

    }

    }, [currentOrder?.center_id, isCentral])



  // คืนข้อมูลผู้แจ้งและวันเวลาของใบงานที่เลือก

    useEffect(() => {

    setReporterMemberId(

        String(currentOrder?.reporter_member_id || '')

    )



    // ถ้ามีวันที่บันทึกไว้แล้ว ให้ใช้วันที่เดิม

    // ถ้ายังไม่มี ให้เริ่มต้นที่ 1 วันก่อนวันที่รายงาน

    setOutageDate(

        currentOrder?.outage_date

        ? formatRepairBE(currentOrder.outage_date)

        : previousRepairBE(

            currentOrder?.report_date || todayTH()

            )

    )



    setOutageTime(

        String(currentOrder?.outage_time || '').slice(0, 5)

    )

    }, [

    currentOrder?.id,

    currentOrder?.reporter_member_id,

    currentOrder?.outage_date,

    currentOrder?.outage_time,

    currentOrder?.report_date,

    ])  



  const selectedReporter = members.find(

    member =>

        String(member.id) === String(reporterMemberId)

    ) || null  



  // โหลดเฉพาะ 6 ศูนย์ที่ถูกกำหนดชุดช่างไว้

  useEffect(() => {

    let cancelled = false



    async function loadCenters() {

      const [centerResult, teamResult] = await Promise.all([

        supabase

          .from('centers')

          .select('id, name')

          .order('id'),



        supabase

          .from('cctv_repair_center_teams')

          .select('center_id, team_code'),

      ])



      if (cancelled) return



      if (centerResult.error || teamResult.error) {
        setMessageType('error')

        setMessage(

          centerResult.error?.message ||

          teamResult.error?.message ||

          'โหลดข้อมูลศูนย์ไม่สำเร็จ'

        )

        return

      }



      const teamMap = new Map(

        (teamResult.data || []).map(item => [

          Number(item.center_id),

          item.team_code,

        ])

      )



      const items = (centerResult.data || [])

        .filter(center =>

            teamMap.has(Number(center.id)) ||

            (isAdmin && Number(center.id) === 10)

        )

        .map(center => ({

            ...center,

            team_code: teamMap.get(Number(center.id)) || null,

        }))



      setCenters(items)



      if (isAdmin) {

        setCenterId(prev => prev || String(items[0]?.id || ''))

      }

    }



    loadCenters()



    return () => {

      cancelled = true

    }

  }, [isAdmin])



  const loadOrders = useCallback(

    async (preferredId = null) => {

      if (!isCentral && !centerId) {

        setOrders([])

        return

      }



      let query = supabase

        .from('cctv_repair_orders')

        .select(`

          id,

          ticket_no,

          center_id,

          center_name_snapshot,

          team_code,

          report_date,

          shift,

          status,

            created_at,

            reporter_member_id,

            reporter_name,

            reporter_rank,

            reporter_phone,

            outage_date,

            outage_time

        `)

        
        .neq('status', 'cancelled')
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(100)




      if (isCentral) {

        // ศชต. เห็นเฉพาะใบงานที่ส่งแล้ว

        // ไม่แสดง Draft ของแต่ละศูนย์

        query = query.neq('status', 'draft')

        } else {

        // ศูนย์ทั่วไปเห็นเฉพาะใบงานของตนเอง

        query = query.eq('center_id', Number(centerId))

        }



      const { data, error } = await query



      if (error) {

        setMessageType('error')

        setMessage(error.message)

        return

      }



      const items = data || []

      setOrders(items)



      setCurrentOrderId(previous => { 
        if (
          preferredId !== null &&
          items.some(
            order => String(order.id) === String(preferredId)
          )
        ) {
          return String(preferredId)
        }




        const existing = items.find(

          order => String(order.id) === String(previous)

        )



        if (existing) return String(existing.id)



        const initialOrder = isCentral

        ? items.find(order => order.status === 'submitted') || items[0]

        : items.find(order => order.status === 'draft') || items[0]



        return initialOrder ? String(initialOrder.id) : ''



      })

    },

    [centerId, isCentral]

  )



  const loadOrderUnits = useCallback(async orderId => {

    if (!orderId) {

      setOrderUnits([])

      return

    }



    const { data, error } = await supabase

      .from('cctv_repair_order_units')

      .select('*')

      .eq('order_id', Number(orderId))

      .order('id')



    if (error) {

      setMessageType('error')

      setMessage(error.message)

      return

    }



    setOrderUnits(data || [])

  }, [])



  // รายการใบงานของศูนย์ / รายการทุกศูนย์ของ ศชต.

  useEffect(() => {

    loadOrders()

  }, [loadOrders])



  // ตู้และด่านที่ Offline จากผล Ping

  useEffect(() => {

    let cancelled = false



    async function loadAvailable() {

      if (!centerId || isCentral || !reportDate) {

        setAvailableUnits([])

        return

      }



      setLoadingUnits(true)



      const { data, error } = await supabase.rpc(

        'cctv_repair_available_units',

        {

          p_center_id: Number(centerId),

          p_report_date: reportDate,

          p_shift: shift,

        }

      )



      if (cancelled) return



      setLoadingUnits(false)



      if (error) {

        setAvailableUnits([])

        setMessageType('error')

        setMessage(error.message)

        return

      }



      setAvailableUnits(data || [])

    }



    loadAvailable()



    return () => {

      cancelled = true

    }

  }, [centerId, reportDate, shift, isCentral])



  useEffect(() => {

    loadOrderUnits(currentOrderId)

  }, [currentOrderId, loadOrderUnits])



  // โหลดเลขใบงานถัดไป เมื่อเลือกศูนย์

    useEffect(() => {

    let cancelled = false







    if (!centerId || isCentral) {

        setLastTicketNo('')

        setTicketNo('')

        setTicketError('')

        setTicketLoading(false)

        return

    }





        setTicketNo('')

        setLastTicketNo('')

        setTicketError('')

        setTicketLoading(true)







    async function loadTicket() {

      const [nextResult, lastResult] = await Promise.all([

        supabase.rpc('cctv_repair_next_ticket', {

          p_center_id: Number(centerId),

        }),



        supabase

          .from('cctv_repair_orders')

          .select('ticket_no')

          .eq('center_id', Number(centerId))

          .not('ticket_no', 'is', null)

          .order('created_at', { ascending: false })

          .order('id', { ascending: false })

          .limit(1),

      ])



      if (cancelled) return



      setTicketNo(

        nextResult.error

          ? ''

          : String(nextResult.data || '')

      )



      setLastTicketNo(

        lastResult.error

          ? ''

          : String(lastResult.data?.[0]?.ticket_no || '')

      )



      setTicketError(

        nextResult.error?.message ||

        lastResult.error?.message ||

        ''

      )



      setTicketLoading(false)

    }





    loadTicket()



    return () => {

        cancelled = true

    }

    }, [centerId, isCentral])



    // รีเฟรชเลขหลังสร้างหรือลบใบงาน

    async function refreshNextTicket() {

    if (!centerId || isCentral) return



    setTicketLoading(true)

    setTicketError('')





    const [nextResult, lastResult] = await Promise.all([

      supabase.rpc('cctv_repair_next_ticket', {

        p_center_id: Number(centerId),

      }),



      supabase

        .from('cctv_repair_orders')

        .select('ticket_no')

        .eq('center_id', Number(centerId))

        .not('ticket_no', 'is', null)

        .order('created_at', { ascending: false })

        .order('id', { ascending: false })

        .limit(1),

    ])



    setTicketNo(

      nextResult.error

        ? ''

        : String(nextResult.data || '')

    )



    setLastTicketNo(

      lastResult.error

        ? ''

        : String(lastResult.data?.[0]?.ticket_no || '')

    )



    setTicketError(

      nextResult.error?.message ||

      lastResult.error?.message ||

      ''

    )



    setTicketLoading(false)



    }



  async function runAction(callback) {
    if (busy) return

    setBusy(true)
    setMessageType('success')
    setMessage('')



    try {

      await callback()

    } catch (error) {

        console.error('[CCTV Repair Error]', error)
        setMessageType('error')


        setMessage(

            `บันทึกไม่สำเร็จ: ${

            error?.message ||

            error?.details ||

            'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'

            }`

        )

        } finally {

        setBusy(false)

        }

  }



  function createDraft() {

  if (

    !centerId ||

    !reportDate ||

    !ticketNo.trim() ||

    ticketLoading ||

    busy ||

    isCentral

  ) {

    return

  }



  runAction(async () => {

    const requestedTicket = ticketNo.trim().toUpperCase()



    const { data, error } = await supabase.rpc(

      'cctv_repair_create_numbered',

      {

        p_center_id: Number(centerId),

        p_report_date: reportDate,

        p_shift: shift,

        p_ticket_no: requestedTicket,

      }

    )



    if (error) {

      // อาจมีเครื่องอื่นสร้างเลขนี้ไปก่อนแล้ว

      await refreshNextTicket()

      throw error

    }



    await loadOrders(data)

    await refreshNextTicket()



    setMessage(

      `สร้างใบแจ้งซ่อมฉบับร่าง ${requestedTicket} เรียบร้อยแล้ว`

    )

  })

}



  function addUnit(unit) {

    if (!currentOrder || currentOrder.status !== 'draft') return



    runAction(async () => {

      const { error } = await supabase.rpc(

        'cctv_repair_add_unit',

        {

          p_order_id: Number(currentOrder.id),

          p_network_type: unit.network_type,

          p_unit_label: unit.unit_label,

        }

      )



      if (error) throw error



      await loadOrderUnits(currentOrder.id)

      setMessage(`เพิ่ม ${unit.unit_label} ลงใบงานแล้ว`)

    })

  }



  function removeUnit(unit) {

    if (!currentOrder || currentOrder.status !== 'draft') return



    runAction(async () => {

      const { error } = await supabase.rpc(

        'cctv_repair_remove_unit',

        {

          p_order_id: Number(currentOrder.id),

          p_unit_id: Number(unit.id),

        }

      )



      if (error) throw error



      await loadOrderUnits(currentOrder.id)

      setMessage(`นำ ${unit.unit_label} ออกจากใบงานแล้ว`)

    })

  }



function saveDraftInfo() {

  if (!currentOrder || currentOrder.status !== 'draft') return



  runAction(async () => {

    // แปลงวันที่ที่พี่เห็นเป็น พ.ศ.

    // กลับเป็น ค.ศ. ก่อนส่ง Supabase

    const normalizedOutageDate =

      parseRepairBE(outageDate)



    const orderReportDate =

      String(currentOrder.report_date || '').slice(0, 10)



    if (!reporterMemberId) {

      throw new Error('กรุณาเลือกผู้แจ้งซ่อม')

    }



    if (!normalizedOutageDate) {

      throw new Error(

        'วันที่กล้องดับไม่ถูกต้อง กรุณาระบุเป็น วว/ดด/พ.ศ. เช่น 21/10/2569'

      )

    }



    if (!outageTime) {

      throw new Error('กรุณาระบุเวลาที่กล้องดับ')

    }



    // ห้ามวันที่ดับเกินวันที่รายงานของใบงานนี้

    if (normalizedOutageDate > orderReportDate) {

      throw new Error(

        `วันที่กล้องดับต้องไม่เกินวันที่รายงาน ` +

        formatRepairBE(orderReportDate)

      )

    }



    const { error } = await supabase.rpc(

      'cctv_repair_update_draft_info',

      {

        p_order_id: Number(currentOrder.id),

        p_reporter_member_id: reporterMemberId,

        p_outage_date: normalizedOutageDate,

        p_outage_time: outageTime,

      }

    )



    if (error) {

      throw error

    }



    await loadOrders(currentOrder.id)



    setMessage('บันทึกข้อมูลผู้แจ้งเรียบร้อยแล้ว')

  })

}



// ส่งใบแจ้งซ่อมให้ ศชต.

function submitRepairOrder() {

  if (!currentOrder || currentOrder.status !== 'draft') return



  const confirmed = window.confirm(

    'ยืนยันส่งใบแจ้งซ่อมให้ ศชต.?\n\n' +

    'เมื่อส่งแล้วจะไม่สามารถแก้ไขรายการตู้/ด่านได้'

  )



  if (!confirmed) return



  runAction(async () => {

    const { data, error } = await supabase.rpc(

      'cctv_repair_submit_order',

      {

        p_order_id: Number(currentOrder.id),

      }

    )



    if (error) throw error



    await loadOrders(currentOrder.id)

    setMessage(`ส่งใบแจ้งซ่อมสำเร็จ เลขที่ ${data}`)

  })

}





// =========================================

// ศชต. ยกเลิกใบงานที่ส่งมาแล้ว

// =========================================

function cancelCentralRepairOrder(order) {

  if (

    !isCentral ||

    !order ||

    busy ||

    !['submitted', 'accepted', 'in_progress'].includes(order.status)

  ) return



  const reason = window.prompt(

    `ระบุเหตุผลการยกเลิก ${order.ticket_no}\n` +

    'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร',

    ''

  )



  if (reason === null) return



  const normalizedReason = reason.trim()



  if (normalizedReason.length < 5) {

    window.alert('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร')

    return

  }



  if (!window.confirm(

    `ยืนยันยกเลิก ${order.ticket_no}?\n\n` +

    `เหตุผล: ${normalizedReason}`

  )) return



  runAction(async () => {

    const { data, error } = await supabase.rpc(

      'cctv_repair_cancel_submitted_order',

      {

        p_order_id: Number(order.id),

        p_reason: normalizedReason,

      }

    )



    if (error) throw error

    if (data !== true) {

      throw new Error('ระบบไม่ยืนยันการยกเลิกใบงาน')

    }



    setEditingTicketId('')

    await loadOrders()



    setMessage(

      `ยกเลิกใบงาน ${order.ticket_no} เรียบร้อยแล้ว`

    )

  })

}





// =========================================

// เปิดช่องแก้ไขเลขใบงาน

// =========================================

function openCentralTicketEdit(order) {

  if (!isCentral || !order || busy) return



  const oldTicket = String(order.ticket_no || '')



  setEditingTicketId(String(order.id))



  // เลขรูปแบบเก่า CCTV-... ให้กรอกเลขใหม่

  setEditingTicketNo(

    /^[A-Z]{2,8}-C[0-9]{3,9}$/.test(oldTicket)

      ? oldTicket

      : ''

  )



  setEditingTicketReason('')

}





// =========================================

// บันทึกเลขใบงานใหม่

// =========================================

function saveCentralTicketEdit() {

  if (

    !isCentral ||

    !currentOrder ||

    busy ||

    String(currentOrder.id) !== editingTicketId

  ) return



  const newTicket = editingTicketNo.trim().toUpperCase()

  const reason = editingTicketReason.trim()

  const oldTicket = currentOrder.ticket_no



  if (!newTicket) {

    window.alert('กรุณาระบุเลขใบงานใหม่')

    return

  }



  if (reason.length < 5) {

    window.alert('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร')

    return

  }



  if (!window.confirm(

    `ยืนยันแก้ไขเลขใบงาน?\n\n` +

    `เลขเดิม: ${oldTicket}\n` +

    `เลขใหม่: ${newTicket}\n` +

    `เหตุผล: ${reason}`

  )) return



  runAction(async () => {

    const { data, error } = await supabase.rpc(

      'cctv_repair_change_ticket_no',

      {

        p_order_id: Number(currentOrder.id),

        p_new_ticket_no: newTicket,

        p_reason: reason,

      }

    )



    if (error) throw error



    if (data !== true) {

      throw new Error('ระบบไม่ยืนยันการเปลี่ยนเลขใบงาน')

    }



    await loadOrders(currentOrder.id)



    setEditingTicketId('')

    setEditingTicketNo('')

    setEditingTicketReason('')



    setMessage(

      `แก้ไขเลขใบงาน ${oldTicket} เป็น ${newTicket} สำเร็จ`

    )

  })

}







// ยกเลิกใบแจ้งซ่อมฉบับร่าง

function cancelDraftOrder(order) {

  if (!order || order.status !== 'draft' || busy) return



  const confirmed = window.confirm(

    `ยืนยันลบใบแจ้งซ่อม ${

      order.ticket_no || `ฉบับร่าง #${order.id}`

    } ?\n\n` +

    'รายการนี้จะหายจากหน้าใบแจ้งซ่อม\n' +

    'ระบบยังเก็บประวัติการยกเลิกไว้'

  )



  if (!confirmed) return



  runAction(async () => {

    const { data, error } = await supabase.rpc(

      'cctv_repair_cancel_draft',

      {

        p_order_id: Number(order.id),

      }

    )



    // แสดงข้อผิดพลาดให้เห็นทันที

    // ไม่ต้องเลื่อนกลับไปดูข้อความด้านบน

    if (error) {

      window.alert(

        `ไม่สามารถลบใบงานได้\n\n${error.message}`

      )

      throw error

    }



    if (data !== true) {

      throw new Error(

        'Supabase ไม่ยืนยันการยกเลิกใบงาน'

      )

    }



    // ลบการ์ดออกจากหน้าจอ

    // หลัง Supabase ยืนยันสำเร็จเท่านั้น

    setOrders(previous =>

      previous.filter(

        item => String(item.id) !== String(order.id)

      )

    )



    // ยกเลิกการเลือกใบงานที่ถูกลบ

    setCurrentOrderId(previous =>

      String(previous) === String(order.id)

        ? ''

        : previous

    )



    // โหลดข้อมูลจริงจากฐานข้อมูลอีกครั้ง

    await loadOrders()



    // อัปเดตเลขใบงานถัดไป

    await refreshNextTicket()



    setMessage(

      `ยกเลิกใบแจ้งซ่อม ${

        order.ticket_no || `ฉบับร่าง #${order.id}`

      } เรียบร้อยแล้ว`

    )

  })

}



// =========================================

// DRAG & DROP CCTV REPAIR UNIT

// =========================================



const REPAIR_DRAG_TYPE =

  'application/x-cctv-repair-unit'



function handleUnitDragStart(event, unit) {

  if (

    !canAddToCurrentOrder ||

    busy ||

    !unit.source_is_final

  ) {

    event.preventDefault()

    return

  }



  event.dataTransfer.effectAllowed = 'copy'



  event.dataTransfer.setData(

    REPAIR_DRAG_TYPE,

    JSON.stringify({

      network_type: unit.network_type,

      unit_label: unit.unit_label,

    })

  )

}



function handleUnitDragOver(event) {

  if (!canAddToCurrentOrder || busy) return



  if (

    !Array.from(event.dataTransfer.types || [])

      .includes(REPAIR_DRAG_TYPE)

  ) {

    return

  }



  event.preventDefault()

  event.dataTransfer.dropEffect = 'copy'



  // อัปเดต React เพียงครั้งเดียวเมื่อเข้าพื้นที่

  if (!dragInsideRef.current) {

    dragInsideRef.current = true

    setDragOver(true)

  }

}





// ป้องกัน DragLeave หลอกเมื่อเมาส์ผ่าน element ลูก

function handleUnitDragLeave(event) {

  const rect = event.currentTarget.getBoundingClientRect()



  const x = event.clientX

  const y = event.clientY



  const stillInside =

    x >= rect.left &&

    x <= rect.right &&

    y >= rect.top &&

    y <= rect.bottom



  // ยังอยู่ในกรอบจริง ไม่ต้องปิดไฮไลต์

  if (stillInside) return



  dragInsideRef.current = false

  setDragOver(false)

}



function handleUnitDrop(event) {

  event.preventDefault()



  dragInsideRef.current = false

  setDragOver(false)



  if (!canAddToCurrentOrder || busy) return



  const raw = event.dataTransfer.getData(

    REPAIR_DRAG_TYPE

  )



  if (!raw) return



  let dropped



  try {

    dropped = JSON.parse(raw)

  } catch {

    return

  }



  // ตรวจว่าการ์ดที่ลากเป็นข้อมูลจริงในรายการ

  const unit = availableUnits.find(item =>

    item.network_type === dropped.network_type &&

    item.unit_label === dropped.unit_label

  )



  if (!unit || !unit.source_is_final) return



  const key = `${unit.network_type}:${unit.unit_label}`



  // ไม่เพิ่มตู้/ด่านเดิมซ้ำ

  if (selectedUnitKeys.has(key)) return



  addUnit(unit)

}



function openRepairPrint(orderId) {

  if (!orderId) return



  runAction(async () => {

    // โหลดข้อมูลใบงานล่าสุดจาก Supabase

    // ไม่ใช้ค่าจากฟอร์มที่ยังไม่ได้บันทึก

    const [orderResult, unitsResult] = await Promise.all([

      supabase

        .from('cctv_repair_orders')

        .select('*')

        .eq('id', Number(orderId))

        .single(),



      supabase

        .from('cctv_repair_order_units')

        .select('*')

        .eq('order_id', Number(orderId))

        .order('id'),

    ])



    if (orderResult.error) {

      throw orderResult.error

    }



    if (unitsResult.error) {

      throw unitsResult.error

    }



    setPrintData({

      order: orderResult.data,

      units: unitsResult.data || [],

    })

  })

}



  const selectedUnitKeys = new Set(

    orderUnits.map(unit => `${unit.network_type}:${unit.unit_label}`)

  )



  // แสดงเฉพาะตู้/ด่านที่ยังไม่ได้เพิ่มลงใบงาน

    const remainingUnits = availableUnits.filter(unit => {

    const key = `${unit.network_type}:${unit.unit_label}`



    return !selectedUnitKeys.has(key)

    })





  // การ์ดใบแจ้งซ่อม ใช้ร่วมกันทั้งศูนย์ทั่วไปและ ศชต.

  function renderRepairOrder(order) {

    return (

      <div className="repair-order-row" key={order.id}>

        <button

          type="button"

          className={

            'repair-order-button' +

            (String(currentOrderId) === String(order.id)

              ? ' is-selected'

              : '')

          }

          onClick={() => setCurrentOrderId(String(order.id))}

        >

          <strong>

            {order.ticket_no || `ฉบับร่าง #${order.id}`}

          </strong>



          <span>

            {order.center_name_snapshot}

            {' · '}

            {TEAM_LABELS[order.team_code] || ''}

          </span>



          <small>

            {formatRepairBE(order.report_date)}

            {' · '}

            {STATUS_LABELS[order.status] || order.status}

          </small>

        </button>



        {order.status === 'draft' && !isCentral && (

          <button

            type="button"

            className="repair-delete-draft-button"

            disabled={busy}

            onClick={() => cancelDraftOrder(order)}

            title="ลบใบแจ้งซ่อมฉบับร่าง"

          >

            <Trash2 size={16} />

            ลบ

          </button>

        )}

      </div>

    )

  }





  return (

    <div className="repair-page">

      <header className="repair-heading">

        <div>

          <span className="repair-eyebrow">CCTV REPAIR MANAGEMENT</span>

          <h1>ระบบใบแจ้งซ่อม CCTV</h1>

          <p>

            {isCentral

              ? 'ติดตามใบแจ้งซ่อมจากศูนย์ในความรับผิดชอบของชุดช่าง'

              : 'เลือกตู้หรือด่านที่มีกล้องขัดข้องเพื่อจัดทำใบแจ้งซ่อม'}

          </p>

        </div>

        <Wrench size={32} />

      </header>



      {!!message && (

        <div
          className={`repair-message repair-message--${messageType}`}
          role={messageType === 'error' ? 'alert' : 'status'}
        >

          {message}

        </div>

      )}



      {!isCentralAccount && (

        <section className="repair-panel">

          <h2>ข้อมูลรายงานต้นทาง</h2>



          <div className="repair-filters">

            <label>

              ศูนย์

              <select

                value={centerId}

                disabled={!isAdmin}

                onChange={event => {

                  setCenterId(event.target.value)

                  setCurrentOrderId('')

                }}

              >

                {!centerId && <option value="">เลือกศูนย์</option>}

                {centers.map(center => (

                  <option key={center.id} value={center.id}>

                    {center.name}

                  </option>

                ))}

              </select>

            </label>



            <label>

            วันที่รายงาน (พ.ศ.)

            <input

                type="text"

                inputMode="numeric"

                maxLength={10}

                placeholder="วว/ดด/พ.ศ."

                value={reportDateBE}

                onChange={event =>

                setReportDateBE(event.target.value)

                }

            />

            </label>



            <label>

              กะ

              <select

                value={shift}

                onChange={event => setShift(event.target.value)}

              >

                {Object.entries(SHIFT_LABELS).map(([key, label]) => (

                  <option key={key} value={key}>

                    {label}

                  </option>

                ))}

              </select>

            </label>

          </div>



          {!isCentral ? (

            <div>

                <div

                className="repair-filters"

                style={{

                    gridTemplateColumns: 'minmax(0, 1fr)',

                    maxWidth: 380,

                    marginBottom: 12,

                }}

                >

                <label>

                    เลขที่ใบแจ้งซ่อม



                    <input

                    type="text"

                    value={ticketNo}

                    onChange={event =>

                        setTicketNo(event.target.value.toUpperCase())

                    }

                    placeholder="เช่น NRW-C001"

                    maxLength={24}

                    disabled={!centerId || ticketLoading || busy}

                    autoComplete="off"

                    spellCheck={false}

                    />

                </label>



                  <p

                    className="repair-muted"

                    style={{

                      margin: '4px 0 0',

                      fontSize: 12,

                      color: '#a5b2c3',

                    }}

                  >

                    เลขใบงานที่ออกก่อนหน้า:{' '}

                    <strong style={{ color: '#f3c36a' }}>

                      {lastTicketNo || 'ยังไม่มีข้อมูลในระบบ'}

                    </strong>

                  </p>



                </div>



                {ticketError ? (

                <p className="repair-muted" style={{ color: '#fa8793' }}>

                    โหลดเลขใบงานไม่สำเร็จ: {ticketError}

                </p>

                ) : (

                <p className="repair-muted">

                    {ticketLoading

                    ? 'กำลังตรวจสอบเลขใบงาน...'

                    : 'ระบบเสนอเลขถัดไปอัตโนมัติ สามารถแก้เลขเองได้ทุกครั้ง โดยเลขต้องไม่ซ้ำ'

}

                </p>

                )}



                <div className="repair-form-actions">

                <button

                    type="button"

                    className="repair-primary-button"

                    disabled={

                    !centerId ||

                    !reportDate ||

                    !ticketNo.trim() ||

                    Boolean(ticketError) ||

                    ticketLoading ||

                    busy

                    }

                    onClick={createDraft}

                >

                    <Plus size={18} />

                    สร้างใบแจ้งซ่อมฉบับร่าง

                </button>



                <button

                    type="button"

                    className="repair-preview-button"

                    style={{

                    width: 'auto',

                    margin: 0,

                    }}

                    disabled={!centerId || ticketLoading || busy}

                    onClick={refreshNextTicket}

                >

                    รีเฟรชเลข

                </button>

                </div>

            </div>

            ) : (

            <p className="repair-muted">

                มุมมองศูนย์ ศชต. — แสดงใบแจ้งซ่อมจากทุกศูนย์

                สำหรับตรวจสอบและพรีวิวเอกสาร

            </p>

            )}

        </section>

      )}



      <section className="repair-panel">

        <h2>

          <ClipboardList size={20} />

          {isCentral ? 'ใบแจ้งซ่อมจากทุกศูนย์' : 'ใบแจ้งซ่อมของศูนย์'}

        </h2>





        {orders.length === 0 ? (

        <p className="repair-muted">

            ยังไม่มีใบแจ้งซ่อม

        </p>

        ) : isCentral ? (

        <div className="repair-team-columns">

            {Object.entries(TEAM_LABELS).map(

            ([teamCode, teamLabel]) => {

                const teamOrders = orders.filter(

                order => order.team_code === teamCode

                )



                return (

                <div

                    key={teamCode}

                    className={`repair-team-panel repair-team-${teamCode}`}

                >

                    <div className="repair-team-heading">

                    <div className="repair-team-title">

                        <Wrench size={19} />

                        <strong>{teamLabel}</strong>

                    </div>



                    <span className="repair-team-count">

                        {teamOrders.length} ใบงาน

                    </span>

                    </div>



                    <div className="repair-order-list">

                    {teamOrders.length === 0 ? (

                        <p className="repair-muted">

                        ยังไม่มีใบแจ้งซ่อมของ{teamLabel}

                        </p>

                    ) : (

                        teamOrders.map(renderRepairOrder)

                    )}

                    </div>

                </div>

                )

            }

            )}

        </div>

        ) : (

        <div className="repair-order-list">

            {orders.map(renderRepairOrder)}

        </div>

        )}



      </section>



      {!isCentral && currentOrder?.status === 'draft' && (

        <section className="repair-panel">

            <h2>ข้อมูลผู้แจ้งซ่อม</h2>





              <p className="repair-muted" style={{ marginBottom: 14 }}>

                ใบงานที่กำลังแก้ไข:{' '}

                <strong>{currentOrder.ticket_no || `#${currentOrder.id}`}</strong>

                {' · '}วันที่รายงาน: {formatRepairBE(currentOrder.report_date)}

                {' · '}{SHIFT_LABELS[currentOrder.shift] || '-'}

              </p>



              {!canAddToCurrentOrder && (

                <p className="repair-muted" style={{ color: '#ffb67c' }}>

                  วันที่หรือกะที่เลือกด้านบนไม่ตรงกับใบงานฉบับร่างนี้

                  กรุณาเลือกให้ตรงกัน หรือสร้างใบงานใหม่สำหรับวันที่ต้องการ

                </p>

              )}





            <div className="repair-filters">

            <label>

                ผู้แจ้งซ่อม

                <select

                value={reporterMemberId}

                onChange={e => setReporterMemberId(e.target.value)}

                >

                <option value="">เลือกสมาชิกประจำศูนย์</option>



                {members.map(member => (

                    <option key={member.id} value={String(member.id)}>

                    {[member.rank, member.name]

                        .filter(Boolean)

                        .join(' ')}

                    </option>

                ))}

                </select>

            </label>



            <label>

                วันที่กล้องดับ (พ.ศ.)

            <input

                type="text"

                inputMode="numeric"

                maxLength={10}

                placeholder="วว/ดด/พ.ศ."

                value={outageDate}

                onChange={e => setOutageDate(e.target.value)}

            />

            </label>



            <label>

                เวลาที่กล้องดับ

                <input

                type="time"

                value={outageTime}

                onChange={e => setOutageTime(e.target.value)}

                />

            </label>

            </div>



            {selectedReporter && (

            <p className="repair-muted">

                ผู้แจ้ง: {[selectedReporter.rank, selectedReporter.name]

                .filter(Boolean)

                .join(' ')}

                {' · โทร. '}

                {selectedReporter.phone || 'ยังไม่ระบุ'}

            </p>

            )}



            <div className="repair-form-actions">

            <button

                type="button"

                className="repair-primary-button"

                onClick={saveDraftInfo}



                disabled={busy || !canAddToCurrentOrder}



            >

                บันทึกข้อมูลผู้แจ้ง

            </button>



            <button

                type="button"

                className="repair-submit-button"

                onClick={submitRepairOrder}

                disabled={

                busy ||

                !currentOrder.reporter_member_id ||

                orderUnits.length === 0

                }

            >

                ส่งใบแจ้งซ่อมให้ ศชต.

            </button>

            </div>



            {message && (

                <div

                    className={`repair-message repair-message--${messageType}`}

                    role={messageType === 'error' ? 'alert' : 'status'}

                    style={{ marginTop: 12 }}

                >

                    {message}

                </div>

                )}

        </section>

        )}



      <div className="repair-columns">

        {!isCentral && (

          <section className="repair-panel">

            <h2>

                ตู้/ด่านที่มีกล้อง Offline



            <span

                    style={{

                    marginLeft: 'auto',

                    color: '#91a4bc',

                    fontSize: 12,

                    fontWeight: 600,

                    }}

            >

                    เหลือ {remainingUnits.length} / {availableUnits.length} ตู้

                </span>

                </h2>



            {loadingUnits ? (

              <p className="repair-muted">กำลังโหลดผล Ping...</p>

            ) : availableUnits.length === 0 ? (

            <p className="repair-muted">

                ไม่พบตู้/ด่านที่มีกล้อง Offline ในวันที่และกะนี้

            </p>

            ) : remainingUnits.length === 0 ? (

            <p className="repair-muted">

                เพิ่มตู้/ด่านทั้งหมดลงใบแจ้งซ่อมแล้ว

                หากต้องการแก้ไข สามารถนำรายการออกจากใบงานฝั่งขวาได้

            </p>

            ) : (

              <div className="repair-card-list">

                {remainingUnits.map(unit => {

                  const key = `${unit.network_type}:${unit.unit_label}`

                    const alreadyAdded = selectedUnitKeys.has(key)



                    const canDrag =

                    canAddToCurrentOrder &&

                    !busy &&

                    !alreadyAdded &&

                    unit.source_is_final



                    return (

                    <div

                        className={
                          'repair-unit-card repair-available-unit-card' +
                          (canDrag ? ' is-draggable' : '')
                        }

                        key={key}

                        draggable={canDrag}

                        onDragStart={event =>

                        handleUnitDragStart(event, unit)

                        }

                        onDragEnd={() => {

                            dragInsideRef.current = false

                            setDragOver(false)

                        }}

                        title={

                        canDrag

                            ? 'ลากไปวางในใบแจ้งซ่อมฝั่งขวา'

                            : undefined

                        }

                    >

                      <strong>{unit.unit_label}</strong>



                      <span>

                        {unit.network_type === 'checkpoint'

                          ? 'กล้องด่าน'

                          : 'กล้องทั่วไป'}

                        {' · ดับ '}

                        {unit.down_camera_count}

                        {' / '}

                        {unit.total_camera_count}

                        {' กล้อง'}

                      </span>



                      <small>

                        {unit.full_outage

                          ? 'ดับทั้งตู้/ด่าน'

                          : 'ดับบางกล้อง'}

                        {' · '}

                        {unit.source_is_final

                          ? 'รายงานยืนยันแล้ว'

                          : 'รายงานยังไม่ยืนยัน'}

                      </small>



                      <button

                        type="button"

                        disabled={

                          busy ||

                          !currentOrder ||

                          currentOrder.status !== 'draft' ||

                          alreadyAdded ||

                          !unit.source_is_final

                        }

                        onClick={() => addUnit(unit)}

                      >

                        <Plus size={15} />

                        {alreadyAdded ? 'เพิ่มแล้ว' : 'เพิ่มลงใบงาน'}

                      </button>

                    </div>

                  )

                })}

              </div>

            )}

          </section>

        )}



        <section

            className={

                'repair-panel repair-drop-zone' +

                (dragOver ? ' is-drag-over' : '')

            }

            onDragOver={handleUnitDragOver}

            onDragLeave={handleUnitDragLeave}

            onDrop={handleUnitDrop}

            >

          <h2>รายการในใบแจ้งซ่อม</h2>



          {canAddToCurrentOrder && (

            <div className="repair-drop-hint">

                <Wrench size={18} />

                <span>

                ลากการ์ดตู้/ด่านจากฝั่งซ้ายมาวางในพื้นที่นี้

                หรือกดปุ่มเพิ่มลงใบงาน

                </span>

            </div>

            )}



            {currentOrder?.status === 'draft' &&

            !canAddToCurrentOrder &&

            !isCentral && (

                <p className="repair-muted">

                ใบงานที่เลือกไม่ตรงกับศูนย์ วันที่ หรือกะ

                กรุณาเลือกใบงานให้ตรงกับข้อมูลรายงานต้นทาง

                </p>

            )}



          {!currentOrder ? (

            <p className="repair-muted">

              {isCentral

                ? 'เลือกใบงานจากรายการด้านบน'

                : 'สร้างหรือเลือกใบงานฉบับร่างก่อน'}

            </p>

          ) : (

            <>

              <div className="repair-order-summary">

                <strong>

                  {currentOrder.ticket_no ||

                    `ฉบับร่าง #${currentOrder.id}`}

                </strong>

                <span>

                  {STATUS_LABELS[currentOrder.status] ||

                    currentOrder.status}

                </span>

              </div>



              <button

                type="button"

                className="repair-preview-button"

                disabled={busy}

                onClick={() => openRepairPrint(currentOrder.id)}

                >

                <FileText size={17} />

                พรีวิวใบแจ้งซ่อม A4

              </button>





              {isCentral && (

                <>

                    <div

                    className="repair-form-actions"

                    style={{ marginTop: 12, marginBottom: 14 }}

                    >





                    {[

                        'submitted',

                        'accepted',

                        'in_progress',

                        'completed',

                        'closed',

                    ].includes(currentOrder.status) && (

                        <button

                        type="button"

                        className="repair-preview-button"

                        style={{ width: 'auto', margin: 0 }}

                        disabled={busy}

                        onClick={() => openCentralTicketEdit(currentOrder)}

                        >

                        <Pencil size={16} />

                        แก้ไขเลขใบงาน

                        </button>

                    )}



                    {[

                        'submitted',

                        'accepted',

                        'in_progress',

                    ].includes(currentOrder.status) && (

                        <button

                        type="button"

                        className="repair-delete-draft-button"

                        disabled={busy}

                        onClick={() => cancelCentralRepairOrder(currentOrder)}

                        >

                        <Trash2 size={16} />

                        ยกเลิกใบงาน

                        </button>

                    )}

                    </div>



                    {editingTicketId === String(currentOrder.id) && (

                    <div

                        style={{

                        padding: 16,

                        marginBottom: 16,

                        background: '#192536',

                        border: '1px solid #35445b',

                        borderRadius: 12,

                        }}

                    >

                        <h3 style={{ marginTop: 0, fontSize: 14 }}>

                        แก้ไขเลขที่ใบแจ้งซ่อม

                        </h3>



                        <p className="repair-muted">

                        เลขปัจจุบัน: {currentOrder.ticket_no}

                        </p>



                        <div

                        className="repair-filters"

                        style={{

                            gridTemplateColumns:

                            'repeat(auto-fit, minmax(220px, 1fr))',

                        }}

                        >

                        <label>

                            เลขใบงานใหม่



                            <input

                            type="text"

                            value={editingTicketNo}

                            placeholder="เช่น NRW-C010"

                            maxLength={24}

                            disabled={busy}

                            autoComplete="off"

                            spellCheck={false}

                            onChange={event =>

                                setEditingTicketNo(

                                event.target.value.toUpperCase()

                                )

                            }

                            />

                        </label>



                        <label>

                            เหตุผลการแก้ไข



                            <input

                            type="text"

                            value={editingTicketReason}

                            placeholder="ระบุเหตุผลอย่างน้อย 5 ตัวอักษร"

                            maxLength={300}

                            disabled={busy}

                            onChange={event =>

                                setEditingTicketReason(event.target.value)

                            }

                            />

                        </label>

                        </div>



                        <div className="repair-form-actions">

                        <button

                            type="button"

                            className="repair-primary-button"

                            disabled={

                            busy ||

                            !editingTicketNo.trim() ||

                            editingTicketReason.trim().length < 5

                            }

                            onClick={saveCentralTicketEdit}

                        >

                            บันทึกเลขใบงานใหม่

                        </button>



                        <button

                            type="button"

                            className="repair-preview-button"

                            style={{ width: 'auto', margin: 0 }}

                            disabled={busy}

                            onClick={() => setEditingTicketId('')}

                        >

                            ปิด

                        </button>

                        </div>

                    </div>

                    )}

                </>

                )}  





              {orderUnits.length === 0 ? (

                <p className="repair-muted">

                  ยังไม่มีตู้หรือด่านในใบงานนี้

                </p>

              ) : (

                <div className="repair-card-list">

                  
                  {orderUnits.map(unit => (
                    <div
                      className="repair-unit-card repair-order-unit-card"
                      key={unit.id}
                    >
                      {/* แถวบน: รหัสตู้ + จำนวนกล้อง + ปุ่มนำออก */}
                      <div className="repair-order-unit-head">
                        <div className="repair-order-unit-title">
                          <strong>{unit.unit_label}</strong>

                          <span className="repair-order-unit-count">
                            กล้องดับ {unit.down_camera_count} ตัว
                          </span>
                        </div>

                        {!isCentral && currentOrder?.status === 'draft' && (
                          <button
                            type="button"
                            className="repair-remove-button"
                            disabled={busy}
                            onClick={() => removeUnit(unit)}
                          >
                            <Trash2 size={15} />
                            นำออกจากใบงาน
                          </button>
                        )}
                      </div>

                      {/* แถวล่าง: รายชื่อกล้องแบบพับ/ขยาย */}
                      {Array.isArray(unit.camera_snapshot) &&
                        unit.camera_snapshot.length > 0 && (
                          <details
                            className="repair-camera-snapshot"
                            name="repair-unit-cameras"
                          >
                            <summary className="repair-camera-snapshot-toggle">
                              <span>
                                รายชื่อกล้องที่แจ้งซ่อม ({unit.camera_snapshot.length} ตัว)
                              </span>
                            </summary>

                            <div className="repair-camera-snapshot-content">
                              {unit.camera_snapshot.map((camera, index) => (
                                <div
                                  key={`${camera.ip || 'camera'}-${index}`}
                                  className="repair-camera-snapshot-item"
                                >
                                  <span>
                                    {index + 1}. {camera.name || 'ไม่ระบุชื่อกล้อง'}
                                  </span>

                                  <small>
                                    IP: {camera.ip || '-'}
                                  </small>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                    </div>
                  ))}


                </div>

              )}

            </>

          )}

        </section>

      </div>

      {printData && (

        <CctvRepairPrint

            order={printData.order}

            units={printData.units}

            onClose={() => setPrintData(null)}

        />

       )}

    </div>

  )

}