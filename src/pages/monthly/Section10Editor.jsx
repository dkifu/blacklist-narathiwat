import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import './Section10Editor.css'

const PAPER_W = 1120
const PAPER_H = 792
const SECTION_NO = 10
const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const MONTH_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
// คอลัมน์เหมือน Excel ตัวอย่าง (12 ช่อง) และตารางพรีวิวหน้าแรกทุกช่อง
const FIELD_CONFIG = [
  { key: 'date',         label: 'วันที่แจ้งเตือน',          width: 18 },
  { key: 'time',         label: 'เวลา',                    width: 15 },
  { key: 'location',     label: 'สถานที่',                 width: 26 },
  { key: 'district',     label: 'อำเภอ',                   width: 20 },
  { key: 'plate',        label: 'ป้ายทะเบียน',             width: 20 },
  { key: 'vehicleType',  label: 'ประเภทรถ',               width: 23 },
  { key: 'result',       label: 'ผลการตรวจสอบ',           width: 29 },
  { key: 'behavior',     label: 'พฤติกรรม',               width: 35 },
  { key: 'severityCode', label: 'รหัสความรุนแรง',         width: 19 },
  { key: 'officerDate',  label: 'วันที่แจ้งเจ้าหน้าที่',     width: 22 },
  { key: 'officerTime',  label: 'เวลาที่แจ้งเจ้าหน้าที่',     width: 21 },
  { key: 'responsePlan', label: 'แผนเผชิญเหตุ',            width: 38 },
]
const HEADERS = FIELD_CONFIG.map(field => field.label)
const FIELDS = FIELD_CONFIG.map(field => field.key)
// จัดลำดับรหัสความรุนแรงแบบ A01 ก่อน B01 เสมอ
const severityOrder = value => {
  const code = safe(value).toUpperCase()
  if (/^A01(?:\b|$)/.test(code)) return 0
  if (/^B01(?:\b|$)/.test(code)) return 1
  return 2
}

// จำนวนรถต่อหน้าสรุป สูงสุด 10 คัน
const PER_PAGE = {
  4: 4,
  6: 6,
  8: 8,
  10: 10,
}

const emptyVehicle = () => ({
  id: crypto.randomUUID(),
  ...Object.fromEntries(FIELDS.map(key => [key, ''])),
  photos: [],
})
const safe = v => String(v ?? '').trim()

    // จัดรูปแบบทะเบียนรถให้เป็นมาตรฐานเดียวกัน
    // ตัวอย่าง: บฉ9643นราธิวาส -> บฉ 9643 นราธิวาส
    function normalizePlate(value) {
    const text = safe(value)
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[‐‑‒–—−]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()

    if (!text) return ''

    const compact = text.replace(/[\s-]/g, '')

    const matched = compact.match(
        /^([0-9]?[ก-ฮ]{1,3})([0-9]{1,4})([ก-๙]+)?$/u
    )

    if (!matched) return text

    return [
        matched[1],
        matched[2],
        matched[3],
    ]
        .filter(Boolean)
        .join(' ')
}

const formatNum = n => Number(n || 0).toLocaleString('th-TH')
const reportKey = r => Number(r.report_year) * 12 + Number(r.report_month)
const hasPhotos = content => Array.isArray(content?.vehicles) &&
  content.vehicles.some(v => Array.isArray(v.photos) && v.photos.some(Boolean))
const normalizeVehicle = v => ({
  ...emptyVehicle(),
  ...v,

  plate: normalizePlate(v?.plate),

  // อ่านข้อมูลเดิมที่เคยบันทึกก่อนเปลี่ยนเทมเพลตได้ โดยไม่ลบข้อมูลเก่า
  location: safe(v?.location ?? v?.checkpoint),
  vehicleType: safe(v?.vehicleType ?? [v?.brand, v?.model].filter(Boolean).join(' / ')),
  responsePlan: safe(v?.responsePlan ?? v?.action),
  id: v?.id || crypto.randomUUID(),
  
  photos: Array.isArray(v?.photos)
    ? v.photos.filter(Boolean).slice(0, 1)
    : [],

})

// รองรับ DD/MM/พ.ศ., DD/MM/ค.ศ., ISO และวันที่จาก Excel


/**
 * แปลงวันที่ พ.ศ. / ค.ศ. เป็น พ.ศ.
 * รองรับ:
 * - 04/09/2569
 * - 04/09/2026
 * - 2026-09-04
 * - วันที่จาก Excel
 * - JavaScript Date
 */
