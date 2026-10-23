import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import './CctvRepairPrint.css'
import visionLogo from '../../assets/vision-logo.png'

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
  'Media Convertor',
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
  const normalize = value =>
    String(value || '').trim().toLowerCase()

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
  return 7
}

/* =========================================
   MAIN COMPONENT
========================================= */

export default function CctvRepairPrint({
  order,
  units = [],
  onClose,
}) {
  const paperRef = useRef(null)

  const [exportingPdf, setExportingPdf] = useState(false)

  if (!order) return null

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

  const technicianTeam =
    order.team_code === 'takbai'
      ? 'ช่างตากใบ'
      : order.team_code === 'pattani'
        ? 'ช่างปัตตานี'
        : 'ช่างผู้ดำเนินการ'

  /* =========================================
     EXPORT ONE-PAGE PDF
  ========================================= */

  const exportOnePagePdf = async () => {
    if (!paperRef.current || exportingPdf) return

    setExportingPdf(true)

    try {
      const [canvasModule, pdfModule] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])

      const canvas = await canvasModule.default(
        paperRef.current,
        {
          scale: 2.5,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        }
      )

      const PDF = pdfModule.jsPDF

      const pdf = new PDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      })

      const width = 210
      const height = 297

      // รักษาสัดส่วนเอกสาร และย่อให้พอดี A4
      const scale = Math.min(
        width / canvas.width,
        height / canvas.height
      )

      const imageWidth = canvas.width * scale
      const imageHeight = canvas.height * scale

      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        (width - imageWidth) / 2,
        (height - imageHeight) / 2,
        imageWidth,
        imageHeight
      )

      const ticket = String(
        order.ticket_no || `draft-${order.id}`
      ).replace(/[^\w-]/g, '_')

      pdf.save(`CCTV_Repair_${ticket}.pdf`)

    } catch (error) {
      console.error('Export repair PDF failed:', error)

      window.alert(
        'ไม่สามารถสร้าง PDF ได้ กรุณาลองอีกครั้ง'
      )

    } finally {
      setExportingPdf(false)
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
            ข้อมูลจากใบงานที่บันทึกไว้ใน Supabase
          </small>
        </div>

        <div className="rp-toolbar-actions">
          <button
            type="button"
            className="rp-print-button"
            onClick={exportOnePagePdf}
            disabled={exportingPdf}
          >
            <Printer size={17} />

            {exportingPdf
              ? 'กำลังสร้าง PDF...'
              : 'บันทึก PDF A4 (1 หน้า)'}
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
        <article
          ref={paperRef}
          className="rp-paper"
        >
          {order.status === 'draft' && (
            <div
              className="rp-watermark"
              aria-hidden="true"
            >
              ฉบับร่าง
            </div>
          )}

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

              <div>
                <b>วันที่รายงาน</b>

                <span>
                  {formatDateBE(order.report_date)}
                </span>
              </div>

              <div>
                <b>กะปฏิบัติงาน</b>

                <span>
                  {SHIFT_LABELS[order.shift] || '-'}
                </span>
              </div>
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
                {order.reporter_phone || '-'}
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
            '--rp-unit-height':
                unitCount > 24 ? 'auto' : '52mm',
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
                        <strong>
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
                  {order.repair_cause || ''}
                </td>
              </tr>

              {/* วิธีการแก้ไข */}

              <tr>
                <td>
                  <strong>วิธีการแก้ไข :</strong>
                  {' '}
                  {order.repair_result || ''}
                </td>
              </tr>

              {/* จำนวนกล้อง เว้นว่างให้กรอกเอง */}

              <tr>
                <td>
                  <div className="rp-result-numbers">
                    <div>
                      <strong>จำนวนกล้องดับ :</strong>
                    </div>

                    <div>
                      <strong>ใช้งานได้ :</strong>
                    </div>

                    <div>
                      <strong>ใช้งานไม่ได้ :</strong>
                    </div>

                    <div>
                      <strong>เนื่องจาก :</strong>
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
                        <i className="rp-checkbox" />
                        ไม่เกิน
                      </span>

                      <span>
                        <i className="rp-checkbox" />
                        เกิน
                      </span>
                    </div>

                    <div>
                      <strong>เนื่องจาก :</strong>
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
            <span className="rp-tech-name">
              ชื่อผู้ปฏิบัติงาน <i />
            </span>

            <span className="rp-tech-phone">
              เบอร์โทร <i />
            </span>

            <strong>
              {technicianTeam}
            </strong>
          </div>

        </article>
      </div>
    </div>,
    document.body
  )
}