import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X, Copy, Share2, ImageDown } from 'lucide-react'
import './CctvRepairPrint.css'
import visionLogo from '../../assets/vision-logo.png'


import { supabase } from '../../lib/supabase'
import { formatMemberPhone } from '../../pages/Users'

const SHIFT_LABELS = {
  morning: 'กะเช้า',
  afternoon: 'กะบ่าย',
  night: 'กะดึก',
}

const STATUS_LABELS = {
  draft: 'ฉบับร่าง',
  submitted: 'ส่งแจ้งซ่อมแล้ว',
  accepted: 'รับงานแล้ว',
  in_progress: 'กำลังดำเนินการ',
  completed: 'ซ่อมเสร็จ',
  closed: 'ปิดงานแล้ว',
  cancelled: 'ยกเลิก',
}

const EQUIPMENT_NAMES = [
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
  'ใช้งานได้เอง',
]

/* =========================================
   DATE HELPERS
========================================= */

function formatDateBE(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})/
  )

  return match
    ? `${match[3]}/${match[2]}/${Number(match[1]) + 543}`
    : '-'
}

function formatCompletedAt(value) {
  if (!value) {
    return { date: '', time: '' }
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return { date: '', time: '' }
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(parsed)
      .map(part => [part.type, part.value])
  )

  return {
    date:
      `${parts.day}/${parts.month}/${Number(parts.year) + 543}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

/* =========================================
   EQUIPMENT HELPERS
========================================= */

function buildEquipmentRows(items) {
  
  const normalize = value => {
    const name = String(value || '').trim().toLowerCase()

    if (name === 'media convertor') return 'media converter'
    if (name === 'ใช้งานได้จริง') return 'ใช้งานได้เอง'

    return name
  }


  const names = [...EQUIPMENT_NAMES]

  items.forEach(item => {
    if (
      item?.name &&
      !names.some(
        name => normalize(name) === normalize(item.name)
      )
    ) {
      names.push(String(item.name))
    }
  })

  return names.map(name => {
    const saved = items.find(
      item => normalize(item?.name) === normalize(name)
    ) || {}

    return {
      name,
      failed:
        saved.failed_count ??
        saved.damaged_count ??
        saved.quantity ??
        '',
      reset: saved.reset_count ?? '',
      oldSn: saved.old_sn ?? '',
      newSn: saved.new_sn ?? '',
    }
  })
}

/* =========================================
   AUTOMATIC UNIT LAYOUT
========================================= */


function getUnitColumns(count) {
  if (count <= 4) return 1
  if (count <= 8) return 2
  if (count <= 12) return 3
  if (count <= 16) return 4
  if (count <= 20) return 5
  if (count <= 24) return 6

  return Math.min(10, Math.ceil(count / 4))
}


/* =========================================
   MAIN COMPONENT
========================================= */


export default function CctvRepairPrint({
  order: initialOrder,
  units = [],
  onClose,
}) {
  const [savedOrder, setSavedOrder] = useState(null)
  
  const paperRef = useRef(null)
  const [imageBusy, setImageBusy] = useState(false)

  const [loadingSavedOrder, setLoadingSavedOrder] = useState(false)
  const [savedOrderError, setSavedOrderError] = useState('')

  useEffect(() => {
    if (!initialOrder?.id || initialOrder.status !== 'closed') {
      setSavedOrder(null)
      setLoadingSavedOrder(false)
      setSavedOrderError('')
      return
    }

    let live = true

    setSavedOrder(null)
    setLoadingSavedOrder(true)
    setSavedOrderError('')

    const loadSaved = async () => {
      try {
        const { data, error } = await supabase
          .from('cctv_repair_orders')
          .select(`
            id, status,
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
          `)
          .eq('id', initialOrder.id)
          .single()

        if (!live) return

        if (error) throw error
        if (data?.status !== 'closed') {
          throw new Error('ใบงานนี้ยังไม่ได้ปิดงาน')
        }

        setSavedOrder(data)
      } catch (err) {
        if (live) {
          setSavedOrderError(err.message || 'โหลดผลซ่อมไม่สำเร็จ')
        }
      } finally {
        if (live) setLoadingSavedOrder(false)
      }
    }

    loadSaved()

    return () => {
      live = false
    }
  }, [initialOrder?.id, initialOrder?.status])

  const order =
    savedOrder &&
    String(savedOrder.id) === String(initialOrder?.id)
      ? { ...initialOrder, ...savedOrder }
      : initialOrder

  if (!order) return null

  const isClosed = order.status === 'closed'


  const safeUnits = Array.isArray(units) ? units : []

  const unitCount = safeUnits.length

  // แสดง IP เมื่อมีไม่เกิน 4 ตู้
  const wideUnits = unitCount <= 4

  // จำนวนคอลัมน์ที่ใช้จริง
    const unitColumns = getUnitColumns(unitCount)

    // จำนวนแถวที่ต้องใช้ในกรอบหัวข้อ 2
    const unitRows = Math.max(
    1,
    Math.ceil(unitCount / unitColumns)
    )

    const equipment = Array.isArray(order.equipment_items)
    ? order.equipment_items
    : []

  const equipmentRows = buildEquipmentRows(equipment)

  const totalDown = safeUnits.reduce(
    (sum, unit) =>
      sum + Number(unit.down_camera_count || 0),
    0
  )

  // พิกัดกล้องแรกของตู้แรกในใบแจ้งซ่อม
    const firstUnit = safeUnits[0]

    const firstCameraCoordinates =
    firstUnit?.latitude != null &&
    firstUnit?.longitude != null
        ? `${firstUnit.latitude}, ${firstUnit.longitude}`
        : '-'

  const reporterName = [
    order.reporter_rank,
    order.reporter_name,
  ]
    .filter(Boolean)
    .join(' ') || '-'

  const completed = formatCompletedAt(
    order.repair_completed_at
  )

  // วันเวลารายงานใช้เวลาจาก Supabase เมื่อกดส่งให้ ศชต. เท่านั้น
  // ในฉบับร่างไม่แสดงวันที่หรือเวลาที่รายงาน
  const submitted = formatCompletedAt(order.submitted_at)

  const technicianTeam =
    order.team_code === 'takbai'
      ? 'ช่างตากใบ'
      : order.team_code === 'pattani'
        ? 'ช่างปัตตานี'
        : 'ช่างผู้ดำเนินการ'

  /* =========================================
     EXPORT ONE-PAGE PDF
  ========================================= */

  
  const exportOnePagePdf = () => {
    window.print()
  }

  
/* CCTV_REPAIR_IMAGE_SHARE_V1 */


/* CCTV_REPAIR_IMAGE_SHARE_V1 */

const createRepairImage = async () => {
  if (!paperRef.current) {
    throw new Error('ไม่พบเอกสารใบแจ้งซ่อม')
  }

  const { default: html2canvas } = await import('html2canvas')

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  await Promise.all(
    [...paperRef.current.querySelectorAll('img')].map(
      img => img.decode?.().catch(() => {})
    )
  )

  const canvas = await html2canvas(paperRef.current, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  })

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('สร้างภาพใบงานไม่สำเร็จ'))
    }, 'image/png')
  })
}

/* บันทึกใบแจ้งซ่อมเป็น PNG */

const saveRepairImagePng = async () => {
  if (imageBusy) return

  setImageBusy(true)

  try {
    const blob = await createRepairImage()

    const ticket = String(order.ticket_no || 'CCTV')
      .replace(/[^a-zA-Z0-9_-]/g, '_')

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = `CCTV-Repair-${ticket}.png`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1500)

    window.alert('เริ่มบันทึกรูป PNG แล้ว')
  } catch (error) {
    window.alert(`บันทึกรูปไม่สำเร็จ: ${error.message}`)
  } finally {
    setImageBusy(false)
  }
}


const copyRepairImage = async () => {
  if (imageBusy) return

  if (!navigator.clipboard?.write ||
      typeof ClipboardItem === 'undefined') {
    window.alert('เบราว์เซอร์นี้ไม่รองรับการคัดลอกรูป')
    return
  }

  setImageBusy(true)

  try {
    const pngPromise = createRepairImage()

    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngPromise,
      }),
    ])

    window.alert(
      'คัดลอกรูปใบงานสำเร็จ เปิด LINE แล้วกด Ctrl+V ได้เลย'
    )
  } catch (error) {
    window.alert(`คัดลอกไม่สำเร็จ: ${error.message}`)
  } finally {
    setImageBusy(false)
  }
}

const shareRepairImage = async () => {
  if (imageBusy) return

  if (typeof navigator.share !== 'function') {
    window.alert(
      'เบราว์เซอร์นี้ไม่รองรับการแชร์ไฟล์โดยตรง กรุณาใช้ปุ่มคัดลอกรูปแทน'
    )
    return
  }

  setImageBusy(true)

  try {
    const blob = await createRepairImage()

    const ticket = String(order.ticket_no || 'CCTV')
      .replace(/[^a-zA-Z0-9_-]/g, '_')

    const file = new File(
      [blob],
      `CCTV-Repair-${ticket}.png`,
      { type: 'image/png' }
    )

    if (navigator.canShare &&
        !navigator.canShare({ files: [file] })) {
      throw new Error('อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์ภาพ')
    }

    await navigator.share({
      files: [file],
      title: `ใบแจ้งซ่อม CCTV ${order.ticket_no || ''}`,
    })
  } catch (error) {
    if (error.name !== 'AbortError') {
      window.alert(
        `แชร์รูปไม่สำเร็จ: ${error.message}\nกรุณาใช้ปุ่มคัดลอกรูปแทน`
      )
    }
  } finally {
    setImageBusy(false)
  }
}



  return createPortal(
    <div
      className="rp-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="พรีวิวใบแจ้งซ่อม CCTV"
    >
      {/* =====================================
          TOOLBAR
      ===================================== */}

      <div className="rp-toolbar">
        <div className="rp-toolbar-copy">
          <strong>พรีวิวใบแจ้งซ่อม A4</strong>

          <small>
            {savedOrderError
              ? `โหลดผลซ่อมไม่สำเร็จ: ${savedOrderError}`
              : loadingSavedOrder
                ? 'กำลังโหลดผลซ่อมล่าสุด...'
                : 'ข้อมูลจากใบงานที่บันทึกไว้ใน Supabase'}
          </small>
        </div>

        <div className="rp-toolbar-actions">

        
        <button
          type="button"
          className="rp-copy-image-button"
          onClick={copyRepairImage}
          disabled={
            imageBusy ||
            loadingSavedOrder ||
            (isClosed && (!savedOrder || !!savedOrderError))
          }
        >
          <Copy size={17} />
          {imageBusy ? 'กำลังสร้างรูป...' : 'คัดลอกรูปใบงาน'}
        </button>

        <button
          type="button"
          className="rp-share-image-button"
          onClick={shareRepairImage}
          disabled={
            imageBusy ||
            loadingSavedOrder ||
            (isClosed && (!savedOrder || !!savedOrderError))
          }
        >
          <Share2 size={17} />
          แชร์รูป (เลือก LINE)
        </button>

        <button
          type="button"
          className="rp-save-image-button"
          onClick={saveRepairImagePng}
          disabled={
            imageBusy ||
            loadingSavedOrder ||
            (isClosed && (!savedOrder || !!savedOrderError))
          }
        >
          <ImageDown size={17} />
          บันทึกรูป PNG
        </button>
          
          
        <button
          type="button"
          className="rp-print-button"
          onClick={exportOnePagePdf}
          disabled={loadingSavedOrder || (isClosed && (!savedOrder || !!savedOrderError))}
        >
          <Printer size={17} />
          พิมพ์ / บันทึก PDF คมชัด
        </button>


          <button
            type="button"
            onClick={onClose}
          >
            <X size={17} />
            ปิด
          </button>
        </div>
      </div>

      {/* =====================================
          A4 PAPER
      ===================================== */}

      <div className="rp-scroll">
        <article ref={paperRef} className="rp-paper">

          {/* =====================================
              DOCUMENT HEADER
          ===================================== */}

          <header className="rp-doc-header">
            <div className="rp-doc-brand">
              <img
                className="rp-doc-logo"
                src={visionLogo}
                alt="VISION AND SECURITY SYSTEM"
                />

              <div className="rp-doc-title">
                <h1>
                  ใบแจ้งซ่อมระบบกล้องโทรทัศน์วงจรปิด
                </h1>

                <p>โครงการติดตั้งระบบป้องกันความปลอดภัยในเขตเมือง ระยะที่ 2 
                <br /> ด้วยระบบกล้องโทรทัศน์ วงจรปิด ( CCTV ) ในพื้นที่ 6 อำเภอ</p>

                
              </div>
            </div>

            <div className="rp-doc-meta">
              <div>
                <b>เลขที่ใบงาน</b>

                <span>
                  {order.ticket_no ||
                    `ฉบับร่าง #${order.id}`}
                </span>
              </div>

              <div>
                <b>ศูนย์ผู้แจ้ง</b>

                <span>
                  {order.center_name_snapshot || '-'}
                </span>
              </div>

              {order.status !== 'draft' && (
                <>
                  <div>
                    <b>วันที่รายงาน</b>
                    <span>{submitted.date || '-'}</span>
                  </div>

                  <div>
                    <b>เวลาที่รายงาน</b>
                    <span>
                      {submitted.time ? `${submitted.time} น.` : '-'}
                    </span>
                  </div>
                </>
              )}
            </div>
          </header>

          {/* =====================================
              SECTION 1
              REPORTER INFORMATION
          ===================================== */}

          <h2
            className="rp-section-title"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
            }}
            >
            <span>1. ข้อมูลการแจ้งซ่อม</span>

            <span
                style={{
                fontSize: '9px',
                fontWeight: 600,
                color: '#64748b',
                whiteSpace: 'nowrap',
                }}
            >
                {SHIFT_LABELS[order.shift] || '-'}
                {' · '}
                สถานะ: {STATUS_LABELS[order.status] || order.status || '-'}
            </span>
            </h2>

          <div className="rp-info-grid">
            <div>
              <b>ผู้แจ้งซ่อม</b>
              <span>{reporterName}</span>
            </div>

            <div>
              <b>เบอร์โทรศัพท์</b>

              <span>
                {formatMemberPhone(order.reporter_phone)
                  || order.reporter_phone || '-'}
              </span>
            </div>

            <div>
              <b>วันที่กล้องดับ</b>

              <span>
                {formatDateBE(order.outage_date)}
              </span>
            </div>

            <div>
              <b>เวลาที่กล้องดับ</b>

              <span>
                {order.outage_time
                  ? `${String(order.outage_time).slice(0, 5)} น.`
                  : '-'}
              </span>
            </div>
          </div>

          {/* =====================================
              SECTION 2
              FIXED UNIT COLLECTION

              1-4 = FULL WIDTH + IP
              5+  = COMPACT GRID, NO IP
          ===================================== */}

          <h2 className="rp-section-title">
            2. รายการกล้องวงจรปิดที่ขัดข้อง
          </h2>

          <div
            className="rp-summary"
            style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                columnGap: '8mm',
                rowGap: '1mm',
            }}
            >
            <span>
                จำนวน {unitCount} ตู้/ด่าน
                {' · '}
                กล้องขัดข้องรวม {totalDown} ตัว
            </span>

            {unitCount > 0 && (
                <span>
                พิกัดกล้องตู้แรก : {firstCameraCoordinates}
                </span>
            )}
            </div>

          <div
            className={[
            'rp-unit-collection',
            wideUnits
                ? 'rp-units-wide'
                : 'rp-units-compact',
            unitColumns >= 4 ? 'rp-units-tight' : '',
            ].filter(Boolean).join(' ')}
            style={{
            '--rp-unit-columns': unitColumns,
            '--rp-unit-rows': unitRows,
            '--rp-unit-height': '52mm',
            }}
          >
            {unitCount === 0 ? (
              <div className="rp-units-empty">
                ยังไม่มีรายการตู้หรือด่านในใบแจ้งซ่อม
              </div>
            ) : (
              safeUnits.map((unit, unitIndex) => {
                // IP จาก Snapshot ที่บันทึกไว้กับใบงาน
                const offlineIps = [
                  ...new Set(
                    (
                      Array.isArray(unit.camera_snapshot)
                        ? unit.camera_snapshot
                        : []
                    )
                      .map(camera =>
                        String(camera?.ip || '').trim()
                      )
                      .filter(Boolean)
                  ),
                ]

                return (
                  <div
                    className="rp-mini-unit"
                    key={
                      unit.id ??
                      `${unit.network_type}-${unit.unit_label}-${unitIndex}`
                    }
                  >
                    {/* ชื่อ / พิกัด / สถานะ / จำนวนดับ */}

                    <div className="rp-mini-unit-top">
                      <div className="rp-mini-unit-left">
                        
                        <strong
                          style={
                            String(unit.unit_label || '').length >
                            (unitColumns >= 7 ? 12 : 22)
                              ? {
                                  fontSize:
                                    String(unit.unit_label || '').length > 26
                                      ? '6.5px'
                                      : '7.5px',
                                  lineHeight: 1.05,
                                  overflowWrap: 'anywhere',
                                }
                              : undefined
                          }
                        >
                          {unitIndex + 1}.{' '}
                          {unit.unit_label || '-'}
                        </strong>


                        {unitColumns < 7 && (
                        <span className="rp-mini-unit-coordinate">
                            พิกัด: {unit.latitude ?? '-'},
                            {' '}
                            {unit.longitude ?? '-'}
                        </span>
                        )}
                      </div>

                      <div className="rp-mini-unit-right">
                        {unitColumns < 6 && (
                            <span className="rp-mini-unit-condition">
                                {unit.network_type === 'checkpoint'
                                ? 'กล้องด่าน'
                                : 'กล้องทั่วไป'}

                                {' · '}

                                {unit.full_outage
                                ? 'ดับทั้งตู้'
                                : 'ดับบางกล้อง'}
                            </span>
                            )}

                        <span className="rp-mini-unit-down">
                            ดับ {unit.down_camera_count ?? 0} ตัว
                        </span>
                      </div>
                    </div>

                    {/* IP เฉพาะ 1-4 ตู้ */}

                    {wideUnits && (
                      <div className="rp-mini-unit-ips">
                        <b>IP :</b>{' '}

                        {offlineIps.length > 0
                          ? offlineIps.join(', ')
                          : '-'}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* =====================================
              SECTION 3
              REPAIR RESULT
          ===================================== */}

          <h2 className="rp-section-title">
            3. ผลการดำเนินการของเจ้าหน้าที่
          </h2>

          <table className="rp-result-table">
            <tbody>
              {/* ปัญหาที่พบ */}

              <tr>
                <td>
                  <strong>ปัญหาที่พบ :</strong>
                  {' '}
                  {isClosed
                    ? (order.repair_problem_found || order.repair_cause || '-')
                    : (order.repair_cause || '')}
                </td>
              </tr>

              {/* วิธีการแก้ไข */}

              <tr>
                <td>
                  <strong>วิธีการแก้ไข :</strong>
                  {' '}
                  {isClosed
                    ? (order.repair_fix_method || order.repair_result || '-')
                    : (order.repair_result || '')}
                </td>
              </tr>

              {/* จำนวนกล้อง เว้นว่างให้กรอกเอง */}

              <tr>
                <td>
                  
                  <div className="rp-result-numbers">
                    <div>
                      <strong>จำนวนกล้องดับ :</strong>{' '}
                      {isClosed ? (order.repair_down_count ?? '-') : ''}
                    </div>

                    <div>
                      <strong>ใช้งานได้ :</strong>{' '}
                      {isClosed ? (order.repair_usable_count ?? '-') : ''}
                    </div>

                    <div>
                      <strong>ใช้งานไม่ได้ :</strong>{' '}
                      {isClosed ? (order.repair_unusable_count ?? '-') : ''}
                    </div>

                    <div>
                      <strong>เนื่องจาก :</strong>{' '}
                      {isClosed ? (order.repair_unusable_reason || '') : ''}
                    </div>
                  </div>

                </td>
              </tr>

              {/* วันที่และเวลา */}

              <tr>
                <td>
                  <div className="rp-result-date">
                    <div>
                      <strong>
                        วันที่ดำเนินการเสร็จ :
                      </strong>
                      {' '}
                      {completed.date}
                    </div>

                    <div>
                      <strong>เวลา :</strong>
                      {' '}
                      {completed.time}
                    </div>
                  </div>
                </td>
              </tr>

              {/* SLA */}

              <tr>
                <td>
                  
                  <div className="rp-result-sla">
                    <div className="rp-sla-options">
                      <strong>SLA :</strong>

                      <span>
                        <i
                          className="rp-checkbox"
                          style={{
                            fontStyle: 'normal',
                            textAlign: 'center',
                            lineHeight: '3mm',
                          }}
                        >
                          {isClosed && order.repair_sla_exceeded === false ? '✓' : ''}
                        </i>
                        ไม่เกิน
                      </span>

                      <span>
                        <i
                          className="rp-checkbox"
                          style={{
                            fontStyle: 'normal',
                            textAlign: 'center',
                            lineHeight: '3mm',
                          }}
                        >
                          {isClosed && order.repair_sla_exceeded === true ? '✓' : ''}
                        </i>
                        เกิน
                      </span>
                    </div>

                    <div>
                      <strong>เนื่องจาก :</strong>{' '}
                      {isClosed ? (order.repair_sla_reason || '') : ''}
                    </div>
                  </div>

                </td>
              </tr>
            </tbody>
          </table>

          {/* =====================================
              SECTION 4
              EQUIPMENT TABLE
          ===================================== */}

          <h2 className="rp-section-title">
            4. สาเหตุ/อุปกรณ์เสีย (จำนวน)
          </h2>

          <table className="rp-equipment-table">
            <colgroup>
              <col style={{ width: '25%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
            </colgroup>

            <thead>
              <tr>
                <th>อุปกรณ์</th>
                <th>เสีย</th>
                <th>ค้าง/Reset</th>
                <th>S/N เสีย</th>
                <th>S/N ใหม่</th>
              </tr>
            </thead>

            <tbody>
              {equipmentRows.map(row => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.failed}</td>
                  <td>{row.reset}</td>
                  <td>{row.oldSn}</td>
                  <td>{row.newSn}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* =====================================
              TECHNICIAN
          ===================================== */}

          
            
          <div className="rp-tech-inline">
            <div className="rp-tech-name">
              <span>ผู้ปฏิบัติงาน:</span>
              {isClosed
                ? <b>{order.technician_names || '-'}</b>
                : <i />}
            </div>

            <div className="rp-tech-phone">
              <span>โทร:</span>
              {isClosed
                ? (
                  <b>
                    {formatMemberPhone(order.technician_phone)
                      || order.technician_phone || '-'}
                  </b>
                )
                : <i />}
            </div>

            <strong className="rp-tech-team">
              {technicianTeam}
            </strong>
          </div>



        </article>
      </div>
    </div>,
    document.body
  )
}