function dateBE(value) {
  if (value == null || value === '') {
    return ''
  }

  const pad = n => String(n).padStart(2, '0')

  // ตรวจสอบและจัดรูปแบบวันที่
  const formatParts = (day, month, year) => {
    const d = Number(day)
    const m = Number(month)
    const y = Number(year)

    if (![d, m, y].every(Number.isInteger)) {
      return ''
    }

    let buddhistYear

    if (y >= 2400 && y <= 2899) {
      // เป็น พ.ศ. อยู่แล้ว
      buddhistYear = y
    } else if (y >= 1900 && y <= 2399) {
      // เป็น ค.ศ. ให้แปลงเป็น พ.ศ.
      buddhistYear = y + 543
    } else {
      return ''
    }

    // ตรวจสอบว่าวันที่มีอยู่จริง
    const christianYear = buddhistYear - 543

    const check = new Date(
      Date.UTC(christianYear, m - 1, d)
    )

    if (
      check.getUTCFullYear() !== christianYear ||
      check.getUTCMonth() + 1 !== m ||
      check.getUTCDate() !== d
    ) {
      return ''
    }

    return `${pad(d)}/${pad(m)}/${buddhistYear}`
  }

  // กรณี JavaScript Date
  // ใช้ UTC ป้องกันวันที่ถอยหลังจาก Timezone
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return ''
    }

    return formatParts(
      value.getUTCDate(),
      value.getUTCMonth() + 1,
      value.getUTCFullYear()
    )
  }

  // กรณี Excel Serial Date
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    const parsed = XLSX.SSF.parse_date_code(value)

    if (!parsed) {
      return String(value)
    }

    return formatParts(
      parsed.d,
      parsed.m,
      parsed.y
    ) || String(value)
  }

  // รองรับตัวเลขไทยด้วย
  const text = safe(value).replace(
    /[๐-๙]/g,
    digit => String(
      digit.charCodeAt(0) - 0x0E50
    )
  )

  // รูปแบบ YYYY-MM-DD
  const iso = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/
  )

  if (iso) {
    return formatParts(
      iso[3],
      iso[2],
      iso[1]
    ) || text
  }

  // รูปแบบ DD/MM/YYYY
  const matched = text.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s|$)/
  )

  if (matched) {
    return formatParts(
      matched[1],
      matched[2],
      matched[3]
    ) || text
  }

  return text
}



function formattedTime(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')} น.`
  }
  const text = safe(value)
  if (!text) return ''
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minute = Math.round(value * 1440) % 1440
    return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')} น.`
  }
  const match = text.match(/^(\d{1,2})[.:](\d{2})(?::\d{2})?/)
  return match ? `${match[1].padStart(2,'0')}:${match[2]} น.` : text
}
async function compressImage(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('รูปต้องเป็น JPG, PNG หรือ WEBP')
  if (file.size > 15 * 1024 * 1024) throw new Error('ไฟล์ภาพต้องไม่เกิน 15 MB')
  const bitmap = await createImageBitmap(file)
  try {
    const rate = Math.min(1, 1000 / bitmap.width, 650 / bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * rate))
    canvas.height = Math.max(1, Math.round(bitmap.height * rate))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const output = canvas.toDataURL('image/jpeg', 0.68)
    canvas.width = 0; canvas.height = 0
    return output
  } finally { bitmap.close() }
}
async function fetchYearSections(centerId, year) {
  const {data: reports, error} = await supabase.from('monthly_reports')
    .select('id,report_year,report_month').eq('center_id', centerId).eq('report_year', year)
  if (error) throw error
  if (!reports?.length) return []
  const {data: rows, error: sectionError} = await supabase.from('monthly_report_sections')
    .select('report_id,content').eq('section_no', SECTION_NO).in('report_id', reports.map(r => r.id))
  if (sectionError) throw sectionError
  const byId = new Map(reports.map(r => [String(r.id),r]))
  return (rows || []).map(s => ({...byId.get(String(s.report_id)), content:s.content})).filter(r => r.id)
}
async function fetchImageMonths(centerId) {
  const {data: reports, error} = await supabase.from('monthly_reports')
    .select('id,report_year,report_month').eq('center_id',centerId)
  if (error) throw error
  if (!reports?.length) return []
  const {data: rows, error: sectionError} = await supabase.from('monthly_report_sections')
    .select('report_id,content').eq('section_no',SECTION_NO).in('report_id',reports.map(r=>r.id))
  if (sectionError) throw sectionError
  const byId = new Map(reports.map(r => [String(r.id),r]))
  return (rows || []).filter(row => hasPhotos(row.content)).map(row => ({
    ...byId.get(String(row.report_id)), content:row.content,
  })).filter(row => row.id).sort((a,b) => reportKey(b)-reportKey(a))
}
// ลบเฉพาะภาพจากเดือนที่เกินสองเดือน; ข้อความและแถวเคสต้องยังอยู่
async function pruneOldImageMonths(centerId) {
  const months = await fetchImageMonths(centerId)
  for (const old of months.slice(2)) {
    const trimmed = {
      ...old.content,
      vehicles: (old.content.vehicles || []).map(v => ({...v,photos:[]})),
    }
    const {error} = await supabase.from('monthly_report_sections')
      .update({content:trimmed}).eq('report_id',old.id).eq('section_no',SECTION_NO)
    if (error) throw error
  }
}

function Heading({center,month,year,sub}) {
  return <header className="s10-heading">
    <h2>{sub ? 'รายละเอียดการแจ้งเตือนรถบัญชีดำ' : 'สรุปการแจ้งเตือนรถบัญชีดำ'}</h2>
    <p>{center?.name || 'ศูนย์กล้องวงจรปิด'} · ประจำเดือน {MONTHS[month-1]} {year}</p>
  </header>
}

// ตารางหน้าแรกใช้คอลัมน์เดียวกับเทมเพลต Excel ครบทั้ง 12 ช่อง
function SummaryPage({
  center,
  month,
  year,
  rows,
  part,
  totalParts,
  monthCount,
  a01Count,
  b01Count,
  tableSize,
}) {

    // ใช้ขนาดปกติทุกหน้า
    // หน้าที่มีไม่เกิน 4 แถวใช้ขนาดใหญ่ขึ้นเล็กน้อย
    const density =
    rows.length <= 4
        ? 'roomy'
        : 'regular'

  // รวมวันที่และเวลา เหลือ 10 คอลัมน์
  const columns = [
    { key: 'dateTime', label: 'วันที่ / เวลาแจ้งเตือน', width: 92 },
    { key: 'location', label: 'สถานที่', width: 146 },
    { key: 'district', label: 'อำเภอ', width: 74 },
    { key: 'plate', label: 'ป้ายทะเบียน', width: 74 },
    { key: 'vehicleType', label: 'ประเภทรถ', width: 84 },
    { key: 'result', label: 'ผลการตรวจสอบ', width: 64 },
    { key: 'behavior', label: 'พฤติกรรม', width: 166 },
    { key: 'severityCode', label: 'รหัสความรุนแรง', width: 63 },
    { key: 'officerDateTime', label: 'วันที่ / เวลาแจ้งเจ้าหน้าที่', width: 92 },
    { key: 'responsePlan', label: 'แผนเผชิญเหตุ', width: 193 },
    ]

  const renderDateTime = (date, time) => {
    const dateText = dateBE(date)
    const timeText = formattedTime(time)

    if (!dateText && !timeText) return '—'

    return (
      <div className="s10-datetime-cell">
        <span>{dateText || '—'}</span>
        {timeText && <small>{timeText}</small>}
      </div>
    )
  }

  return (
    <div className={`s10-paper s10-summary s10-summary--${density}`}>
      <Heading center={center} month={month} year={year} />

      <div className="s10-metrics">
        <div className="blue">
            <span>แจ้งเตือนเดือนนี้</span>
            <strong>{formatNum(monthCount)}</strong>
            <small>รายการ</small>
        </div>

        <div className="red">
            <span>จำนวน A01</span>
            <strong>{formatNum(a01Count)}</strong>
            <small>รายการ</small>
        </div>

        <div className="green">
            <span>จำนวน B01</span>
            <strong>{formatNum(b01Count)}</strong>
            <small>รายการ</small>
        </div>
        </div>

      <div className="s10-report-table">
        <div className="s10-card-title">
          <strong>ตารางสรุปการแจ้งเตือนรถบัญชีดำ</strong>
          <span>
            หน้า {part}/{totalParts} · {rows.length} คัน
          </span>
        </div>

        <table className="s10-data-table">
          <colgroup>
                {columns.map(col => (
                    <col
                    key={col.key}
                    style={{ width: `${col.width}px` }}
                    />
                ))}
            </colgroup>

          <thead>
            <tr>
              {columns.map(col => (
                <th scope="col" key={col.key}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length > 0 ? (
              rows.map(item => (
                <tr key={item.id}>
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={`s10-cell-${col.key}`}
                    >
                      {col.key === 'dateTime'
                        ? renderDateTime(item.date, item.time)
                        : col.key === 'officerDateTime'
                          ? renderDateTime(
                              item.officerDate,
                              item.officerTime
                            )
                          : item[col.key] || '—'}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="s10-empty-row"
                >
                  ยังไม่มีรายการรถในเดือนนี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      
    </div>
  )
}

function VehiclePage({center,month,year,item,index,total}) {
  return <div className="s10-paper s10-vehicle-page">
    <Heading center={center} month={month} year={year} sub/>
    <div className="s10-vehicle-hero">
      <div>
        <span>รถเป้าหมายคันที่ {String(index+1).padStart(2,'0')}</span>
        <h3>{item.plate || 'ไม่ระบุป้ายทะเบียน'}</h3>
        <p>{[item.vehicleType,item.location].filter(Boolean).join(' · ') || 'ข้อมูลการแจ้งเตือนรถบัญชีดำ'}</p>
      </div>
      <div className="s10-vehicle-chip">{item.severityCode || 'แจ้งเตือน'}</div>
    </div>
    <div className="s10-detail-grid">
      <div className="s10-detail-panel">
        <div className="s10-card-title"><strong>ข้อมูลรถและการดำเนินการ</strong><span>{index+1}/{total}</span></div>
        
        
            <div className="s10-detail-fields">
            {[
                ...FIELD_CONFIG.filter(
                field =>
                    field.key !== 'behavior' &&
                    field.key !== 'responsePlan'
                ),

                ...FIELD_CONFIG.filter(
                field =>
                    field.key === 'behavior' ||
                    field.key === 'responsePlan'
                ),
            ].map(field => {
                const isWide =
                field.key === 'behavior' ||
                field.key === 'responsePlan'

                const value =
                field.key === 'date' ||
                field.key === 'officerDate'
                    ? dateBE(item[field.key])
                    : field.key === 'time' ||
                        field.key === 'officerTime'
                    ? formattedTime(item[field.key])
                    : item[field.key]

                return (
                <div
                    key={field.key}
                    className={
                    isWide
                        ? 's10-detail-field s10-detail-field--wide'
                        : 's10-detail-field'
                    }
                >
                    <span>{field.label}</span>

                    <strong>
                    {value || '—'}
                    </strong>
                </div>
                )
            })}
            </div>


      </div>
      
      
        <div className="s10-photo-panel">
            <div className="s10-card-title">
                <strong>ภาพประกอบจากกล้องวงจรปิด</strong>
                <span>ภาพรถ 1 ภาพ</span>
            </div>

            <div className="s10-photo-grid">
                <div className="s10-photo-cell">
                {item.photos?.[0] ? (
                    <img
                    src={item.photos[0]}
                    alt={`ภาพรถ ${item.plate}`}
                    />
                ) : (
                    <div className="s10-photo-empty">
                    ยังไม่มีภาพรถ
                    </div>
                )}

                <span>ภาพรถ</span>
                </div>
            </div>

            <div className="s10-photo-caption">
                ภาพหลักฐานประกอบการแจ้งเตือนรถเป้าหมาย
            </div>
        </div>


    </div>
    
  </div>
}
export default forwardRef(function Section10Editor({report,center,month,year,canEdit=false,onDataChange},ref) {
  const centerId = Number(center?.id)
  const selectedMonth = Number(month)
  const selectedYear = Number(year)
  const valid = !!report?.id && Number(report.center_id) === centerId &&
    Number(report.report_month) === selectedMonth && Number(report.report_year) === selectedYear
  const [vehicles,setVehicles] = useState([])
  const [annualCounts,setAnnualCounts] = useState(Array(12).fill(null))
  const [tableSize, setTableSize] = useState('10')
  const [activePage,setActivePage] = useState(0)
  const [openId,setOpenId] = useState(null)
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [exporting,setExporting] = useState(false)
  const [saved,setSaved] = useState(false)
  const [dirty,setDirty] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const [scale,setScale] = useState(1)
  const frameRef = useRef(null)
  const paperRefs = useRef([])
  const fileInput = useRef(null)
  const displayRows = useMemo(() =>
    vehicles.map((v,i) => ({...v,originalOrder:i}))
      .sort((a,b) => severityOrder(a.severityCode)-severityOrder(b.severityCode) || a.originalOrder-b.originalOrder)
      .map((v,i) => ({...v,order:i+1})), [vehicles])
  

  // จำนวนแถวที่ผู้ใช้เลือกจริง
    const rowsPerPage = [4, 6, 8, 10].includes(Number(tableSize))
    ? Number(tableSize)
    : 10

    // แบ่งรถออกเป็นหน้าสรุปตามจำนวนแถวที่เลือก
    // คำนวณใหม่ทุกครั้งที่ข้อมูลหรือ Dropdown เปลี่ยน
    const summaryChunks = []

    if (displayRows.length === 0) {
    summaryChunks.push([])
    } else {
    for (
        let index = 0;
        index < displayRows.length;
        index += rowsPerPage
    ) {
        summaryChunks.push(
        displayRows.slice(
            index,
            index + rowsPerPage
        )
        )
    }
    }    


  const annualTotal = annualCounts.reduce((s,n,i) => s+(i===selectedMonth-1 ? vehicles.length : (n||0)),0)
  
  const a01Count = displayRows.filter(v => /^A01/i.test(safe(v.severityCode))).length
  const b01Count = displayRows.filter(v => /^B01/i.test(safe(v.severityCode))).length
  
  // สร้างหน้ารายงานตามการแบ่งแถวล่าสุด
    const pages = [
    // หน้าสรุป ตามจำนวนแถวที่เลือก
    ...summaryChunks.map((rows, index) => ({
        kind: 'summary',
        rows,
        part: index + 1,
    })),

    // หน้ารายละเอียดรถ คันละหนึ่งหน้า
    ...displayRows.map((vehicle, index) => ({
        kind: 'vehicle',
        vehicle,
        index,
    })),
    ]

  useEffect(() => {
    let mounted=true
    setLoading(true);setError('');setMessage('');setVehicles([]);setSaved(false);setDirty(false)
    setOpenId(null);setActivePage(0);setTableSize('10');setAnnualCounts(Array(12).fill(null))
    if (!valid) { setLoading(false);return () => {mounted=false} }
    ;(async()=>{
      try {
        const rows=await fetchYearSections(centerId,selectedYear)
        if (!mounted) return
        const current=rows.find(r => String(r.id)===String(report.id))
        const counts=Array(12).fill(null)
        for(const row of rows) {
          if(Number(row.report_month)>=1 && Number(row.report_month)<=12)
            counts[Number(row.report_month)-1]=Array.isArray(row.content?.vehicles) ? row.content.vehicles.length : 0
        }
        setAnnualCounts(counts)
        setVehicles(Array.isArray(current?.content?.vehicles) ? current.content.vehicles.map(normalizeVehicle) : [])
        
        const savedTableSize = String(
            current?.content?.tableSize ?? '10'
            )

            setTableSize(
            PER_PAGE[savedTableSize] ? savedTableSize : '10'
            )

        setSaved(!!current)
      } catch(e) { if(mounted) setError(e.message || 'โหลดข้อมูลไม่สำเร็จ') }
      finally { if(mounted) setLoading(false) }
    })()
    return () => {mounted=false}
  },[report?.id,centerId,selectedMonth,selectedYear,valid])

  useEffect(()=>{
    const target=frameRef.current
    if(!target) return
    const resize=()=>setScale(Math.min(1,Math.max(.16,(target.clientWidth-32)/PAPER_W)))
    const observer=new ResizeObserver(resize)
    observer.observe(target);resize()
    return ()=>observer.disconnect()
  },[canEdit])

  const changeVehicle=(id,key,value)=>{setVehicles(prev=>prev.map(v=>v.id===id?{...v,[key]:value}:v));setDirty(true)}
  
  
    const onImages = async (id, files) => {
        const file = files?.[0]

        if (!file) return

        setError('')

        try {
            const image = await compressImage(file)

            setVehicles(prev =>
            prev.map(vehicle =>
                vehicle.id === id
                ? {
                    ...vehicle,
                    photos: [image],
                    }
                : vehicle
            )
            )

            setDirty(true)
        } catch (e) {
            setError(
            e.message || 'อัปโหลดภาพไม่สำเร็จ'
            )
        }
    }


  const downloadTemplate=()=>{
    const workbook=XLSX.utils.book_new()
    // ทั้งเทมเพลตและตารางหน้าแรกใช้ FIELD_CONFIG ชุดเดียวกัน
    const rows=[HEADERS,...displayRows.map(v => FIELDS.map(key=>v[key] ?? ''))]
    const sheet=XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols']=FIELD_CONFIG.map(field=>({wch:field.width}))
    sheet['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'}
    sheet['!autofilter']={ref:`A1:L${Math.max(2,rows.length)}`}
    XLSX.utils.book_append_sheet(workbook,sheet,'รายการรถ')
    XLSX.writeFile(workbook,`Blacklist_${center?.code||centerId}_${selectedMonth}_${selectedYear}.xlsx`)
  }
  const uploadExcel=async(file)=>{
    if(!file || !canEdit || loading || saving) return
    try{
      
      const workbook = XLSX.read(
        await file.arrayBuffer(),
        {
            type: 'array',
            cellDates: false,
        }
        )

      const sheet=workbook.Sheets['รายการรถ'] || workbook.Sheets[workbook.SheetNames[0]]
      if(!sheet) throw new Error('ไม่พบตารางรายการรถใน Excel')
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true})
      const incomingHeader=(rows[0]||[]).map(safe)
      if(!HEADERS.every((name,i)=>incomingHeader[i]===name)) throw new Error('หัวคอลัมน์ไม่ตรง กรุณาดาวน์โหลด Template ใหม่')
      const incoming=rows.slice(1).filter(r=>r.some(c=>safe(c))).map(r=>{
        const v=emptyVehicle()
        
        FIELDS.forEach((key, i) => {
            if (key === 'plate') {
                v[key] = normalizePlate(r[i])
            } else if (
                ['date', 'officerDate'].includes(key)
            ) {
                v[key] = dateBE(r[i])
            } else if (
                ['time', 'officerTime'].includes(key)
            ) {
                v[key] = formattedTime(r[i])
            } else {
                v[key] = safe(r[i])
            }
            })    

        return v
      })
      if(incoming.length>150) throw new Error('นำเข้าได้ไม่เกิน 150 รายการต่อเดือน')
      
          
      // ตรวจสอบข้อมูลก่อนแทนที่รายการเดิม
        if (incoming.length === 0) {
            throw new Error(
            'ไม่พบข้อมูลรถใน Excel ข้อมูลเดิมยังไม่ถูกเปลี่ยนแปลง'
            )
        }

        // อัปโหลดใหม่ = แทนที่รายการรถทั้งเดือน
        // ไม่รวมกับข้อมูลเก่า และไม่เก็บภาพเก่า
        setVehicles(incoming)

        // เปิดรถคันแรกในแถบแก้ไข
        setOpenId(incoming[0]?.id || null)

        // กลับไปหน้าสรุปหน้าแรก
        setActivePage(0)

        // รอให้ผู้ใช้กดบันทึกลง Supabase
        setDirty(true)
        setError('')

        setMessage(
            `นำเข้า Excel สำเร็จ ${incoming.length} คัน ` +
            `· แทนที่รายการเดิมของเดือน${MONTHS[selectedMonth - 1]}แล้ว ` +
            '· กรุณาตรวจสอบและกดบันทึก'
      )
  



    }catch(e){setError(e.message || 'อ่าน Excel ไม่สำเร็จ')}
  }
  const save=async()=>{
    if(!valid || !canEdit || saving || loading) return
    setSaving(true);setError('');setMessage('')
    try{
      const uploadingImages=vehicles.some(v=>v.photos?.length)
      if(uploadingImages){
        const existing=await fetchImageMonths(centerId)
        const newer=existing.filter(r=>reportKey(r)>selectedYear*12+selectedMonth)
        if(newer.length>=2) throw new Error('มีภาพจากสองเดือนรายงานที่ใหม่กว่าแล้ว ไม่สามารถบันทึกภาพย้อนเดือนนี้ได้ แต่สามารถลบภาพและบันทึกข้อมูลตัวหนังสือได้')
      }
      const content={version:1,tableSize,vehicles:vehicles.map(v=>({
        ...v,

        plate: normalizePlate(v.plate),
        
        date:dateBE(v.date),officerDate:dateBE(v.officerDate),
        time:formattedTime(v.time),officerTime:formattedTime(v.officerTime),
        photos: (v.photos || [])
            .filter(Boolean)
            .slice(0, 1),
      }))}
      const {data:old,error:checkError}=await supabase.from('monthly_report_sections')
        .select('report_id').eq('report_id',report.id).eq('section_no',SECTION_NO).maybeSingle()
      if(checkError) throw checkError
      const response=old ? await supabase.from('monthly_report_sections')
        .update({content}).eq('report_id',report.id).eq('section_no',SECTION_NO)
        : await supabase.from('monthly_report_sections').insert({report_id:report.id,section_no:SECTION_NO,content})
      if(response.error) throw response.error
      setSaved(true);setDirty(false)
      setAnnualCounts(prev=>prev.map((n,i)=>i===selectedMonth-1?vehicles.length:n))
      // เก็บข้อความทุกเดือน แต่ลบเฉพาะรูปจากเดือนที่เก่ากว่าสองเดือนภาพล่าสุด
      if(uploadingImages){
        try { await pruneOldImageMonths(centerId) }
        catch(e){setError(`บันทึกสำเร็จ แต่ลบภาพเดือนเก่าไม่สำเร็จ: ${e.message}`);onDataChange?.();return}
      }
      setMessage('บันทึกหัวข้อ 10 สำเร็จ · ข้อมูลตัวหนังสือเก็บครบทั้งปี')
      onDataChange?.()
    }catch(e){setError(e.message || 'บันทึกไม่สำเร็จ')}
    finally{setSaving(false)}
  }

    const capture = async (index) => {
    const source = paperRefs.current[index]

    if (!source || loading) {
      throw new Error('หน้ารายงานยังไม่พร้อม')
    }

    await document.fonts?.ready
    await Promise.all(
      [...source.querySelectorAll('img')].map(img =>
        img.decode?.().catch(() => {})
      )
    )

    const beforeOpacity = source.style.opacity

    let host = null

    try {
      source.style.opacity = '1'

      await new Promise(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      )

      // ใช้ scale เดียวกับพรีวิว เพื่อให้ภาพที่ export ออกมา
      // มีสัดส่วน/ระยะ/ขนาด เท่ากับที่เห็นบนหน้าจอ
      const previewScale = Math.max(scale || 1, 0.16)

      host = document.createElement('div')
      host.style.position = 'fixed'
      host.style.left = '-100000px'
      host.style.top = '0'
      host.style.width = `${PAPER_W}px`
      host.style.height = `${PAPER_H}px`
      host.style.background = '#ffffff'
      host.style.overflow = 'hidden'
      host.style.pointerEvents = 'none'
      host.style.zIndex = '-1'

      const scaledWrap = document.createElement('div')
      scaledWrap.style.width = `${PAPER_W}px`
      scaledWrap.style.height = `${PAPER_H}px`
      scaledWrap.style.transformOrigin = 'top left'
      scaledWrap.style.transform = `scale(${previewScale})`

      const clone = source.cloneNode(true)
      clone.style.opacity = '1'
      clone.style.transform = 'none'
      clone.style.position = 'relative'
      clone.style.inset = 'auto'
      clone.style.width = `${PAPER_W}px`
      clone.style.height = `${PAPER_H}px`
      clone.style.pointerEvents = 'none'

      scaledWrap.appendChild(clone)
      host.appendChild(scaledWrap)
      document.body.appendChild(host)

      await new Promise(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      )

      const canvas = await html2canvas(host, {
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: PAPER_W * previewScale,
        height: PAPER_H * previewScale,
        scale: 2 / previewScale,
      })

      return canvas.toDataURL('image/png')
    } finally {
      source.style.opacity = beforeOpacity
      if (host && host.parentNode) host.parentNode.removeChild(host)
    }
  }
  
  
const downloadPng = async () => {
  if (exporting || loading) return

  setExporting(true)
  setError('')

  try {
    // จับภาพรายงานตามปกติ
    const fullSizeUrl = await capture(activePage)

    // อ่านขนาดพรีวิวที่แสดงอยู่บนหน้าจอจริง
    const previewNode = paperRefs.current[activePage]
    const previewRect = previewNode?.getBoundingClientRect()

    const previewWidth = Math.max(
      1,
      Math.round(previewRect?.width || PAPER_W * scale)
    )

    const previewHeight = Math.max(
      1,
      Math.round(previewRect?.height || PAPER_H * scale)
    )

    // โหลดภาพต้นฉบับที่ Capture ได้
    const image = new Image()
    image.src = fullSizeUrl

    await image.decode()

    // สร้าง PNG ให้มีขนาดพิกเซลเท่ากับพรีวิว
    const canvas = document.createElement('canvas')

    canvas.width = previewWidth
    canvas.height = previewHeight

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('ไม่สามารถสร้างภาพ PNG ได้')
    }

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // ย่อภาพโดยรักษาสัดส่วนเดิม
    ctx.drawImage(
      image,
      0,
      0,
      previewWidth,
      previewHeight
    )

    // ดาวน์โหลดภาพตามขนาดพรีวิว
    const url = canvas.toDataURL('image/png')

    const a = document.createElement('a')

    a.href = url

    a.download =
      `Monthly_${center?.code || centerId}_` +
      `${selectedMonth}_${selectedYear}_` +
      `Section10_Page${activePage + 1}.png`

    document.body.appendChild(a)
    a.click()
    a.remove()

  } catch (e) {
    setError(e.message || 'สร้าง PNG ไม่สำเร็จ')
  } finally {
    setExporting(false)
  }
}



  useImperativeHandle(ref,()=>({
    isReady:()=>valid && !loading && !saving && !error,
    hasData:()=>saved,
    exportPdfPages:async()=>{
      const result=[]
      for(let i=0;i<pages.length;i++) result.push({orientation:'landscape',dataUrl:await capture(i)})
      return result
    },
  }))
  const drawPage=(page)=>page.kind==='summary'
    ? <SummaryPage
        center={center}
        month={selectedMonth}
        year={selectedYear}
        rows={page.rows}
        part={page.part}
        totalParts={summaryChunks.length}
        monthCount={vehicles.length}
        a01Count={a01Count}
        b01Count={b01Count}
        tableSize={tableSize}
        />
    : <VehiclePage
        center={center}
        month={selectedMonth}
        year={selectedYear}
        item={page.vehicle}
        index={page.index}
        total={vehicles.length}
        />
  return <div className={`s10-editor ${canEdit?'editing':''}`}>
    {canEdit && <aside className="s10-side">
      <div className="s10-side-header"><span>หัวข้อ 10</span><h3>รายงานแจ้งเตือนรถบัญชีดำ</h3><p>หน้าสรุป + รถแต่ละคันคันละหน้า</p></div>
      <div className="s10-side-body">
        <h4>นำเข้ารายการรถ</h4>
        <button type="button" className="s10-secondary" onClick={downloadTemplate}>↓ ดาวน์โหลด Template Excel</button>
        <button type="button" className="s10-secondary" onClick={()=>fileInput.current?.click()} disabled={loading||saving}>↑ อัปโหลด Excel</button>
        <input ref={fileInput} type="file" hidden accept=".xlsx,.xls" onChange={e=>{uploadExcel(e.target.files?.[0]);e.target.value=''}}/>
        <p className="s10-hint">Template 12 คอลัมน์ตรงกับตารางพรีวิว · รถ 1 คันต่อ 1 แถว · ใช้เดือนรายงานจากระบบหลัก · วันที่ทั้งสองช่องรับ พ.ศ./ค.ศ. · รหัส A01 เรียงก่อน B01</p>
        <label className="s10-label">จำนวนแถวตารางสรุปต่อหน้า
          
            <select
                value={tableSize}
                onChange={e => {
                    setTableSize(e.target.value)
                    setDirty(true)
                    setActivePage(0)
                }}
                >
                {[4, 6, 8, 10].map(n => (
                    <option key={n} value={String(n)}>
                    {n} แถวต่อหน้า
                    </option>
                ))}
            </select>

        </label>
        <h4>รายการรถเดือน{MONTHS[selectedMonth-1]} ({vehicles.length} คัน)</h4>
        <button type="button" className="s10-secondary" onClick={()=>{const next=emptyVehicle();setVehicles(v=>[...v,next]);setOpenId(next.id);setDirty(true)}}>+ เพิ่มรถด้วยตัวเอง</button>
        <div className="s10-case-list">{vehicles.map((v,i)=><div className="s10-case-edit" key={v.id}>
          <button type="button" className="s10-case-toggle" onClick={()=>setOpenId(openId===v.id?null:v.id)}>
            <b>{String(i+1).padStart(2,'0')}</b><span>{v.plate||'ไม่ระบุทะเบียน'}<small>{v.date||'—'} · {v.location||'ไม่ระบุสถานที่'}</small></span><span>{openId===v.id?'▴':'▾'}</span>
          </button>
          {openId===v.id && <div className="s10-case-form">
            {FIELDS.map((key,i)=><label className="s10-label" key={key}>{HEADERS[i]}
              {['behavior','responsePlan','result'].includes(key) ? <textarea rows={2} value={v[key] ?? ''} onChange={e=>changeVehicle(v.id,key,e.target.value)}/>
                : <input
                    type="text"
                    value={v[key] ?? ''}
                    onChange={e =>
                        changeVehicle(
                        v.id,
                        key,
                        e.target.value
                        )
                    }
                    onBlur={e => {
                        if (key !== 'plate') return

                        const normalized = normalizePlate(
                        e.target.value
                        )

                        if (normalized !== e.target.value) {
                        changeVehicle(
                            v.id,
                            'plate',
                            normalized
                        )
                        }
                    }}
                    placeholder={
                        ['date', 'officerDate'].includes(key)
                        ? '08/07/2569 หรือ 08/07/2026'
                        : key === 'severityCode'
                            ? 'A01 หรือ B01'
                            : ''
                    }
                    />
                
              }
            </label>)}

            
            <div className="s10-label">
            ภาพประกอบรถ (1 ภาพต่อคัน)
            </div>

            <label
            className="s10-dropzone"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
                e.preventDefault()
                onImages(v.id, e.dataTransfer.files)
            }}
            >
            <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={e => {
                onImages(v.id, e.target.files)
                e.target.value = ''
                }}
            />

            <strong>
                ลากภาพมาวาง หรือคลิกเลือกไฟล์
            </strong>

            <small>
                JPG / PNG / WEBP · 1 ภาพต่อคัน
            </small>
            </label>

            <div className="s10-thumb-list">
            {v.photos?.[0] && (
                <div className="s10-thumb">
                <img
                    src={v.photos[0]}
                    alt="ภาพรถ"
                />

                <button
                    type="button"
                    onClick={() =>
                    changeVehicle(v.id, 'photos', [])
                    }
                >
                    ลบภาพ
                </button>
                </div>
            )}
            </div>

            
            
            <button className="s10-danger" type="button" onClick={()=>{if(window.confirm('ลบรถคันนี้จากเดือนรายงาน?')){setVehicles(list=>list.filter(x=>x.id!==v.id));setOpenId(null);setDirty(true)}}}>ลบรายการรถคันนี้</button>
          </div>}
        </div>)}</div>
        {dirty && <p className="s10-unsaved">มีข้อมูลแก้ไขที่ยังไม่ได้บันทึก</p>}
        <button type="button" className="s10-save" disabled={saving||loading||!valid} onClick={save}>{saving?'กำลังบันทึก...':`บันทึกหัวข้อ 10 · ${MONTHS[selectedMonth-1]}`}</button>
        {error && <p className="s10-error">{error}</p>}{message && <p className="s10-success">{message}</p>}
        <div className="s10-export"><h4>ส่งออกรายงาน</h4><button type="button" className="s10-secondary" disabled={exporting||loading} onClick={downloadPng}>↓ บันทึกหน้าที่เลือกเป็น PNG</button><small>รวม PDF ผ่านปุ่ม PDF กลางของระบบ</small></div>
      </div>
    </aside>}
    <section className="s10-preview" ref={frameRef}>
      <div className="s10-page-tabs">
        {pages.map((page,i)=><button key={i} type="button" className={i===activePage?'active':''} onClick={()=>setActivePage(i)}>
          {page.kind==='summary' ? `สรุป ${page.part}/${summaryChunks.length}` : `รถ ${page.index+1}/${vehicles.length}`}
        </button>)}
      </div>
      <div className="s10-stage" style={{width:PAPER_W*scale,height:PAPER_H*scale}}>
        {pages.map((page,i)=><div className="s10-stage-paper" key={i} ref={node=>{paperRefs.current[i]=node}} style={{opacity:i===activePage?1:0,transform:`scale(${scale})`,zIndex:i===activePage?2:1}}>{drawPage(page)}</div>)}
      </div>
      <div className="s10-counter">หน้า {activePage+1} / {pages.length}{dirty?' · มีข้อมูลที่ยังไม่ได้บันทึก':''}</div>
    </section>
  </div>
})
