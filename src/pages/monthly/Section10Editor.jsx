import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { supabase } from '../../lib/supabase'
import './Section10Editor.css'

const PAPER_W = 1120
const PAPER_H = 792
const SECTION_NO = 10
const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const MONTH_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
// Template ใหม่ 11 ช่อง · ยังคงอ่าน Excel เดิม 9 และ 12 ช่อง
// SECTION10_REPEAT_ALERTS_V2: 12-field legacy import stays readable.
const LEGACY_FIELD_CONFIG = [
  { key: 'date', label: 'วันที่แจ้งเตือน', width: 18 },
  { key: 'time', label: 'เวลา', width: 15 },
  { key: 'location', label: 'สถานที่', width: 26 },
  { key: 'district', label: 'อำเภอ', width: 20 },
  { key: 'plate', label: 'ป้ายทะเบียน', width: 20 },
  { key: 'vehicleType', label: 'ประเภทรถ', width: 23 },
  { key: 'result', label: 'ผลการตรวจสอบ', width: 29 },
  { key: 'behavior', label: 'พฤติกรรม', width: 35 },
  { key: 'severityCode', label: 'รหัสความรุนแรง', width: 19 },
  { key: 'officerDate', label: 'วันที่แจ้งเจ้าหน้าที่', width: 22 },
  { key: 'officerTime', label: 'เวลาที่แจ้งเจ้าหน้าที่', width: 21 },
  { key: 'responsePlan', label: 'แผนเผชิญเหตุ', width: 38 },
]
const RETIRED_DETAIL_KEYS = new Set(['result', 'officerDate', 'officerTime'])
// PATCH_SECTION10_BLACKLIST_META_V1: retain compatibility with 9-/12-column imports.
const PREVIOUS_FIELD_CONFIG = LEGACY_FIELD_CONFIG.filter(field => !RETIRED_DETAIL_KEYS.has(field.key))
const PREVIOUS_HEADERS = PREVIOUS_FIELD_CONFIG.map(field => field.label)
const PREVIOUS_FIELDS = PREVIOUS_FIELD_CONFIG.map(field => field.key)
// SECTION10_GLOBAL_GROUPS_V2: all center accounts share the database group catalog.
const FIELD_CONFIG = [
  ...PREVIOUS_FIELD_CONFIG.slice(0, 6),
  { key: 'blacklistGroup', label: 'กลุ่มบัญชีดำ', width: 26 },
  { key: 'blacklistOwner', label: 'เจ้าของบัญชีดำ', width: 28 },
  ...PREVIOUS_FIELD_CONFIG.slice(6),
]
const LEGACY_HEADERS = LEGACY_FIELD_CONFIG.map(field => field.label)
const LEGACY_FIELDS = LEGACY_FIELD_CONFIG.map(field => field.key)
const STATIC_KEYS = ['plate', 'vehicleType', 'blacklistGroup', 'blacklistOwner', 'severityCode', 'behavior']
const MAX_CASES_PER_PAGE = 4


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

// V5: compact Bangkok name in the summary table only.
// Keep stored plate, imported Excel, individual vehicle pages unchanged.
const compactPlateForSummary = value =>
  safe(value).replace(/กรุงเทพมหานคร|กรุงเทพฯ/g, 'กทม.')

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

// PATCH_SECTION10_ANALYTICS_OVERVIEW_V1: separate analytics overview page.
const SEVERITY_FAMILY_LABELS = {
  A: 'หมวด A',
  B: 'หมวด B',
}

function severityFamily(value) {
  const code = safe(value).toUpperCase()
  if (/^A\d+/i.test(code)) return 'A'
  if (/^B\d+/i.test(code)) return 'B'
  return ''
}

function groupIntensity(count) {
  const n = Number(count) || 0

  if (n <= 0) return 'zero'
  if (n <= 2) return 'lv1'
  if (n <= 4) return 'lv2'
  if (n <= 6) return 'lv3'
  if (n <= 8) return 'lv4'
  return 'lv5' // 9 รายการขึ้นไป
}



function summarizeBlacklistGroups(rows, groupNames) {
  const names = [...new Set(groupNames.map(safe).filter(Boolean))]
  const counts = new Map(names.map(name => [name, 0]))
  rows.forEach(item => {
    const name = safe(item?.blacklistGroup)
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  })
  return [...counts].map(([name, count]) => ({
    name, count, palette: 'alert', intensity: groupIntensity(count),
  }))
}

function percentText(part, total) {
  if (!total) return '0.0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

function compactGroupLabel(name) {
  return safe(name)
}

const reportKey = r => Number(r.report_year) * 12 + Number(r.report_month)
const hasPhotos = content => Array.isArray(content?.vehicles) &&
  content.vehicles.some(v => Array.isArray(v.photos) && v.photos.some(Boolean))
const normalizeVehicle = v => ({
  ...emptyVehicle(),
  ...v,

  plate: normalizePlate(v?.plate),
  time: formattedTime(v?.time),
  officerTime: formattedTime(v?.officerTime),

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



// SECTION10_TIME_DOT_V1: รับเวลาได้หลายรูปแบบ แสดงเป็น HH.MM น. เสมอ
function formattedTime(value) {
  if (value == null || value === '') return ''

  const pad = n => String(n).padStart(2, '0')
  const output = (hours, minutes) => {
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) ||
        hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
    return `${pad(hours)}.${pad(minutes)} น.`
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return output(value.getHours(), value.getMinutes()) || ''
  }

  // Excel เก็บเวลาที่เลือกชนิด Time เป็นเศษส่วนของ 1 วัน
  // เช่น 0.25 = 06:00, 0.75 = 18:00
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 1440) % 1440
    return output(Math.floor(totalMinutes / 60), totalMinutes % 60) || ''
  }

  const original = safe(value)
  const text = original
    .normalize('NFKC')
    .replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0E50))
    .replace(/\s+/g, '')
    .replace(/น\.?$/u, '')

  if (!text) return ''

  // เช่น 6, 06, 17, 6:00, 06.00, 17:21, 17:21:00
  const matched = text.match(/^(\d{1,2})(?:([.:])(\d{1,2})(?::\d{1,2})?)?$/)
  if (matched) {
    const hours = Number(matched[1])
    let minutes = 0
    if (matched[3] !== undefined) {
      // ตัวเลข 6.50 ใน Excel General จะกลายเป็น 6.5:
      // ต้องอ่านเป็น 06.50 ไม่ใช่ 06.05
      if (matched[2] === '.' && typeof value === 'number') {
        minutes = Math.round((value - Math.trunc(value)) * 100)
      } else if (matched[2] === '.' && matched[3].length === 1) {
        minutes = Number(matched[3]) * 10
      } else {
        minutes = Number(matched[3])
      }
    }
    return output(hours, minutes) || original
  }

  // เผื่อผู้ใช้พิมพ์ 600 หรือ 0600 ในช่องชนิด Text
  const compact = text.match(/^(\d{3,4})$/)
  if (compact) {
    return output(Number(compact[1].slice(0, -2)), Number(compact[1].slice(-2))) || original
  }

  // ไม่สร้างเวลาผิดจากค่าที่ไม่รู้จัก เช่น 25:99
  return original
}

// SECTION10_REPEAT_ALERTS_V2: normalize whitespace/punctuation for grouping,
// not for changing stored plate text. Empty plates always remain separate.
function monthVehicleKey(vehicle) {
  const plate = compactPlateForSummary(normalizePlate(vehicle?.plate))
    .normalize('NFKC')
    .replace(/[\s\-‐‑‒–—−.]/g, '')
    .toUpperCase()
  return plate || null
}

function alertDateSortKey(vehicle) {
  const value = dateBE(vehicle?.date)
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  const time = formattedTime(vehicle?.time).match(/^(\d{2})\.(\d{2})/)
  return `${match[3]}-${match[2]}-${match[1]} ${time ? `${time[1]}:${time[2]}` : '00:00'}`
}

function groupMonthAlerts(displayRows) {
  const byPlate = new Map()
  displayRows.forEach((row, originalPosition) => {
    // Do not merge records with missing plate or unknown identity.
    const key = monthVehicleKey(row) || `__unidentified_${row.id || originalPosition}`
    if (!byPlate.has(key)) byPlate.set(key, { key, events: [] })
    byPlate.get(key).events.push({ ...row, _order: originalPosition })
  })
  return [...byPlate.values()].map(group => {
    const originalEvents = group.events
    const staticInfo = Object.fromEntries(STATIC_KEYS.map(key => [
      key,
      originalEvents.map(event => safe(event[key])).find(Boolean) || '',
    ]))
    const events = [...originalEvents].sort((a, b) => {
      const ka = alertDateSortKey(a)
      const kb = alertDateSortKey(b)
      if (ka && kb && ka !== kb) return ka.localeCompare(kb)
      return a._order - b._order
    })
    return { ...group, events, staticInfo }
  })
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
// PATCH_SECTION10_FIXED_GRID_AUTOFIT_V2: identical ten-row physical grid for every center.
// PATCH_SECTION10_ANALYTICS_OVERVIEW_V1: separate overview page before the table.
// PATCH_SECTION10_ANALYTICS_OVERVIEW_V2: approved visual layout, real values.
// PATCH_SECTION10_ANALYTICS_VISUAL_V4: icon-rich overview layout, larger donut, tighter right column.
function AnalyticsPage({ center, month, year, monthCount, a01Count, b01Count, groupStats, allGroupStats, part, totalParts }) {
  const maxCount = Math.max(0, ...groupStats.map(item => item.count || 0))
  const tickStep = maxCount <= 8 ? 1 : Math.ceil(maxCount / 8)
  const chartMax = Math.max(8, Math.ceil(maxCount / tickStep) * tickStep)
  const ticks = Array.from({ length: chartMax / tickStep + 1 }, (_, i) => i * tickStep)
  const activeGroupCount = allGroupStats.filter(item => item.count > 0).length
  const topCount = Math.max(0, ...allGroupStats.map(item => item.count || 0))
  const topGroup = topCount > 0 ? allGroupStats.find(item => item.count === topCount) : null
  const otherSeverityCount = Math.max(0, monthCount - a01Count - b01Count)
  const circumference = 2 * Math.PI * 72
  const aArc = monthCount ? circumference * a01Count / monthCount : 0
  const bArc = monthCount ? circumference * b01Count / monthCount : 0

  // Number of chart rows and summary tiles adapts to the global catalog.
  // <= 10 groups: one tile row. 11+: balanced rows within the same A4 page.
  const groupCount = groupStats.length
  const cardColumns = Math.min(10, groupCount <= 10 ? Math.max(1, groupCount) : Math.ceil(groupCount / 2))
  const cardRows = Math.max(1, Math.ceil(groupCount / cardColumns))

  return (
    <div
      className={`s10-paper s10-analytics-paper${groupCount > 10 ? ' s10-analytics-paper--many' : ''}${groupCount > 18 ? ' s10-analytics-paper--packed' : ''}`}
      style={{
        '--s10-group-count': Math.max(1, groupCount),
        '--s10-card-columns': cardColumns,
        '--s10-card-rows': cardRows,
      }}
    >
      <header className="s10-heading s10-analytics-heading">
        <h2>สรุปการแจ้งเตือนรถบัญชีดำ — ภาพรวมกลุ่มรถ</h2>
        <p>{center?.name || 'ศูนย์กล้องวงจรปิด'} · ประจำเดือน {MONTHS[month - 1]} {year}</p>
      </header>

      <div className="s10-metrics s10-analytics-metrics">
        <div className="blue">
          <div className="s10-metric-copy"><span>แจ้งเตือนเดือนนี้</span><strong>{formatNum(monthCount)}</strong><small>รายการ</small></div>
          <div className="s10-metric-icon s10-metric-icon--car" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 14l1.6-4.8A2 2 0 0 1 8.5 8h7a2 2 0 0 1 1.9 1.2L19 14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 14h16v4a1 1 0 0 1-1 1h-1v-2H6v2H5a1 1 0 0 1-1-1v-4Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><circle cx="7.5" cy="16" r="1.2" fill="currentColor"/><circle cx="16.5" cy="16" r="1.2" fill="currentColor"/></svg>
          </div>
        </div>
        <div className="red">
          <div className="s10-metric-copy"><span>ความรุนแรงหมวด A</span><strong>{formatNum(a01Count)}</strong><small>รายการ</small></div>
          <div className="s10-metric-icon s10-metric-icon--a" aria-hidden="true">A</div>
        </div>
        <div className="green">
          <div className="s10-metric-copy"><span>ความรุนแรงหมวด B</span><strong>{formatNum(b01Count)}</strong><small>รายการ</small></div>
          <div className="s10-metric-icon s10-metric-icon--b" aria-hidden="true">B</div>
        </div>
      </div>

      <section className="s10-analytics-card">
        <div className="s10-analytics-card-head">
          <div className="s10-analytics-card-titlewrap">
            <div className="s10-analytics-title-icon s10-analytics-title-icon--chart" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 20V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M8 18v-6" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/><path d="M13 18V9" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/><path d="M18 18V6" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/></svg>
            </div>
            <div>
              <strong>สรุปจำนวนการแจ้งเตือนแยกตามกลุ่มบัญชีดำ ({allGroupStats.length} กลุ่ม)</strong>
              <span>แสดงจำนวนรายการแจ้งเตือนของรถในแต่ละกลุ่มประจำเดือนนี้</span>
            </div>
          </div>
          <div className="s10-analytics-top-group">
            <span aria-hidden="true">🏆</span>
            <strong>{topGroup
              ? `กลุ่มที่พบมากที่สุด : ${topGroup.name} (${formatNum(topGroup.count)} รายการ)`
              : 'กลุ่มที่พบมากที่สุด : ยังไม่มีข้อมูล'}</strong>
          </div>
        </div>

        <div className="s10-analytics-main">
          <div className="s10-analytics-chart">
            {groupStats.map(item => (
              <div className="s10-analytics-row" key={item.name}>
                <div className="s10-analytics-label" title={item.name}>{item.name}</div>
                
                <div
                  className="s10-analytics-track"
                  style={{
                    '--s10-axis-steps': ticks.length - 1,
                    '--s10-bar-width': `${Math.max(
                      1.5,
                      (item.count / chartMax) * 100
                    )}%`,
                  }}
                >
                  {item.count > 0 && (
                    <>
                      <div
                        className={`s10-analytics-bar s10-analytics-bar--${item.intensity}`}
                        style={{ width: 'var(--s10-bar-width)' }}
                      />
                      <div className="s10-analytics-value s10-analytics-value--at-end">
                        {formatNum(item.count)}
                      </div>
                    </>
                  )}
                </div>

              </div>
            ))}
            <div className="s10-analytics-axis">
              <div className="s10-analytics-ticks">
                {ticks.map(tick => <span key={tick}>{formatNum(tick)}</span>)}
              </div>
              <span>จำนวนรายการ</span>
            </div>
          </div>

          <aside className="s10-analytics-side">
            <div className="s10-analytics-donut-wrap">
              <div className="s10-analytics-donut">
                <svg viewBox="0 0 176 176" className="s10-analytics-ring" aria-hidden="true">
                  <circle cx="88" cy="88" r="72" fill="none" stroke="#e9edf4" strokeWidth="24" />
                  {aArc > 0 && <circle cx="88" cy="88" r="72" fill="none" stroke="#e72c62"
                    strokeWidth="24" strokeDasharray={`${aArc} ${circumference - aArc}`}
                    transform="rotate(-90 88 88)" />}
                  {bArc > 0 && <circle cx="88" cy="88" r="72" fill="none" stroke="#16a34a"
                    strokeWidth="24" strokeDasharray={`${bArc} ${circumference - bArc}`}
                    strokeDashoffset={-aArc} transform="rotate(-90 88 88)" />}
                </svg>
                <div className="s10-analytics-donut-inner">
                  <strong>{formatNum(monthCount)}</strong><span>รายการ</span>
                </div>
              </div>
              <div className="s10-analytics-donut-legend">
                <div><i className="a" />หมวด A : {formatNum(a01Count)} รายการ ({percentText(a01Count, monthCount)})</div>
                <div><i className="b" />หมวด B : {formatNum(b01Count)} รายการ ({percentText(b01Count, monthCount)})</div>
                {otherSeverityCount > 0 && <div><i className="other" />อื่น ๆ / ไม่ระบุ : {formatNum(otherSeverityCount)} รายการ ({percentText(otherSeverityCount, monthCount)})</div>}
              </div>
            </div>
            <div className="s10-analytics-found-box">
              <div className="s10-analytics-found-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M5 14l1.6-4.8A2 2 0 0 1 8.5 8h7a2 2 0 0 1 1.9 1.2L19 14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 14h16v4a1 1 0 0 1-1 1h-1v-2H6v2H5a1 1 0 0 1-1-1v-4Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><circle cx="7.5" cy="16" r="1.2" fill="currentColor"/><circle cx="16.5" cy="16" r="1.2" fill="currentColor"/></svg>
              </div>
              <div className="s10-analytics-found-copy">
                <strong>พบทั้งหมด <b>{formatNum(activeGroupCount)}</b> จาก {formatNum(allGroupStats.length)} กลุ่ม</strong>
                <span>คิดเป็น {percentText(activeGroupCount, allGroupStats.length)} ของกลุ่มทั้งหมด</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      

      <section className="s10-analytics-groups">
        <div className="s10-card-title s10-card-title--icon">
          <div className="s10-analytics-title-icon s10-analytics-title-icon--stack" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 4 3.5 8 12 12 20.5 8 12 4Z" fill="currentColor"/><path d="M5.5 12.3 12 15.3l6.5-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 16.3 12 19.3l6.5-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          
          
          <div className="s10-analytics-group-heading">
            <strong>สรุปจำนวนรายการรายกลุ่ม{totalParts > 1 ? ` (${part}/${totalParts})` : ""}</strong>
          </div>

          <div className="s10-analytics-scale-items">
            <span><i className="zero" />ไม่มี (0)</span>
            <span><i className="lv1" />1–2 รายการ</span>
            <span><i className="lv2" />3–4 รายการ</span>
            <span><i className="lv3" />5–6 รายการ</span>
            <span><i className="lv4" />7–8 รายการ</span>
            <span><i className="lv5" />9 รายการขึ้นไป</span>
          </div>
                  

        </div>
        <div className="s10-analytics-group-grid">
          {groupStats.map(item => (
            <article className={`s10-group-card s10-group-card--${item.palette} s10-group-card--${item.intensity}`}
              key={item.name} title={`${item.name}: ${formatNum(item.count)} รายการ`}>
              <h4>{item.name}</h4>
              <strong>{item.count > 0 ? formatNum(item.count) : '—'}</strong>
              <small>รายการ</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

// Existing summary table remains a separate page.

// Existing summary table remains a separate page.

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
}) {
  const summaryTableRef = useRef(null)
  const GRID_SLOTS = 10

  // Widths total exactly 1048px: do not adapt columns to data length.
  const columns = [
    { key: 'dateTime', label: 'วันที่ / เวลาแจ้งเตือน', width: 94 },
    { key: 'location', label: 'สถานที่', width: 120 },
    { key: 'district', label: 'อำเภอ', width: 70 },
    { key: 'plate', label: 'ป้ายทะเบียน', width: 114 },
    { key: 'vehicleType', label: 'ประเภทรถ', width: 90 },
    { key: 'blacklistGroup', label: 'กลุ่มบัญชีดำ', width: 140 },
    { key: 'blacklistOwner', label: 'เจ้าของบัญชีดำ', width: 110 },
    { key: 'behavior', label: 'พฤติกรรม', width: 113 },
    { key: 'severityCode', label: 'รหัสความรุนแรง', width: 65 },
    { key: 'responsePlan', label: 'แผนเผชิญเหตุ', width: 132 },
  ]

  const emptySlots = Math.max(0, GRID_SLOTS - Math.max(rows.length, 1))

  const cellText = (item, key) => {
    if (key === 'dateTime') {
      return [dateBE(item.date), formattedTime(item.time)].filter(Boolean).join(' ') || '—'
    }
    if (key === 'plate') return compactPlateForSummary(item.plate) || '—'
    return safe(item[key]) || '—'
  }

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

  // Measure actual browser line wrapping (Thai and Latin) after layout.
  // Grid geometry never depends on measured text height.
  useLayoutEffect(() => {
    const table = summaryTableRef.current
    if (!table) return undefined
    let cancelled = false

    const fitText = () => {
      if (cancelled) return
      table.querySelectorAll('.s10-fit-text').forEach(node => {
        const parent = node.parentElement
        if (!parent) return
        const base = Number.parseFloat(window.getComputedStyle(parent).fontSize) || 11
        const minimum = Math.min(base, 7)

        // Always reset first, so edited/shortened text can regain its normal size.
        node.style.fontSize = `${base}px`
        node.style.maxHeight = 'none'
        const lineHeight = () => {
          const css = window.getComputedStyle(node)
          return Number.parseFloat(css.lineHeight) ||
            (Number.parseFloat(css.fontSize) || base) * 1.25
        }
        const aboveTwoLines = () => node.scrollHeight > (lineHeight() * 2 + 1.5)

        // Binary search avoids dozens of reflows per cell on longer reports.
        if (aboveTwoLines()) {
          let low = minimum
          let high = base
          node.style.fontSize = `${low}px`
          if (!aboveTwoLines()) {
            for (let attempt = 0; attempt < 7 && high - low > 0.15; attempt += 1) {
              const middle = (low + high) / 2
              node.style.fontSize = `${middle}px`
              if (aboveTwoLines()) high = middle
              else low = middle
            }
          }
          node.style.fontSize = `${low.toFixed(2)}px`
        }

        // Extremely long content at 7px is clipped visually, not erased.
        node.style.maxHeight = `${Math.ceil(lineHeight() * 2 + 1)}px`
      })
    }

    fitText()
    // Noto Sans Thai may finish loading after initial render.
    if (document.fonts?.ready) document.fonts.ready.then(fitText)
    return () => { cancelled = true }
  }, [rows])

  return (
    <div className="s10-paper s10-summary s10-summary--fixed">
      <Heading center={center} month={month} year={year} />

      <div className="s10-metrics">
        <div className="blue">
          <span>แจ้งเตือนเดือนนี้</span>
          <strong>{formatNum(monthCount)}</strong>
          <small>รายการ</small>
        </div>
        <div className="red">
          <span>ความรุนแรงหมวด A</span>
          <strong>{formatNum(a01Count)}</strong>
          <small>รายการ</small>
        </div>
        <div className="green">
          <span>ความรุนแรงหมวด B</span>
          <strong>{formatNum(b01Count)}</strong>
          <small>รายการ</small>
        </div>
      </div>

      <div className="s10-report-table">
        <div className="s10-card-title">
          <strong>ตารางสรุปการแจ้งเตือนรถบัญชีดำ</strong>
          <span>หน้า {part}/{totalParts} · {rows.length} ครั้ง</span>
        </div>

        <table className="s10-data-table" ref={summaryTableRef}>
          <colgroup>
            {columns.map(col => <col key={col.key} style={{ width: `${col.width}px` }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map(col => (
                <th scope="col" key={col.key}>
                  <span className="s10-fit-text" title={col.label}>{col.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map(item => (
              <tr key={item.id}>
                {columns.map(col => (
                  <td key={col.key} className={`s10-cell-${col.key}`}>
                    <span className="s10-fit-text" title={cellText(item, col.key)}>
                      {col.key === 'dateTime'
                        ? renderDateTime(item.date, item.time)
                        : cellText(item, col.key)}
                    </span>
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length} className="s10-empty-row">
                  <span className="s10-fit-text" title="ยังไม่มีรายการรถในเดือนนี้">
                    ยังไม่มีรายการรถในเดือนนี้
                  </span>
                </td>
              </tr>
            )}
            {Array.from({ length: emptySlots }, (_, index) => (
              <tr key={`s10-fixed-empty-${index}`} className="s10-fixed-empty-grid" aria-hidden="true">
                {columns.map(col => <td key={col.key} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// SECTION10_DYNAMIC_IMAGES_V3: evidence layout adapts to per-page alert count
function VehiclePage({ center, month, year, group, events, index, total, caseOffset, part, totalParts }) {
  const info = group.staticInfo
  const monthlyCount = group.events.length
  return (
    <div className="s10-paper s10-vehicle-page s10-grouped-vehicle-page">
      <Heading center={center} month={month} year={year} sub />
      <div className="s10-vehicle-hero s10-group-hero">
        <div>
          <span>รถเป้าหมายคันที่ {String(index + 1).padStart(2, '0')} / {total}</span>
          <h3>{info.plate || 'ไม่ระบุป้ายทะเบียน'}</h3>
          <p>ประวัติการแจ้งเตือนในเดือนนี้{totalParts > 1 ? ` · หน้ารายละเอียด ${part}/${totalParts}` : ''}</p>
        </div>
        <div className="s10-vehicle-chip">{info.severityCode || 'ไม่ระบุรหัส'}</div>
      </div>
      <div className="s10-group-layout">
        <section className="s10-events-panel">
          <div className="s10-card-title">
            <strong>ข้อมูลการแจ้งเตือนแต่ละครั้ง</strong>
            <span>ครั้งที่ {caseOffset + 1}–{caseOffset + events.length} / {monthlyCount}</span>
          </div>
          <div className={`s10-event-list s10-event-list--${events.length}`} style={{ '--s10-visible-cases': events.length }}>
            {events.map((event, i) => (
              <article className="s10-event-card" key={event.id || `${caseOffset}-${i}`}>
                <div className="s10-event-content">
                  <div className="s10-event-number">ครั้งที่ {caseOffset + i + 1}</div>
                  <div className="s10-event-fields">
                    <div className="s10-event-field">
                      <span>วันที่แจ้งเตือน</span><strong>{dateBE(event.date) || '—'}</strong>
                    </div>
                    <div className="s10-event-field">
                      <span>เวลาที่แจ้งเตือน</span><strong>{formattedTime(event.time) || '—'}</strong>
                    </div>
                    <div className="s10-event-field">
                      <span>สถานที่</span><strong>{event.location || '—'}</strong>
                    </div>
                    <div className="s10-event-field">
                      <span>อำเภอ</span><strong>{event.district || '—'}</strong>
                    </div>
                    <div className="s10-event-field s10-event-plan">
                      <span>แผนเผชิญเหตุ</span><strong>{event.responsePlan || '—'}</strong>
                    </div>
                  </div>
                </div>
                <div className="s10-event-photo">
                  {event.photos?.[0] ? (
                    <img src={event.photos[0]} alt={`ภาพประกอบการแจ้งเตือนครั้งที่ ${caseOffset + i + 1}`} />
                  ) : (
                    <span>ไม่มีภาพแนบ</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside className="s10-static-panel">
          <div className="s10-card-title"><strong>ข้อมูลรถ</strong><span>ข้อมูลประจำคัน</span></div>
          <div className="s10-static-body">
            <div className="s10-static-field"><span>ป้ายทะเบียน</span><strong>{info.plate || '—'}</strong></div>
            <div className="s10-static-field"><span>ประเภทรถ</span><strong>{info.vehicleType || '—'}</strong></div>
          <div className="s10-static-field"><span>กลุ่มบัญชีดำ</span><strong>{info.blacklistGroup || '—'}</strong></div>
          <div className="s10-static-field"><span>เจ้าของบัญชีดำ</span><strong>{info.blacklistOwner || '—'}</strong></div>
            <div className="s10-static-field"><span>รหัสความรุนแรง</span><strong>{info.severityCode || '—'}</strong></div>
            <div className="s10-static-field s10-static-behavior"><span>พฤติกรรม</span><strong>{info.behavior || '—'}</strong></div>
            <div className="s10-static-count">
              <span>เจอกี่ครั้งในเดือนนี้</span>
              <strong>{formatNum(monthlyCount)} ครั้ง</strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default forwardRef(function Section10Editor({report,center,month,year,canEdit=false,isAdmin=false,onDataChange,sctAggregate},ref) {
  const centerId = Number(center?.id)
  const selectedMonth = Number(month)
  const selectedYear = Number(year)
  const valid = !!report?.id && Number(report.center_id) === centerId &&
    Number(report.report_month) === selectedMonth && Number(report.report_year) === selectedYear
  const [vehicles,setVehicles] = useState([])
  const [annualCounts,setAnnualCounts] = useState(Array(12).fill(null))
  const [tableSize, setTableSize] = useState('10')
  const [casesPerPage, setCasesPerPage] = useState(String(MAX_CASES_PER_PAGE))
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
  const [blacklistGroupRows, setBlacklistGroupRows] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsError, setGroupsError] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [groupActionMessage, setGroupActionMessage] = useState('')
  const [showGroupManager, setShowGroupManager] = useState(false)

  const refreshBlacklistGroups = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('section10_blacklist_groups')
      .select('id,name,is_active,sort_order')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
    if (fetchError) {
      setGroupsError('โหลดกลุ่มรถส่วนกลางไม่สำเร็จ: ' + fetchError.message)
      setBlacklistGroupRows([])
      setGroupsLoading(false)
      throw fetchError
    }
    setBlacklistGroupRows(data || [])
    setGroupsError('')
    setGroupsLoading(false)
    return data || []
  }, [])

  // Realtime for connected stations; polling + window focus as a fallback.
  useEffect(() => {
    refreshBlacklistGroups().catch(() => {})
    const channel = supabase.channel(`section10-blacklist-groups-${crypto.randomUUID()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'section10_blacklist_groups',
      }, () => { refreshBlacklistGroups().catch(() => {}) })
      .subscribe()
    const polling = window.setInterval(() => {
      refreshBlacklistGroups().catch(() => {})
    }, 30000)
    const focused = () => refreshBlacklistGroups().catch(() => {})
    window.addEventListener('focus', focused)
    return () => {
      window.clearInterval(polling)
      window.removeEventListener('focus', focused)
      supabase.removeChannel(channel)
    }
  }, [refreshBlacklistGroups])

  const activeGroupNames = useMemo(() => blacklistGroupRows
    .filter(row => row.is_active).map(row => row.name), [blacklistGroupRows])
  const knownGroupNames = useMemo(() => blacklistGroupRows.map(row => row.name), [blacklistGroupRows])

  const changeGroupCatalog = async (action, record = null) => {
    if (!isAdmin || groupActionBusy) return
    const name = newGroupName.trim()
    if (action === 'add' && !name) return setGroupActionMessage('กรุณาระบุชื่อกลุ่มรถ')
    if (action === 'deactivate' && !window.confirm(`นำกลุ่ม "${record.name}" ออกจากตัวเลือกของทุกศูนย์? ข้อมูลเก่าจะไม่ถูกลบ`)) return
    // SECTION10_GROUP_HARD_DELETE_V1: explicit confirmation, inactive-only.
    if (action === 'delete') {
      if (!record || record.is_active) {
        setGroupActionMessage('ต้องนำกลุ่มออกก่อน จึงจะลบถาวรได้')
        return
      }
      const typedName = window.prompt(
        `ลบกลุ่ม "${record.name}" ออกจากทุก สภ. อย่างถาวร\n` +
        'หากมีข้อมูลในรายงานย้อนหลัง ระบบจะไม่อนุญาตให้ลบ\n' +
        'พิมพ์ชื่อกลุ่มให้ตรงทุกตัวอักษรเพื่อยืนยัน:'
      )
      if (typedName === null) return
      if (typedName.trim() !== record.name) {
        setGroupActionMessage('ชื่อกลุ่มที่ยืนยันไม่ตรงกัน จึงไม่ได้ลบ')
        return
      }
    }
    setGroupActionBusy(true)
    setGroupActionMessage('')
    try {
      const { error: updateError } = action === 'delete'
        ? await supabase.rpc('section10_blacklist_group_delete', { p_id: record.id })
        : await supabase.rpc('section10_blacklist_groups_manage', {
            p_action: action,
            p_name: action === 'add' ? name : null,
            p_id: record?.id ?? null,
          })
      if (updateError) throw updateError
      await refreshBlacklistGroups()
      if (action === 'add') setNewGroupName('')
      setGroupActionMessage(action === 'add' ? 'เพิ่มกลุ่มรถส่วนกลางแล้ว'
        : action === 'activate' ? 'เปิดใช้งานกลุ่มรถแล้ว'
        : action === 'delete' ? 'ลบกลุ่มรถออกจากฐานข้อมูลกลางอย่างถาวรแล้ว'
        : 'นำกลุ่มรถออกจากตัวเลือกแล้ว (ประวัติยังอยู่)')
    } catch (err) {
      setGroupActionMessage('จัดการกลุ่มรถไม่สำเร็จ: ' + (err.message || String(err)))
    } finally {
      setGroupActionBusy(false)
    }
  }

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


// Group repeated plates within this report month; one saved row = one alert.
const groupedVehicles = useMemo(() => groupMonthAlerts(displayRows), [displayRows])
const detailsPerPage = Math.max(1, Math.min(MAX_CASES_PER_PAGE, Number(casesPerPage) || MAX_CASES_PER_PAGE))

  const annualTotal = annualCounts.reduce((s,n,i) => s+(i===selectedMonth-1 ? vehicles.length : (n||0)),0)
  
  const a01Count = displayRows.filter(v => severityFamily(v.severityCode) === 'A').length
  const b01Count = displayRows.filter(v => severityFamily(v.severityCode) === 'B').length

  // Catalog groups are globally shared. Historical inactive names remain visible
  // when referenced by an older report, without becoming selectable for new rows.
  const groupStats = summarizeBlacklistGroups(displayRows, [
    ...activeGroupNames, ...displayRows.map(row => safe(row.blacklistGroup)).filter(Boolean),
  ])
  // SECTION10_DASHBOARD_ONE_PAGE_V1:
  // No more chunks of 9. All global groups appear on one A4 overview.
  // The summary table and vehicle-detail pages continue to paginate normally.
  
  // Summary is event-based; detail pages are grouped by normalized registration.
const pages = [
  { kind: 'dashboard' },
  ...summaryChunks.map((rows, index) => ({ kind: 'summary', rows, part: index + 1 })),
]
groupedVehicles.forEach((group, index) => {
  const totalParts = Math.ceil(group.events.length / detailsPerPage)
  for (let caseOffset = 0; caseOffset < group.events.length; caseOffset += detailsPerPage) {
    pages.push({
      kind: 'vehicle',
      group,
      events: group.events.slice(caseOffset, caseOffset + detailsPerPage),
      index,
      caseOffset,
      part: Math.floor(caseOffset / detailsPerPage) + 1,
      totalParts,
    })
  }
})

useEffect(() => {
  if (activePage >= pages.length) setActivePage(Math.max(0, pages.length - 1))
}, [activePage, pages.length])

useEffect(() => {
    let mounted=true
    setLoading(true);setError('');setMessage('');setVehicles([]);setSaved(false);setDirty(false)
    setOpenId(null);setActivePage(0);setTableSize('10');setCasesPerPage(String(MAX_CASES_PER_PAGE));setAnnualCounts(Array(12).fill(null))
    if (sctAggregate) {
      const aggregate = sctAggregate.sections[10]
      setVehicles((aggregate?.vehicles || []).map(normalizeVehicle))
      setAnnualCounts(aggregate?.annualCounts || Array(12).fill(null))
      setCasesPerPage(String(Math.max(1, Math.min(MAX_CASES_PER_PAGE, Number(aggregate?.casesPerPage) || MAX_CASES_PER_PAGE))))
      setSaved(!!aggregate?.saved)
      setLoading(false)
      return () => { mounted = false }
    }
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

        setCasesPerPage(String(Math.max(1, Math.min(MAX_CASES_PER_PAGE, Number(current?.content?.casesPerPage) || MAX_CASES_PER_PAGE))))
        setSaved(!!current)
      } catch(e) { if(mounted) setError(e.message || 'โหลดข้อมูลไม่สำเร็จ') }
      finally { if(mounted) setLoading(false) }
    })()
    return () => {mounted=false}
  },[report?.id,centerId,selectedMonth,selectedYear,valid,sctAggregate])

  useEffect(()=>{
    const target=frameRef.current
    if(!target) return
    const resize=()=>setScale(Math.min(1,Math.max(.16,(target.clientWidth-32)/PAPER_W)))
    const observer=new ResizeObserver(resize)
    observer.observe(target);resize()
    return ()=>observer.disconnect()
  },[canEdit])

const changeVehicle = (id, key, value) => {
  setVehicles(prev => {
    const current = prev.find(v => v.id === id)
    if (!current) return prev
    if (!STATIC_KEYS.includes(key)) return prev.map(v => v.id === id ? { ...v, [key]: value } : v)
    const groupKey = monthVehicleKey(current)
    return prev.map(v => (
      v.id === id || (groupKey && monthVehicleKey(v) === groupKey)
        ? { ...v, [key]: value }
        : v
    ))
  })
  setDirty(true)
}
  
  
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


  const downloadTemplate=async()=>{
    if (groupsLoading || groupsError || !activeGroupNames.length) {
      setError(groupsError || 'ยังไม่มีข้อมูลกลุ่มรถส่วนกลาง กรุณาตรวจสอบ SQL หรือรอโหลดรายการ')
      return
    }
    const workbook=XLSX.utils.book_new()
    // Excel template uses FIELD_CONFIG; summary PDF uses its own fixed-width columns.
    const rows=[HEADERS,...displayRows.map(v => FIELDS.map(key => ['time', 'officerTime'].includes(key) ? formattedTime(v[key]) : (v[key] ?? '')))]
    const sheet=XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols']=FIELD_CONFIG.map(field=>({wch:field.width}))
    // ช่อง B (เวลา) เป็น Text สำหรับรายการแจ้งเตือนสูงสุด 150 ครั้ง
    // ผู้ใช้พิมพ์เวลาได้ทั้ง 6, 6.00, 6:00 และแบบมี "น."
    const preparedRows = Math.max(rows.length, 151)
    for (let row = 2; row <= preparedRows; row++) {
      for (const column of ['B']) {
        const address = `${column}${row}`
        sheet[address] = { ...(sheet[address] || { t: 's', v: '' }), z: '@' }
      }
    }
    const lastColumn = XLSX.utils.encode_col(HEADERS.length - 1)
    sheet['!ref'] = `A1:${lastColumn}${preparedRows}`
    sheet['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'}
    sheet['!autofilter'] = {ref: `A1:${lastColumn}${Math.max(2, rows.length)}`}
    XLSX.utils.book_append_sheet(workbook,sheet,'รายการรถ')
    // SECTION10_GLOBAL_GROUPS_V2: hidden list + workbook named range.
    // This avoids Excel's 255-character limit for inline list validations.
    // Every newly downloaded template contains the latest active group choices.
    try {
      const groupSheet = XLSX.utils.aoa_to_sheet(activeGroupNames.map(name => [name]))
      groupSheet['!cols'] = [{ wch: 65 }]
      XLSX.utils.book_append_sheet(workbook, groupSheet, 'กลุ่มรถ')
      workbook.Workbook = workbook.Workbook || {}
      workbook.Workbook.Sheets = [{ Hidden: 0 }, { Hidden: 1 }]
      workbook.Workbook.Names = [
        { Name: 'SECTION10_GROUP_CHOICES', Ref: `'กลุ่มรถ'!$A$1:$A$${activeGroupNames.length}` },
      ]

      const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
      const zip = await JSZip.loadAsync(workbookBytes)
      const sheetPath = 'xl/worksheets/sheet1.xml'
      const sheetEntry = zip.file(sheetPath)
      if (!sheetEntry) throw new Error('ไม่พบชีตสำหรับเพิ่ม Dropdown')

      const worksheetXml = await sheetEntry.async('string')
      const autoFilter = worksheetXml.match(/<autoFilter\b[^>]*\/>/)
      if (!autoFilter) throw new Error('ไม่พบตำแหน่งสำหรับเพิ่ม Dropdown ใน Excel')
      if (worksheetXml.includes('<dataValidations')) {
        throw new Error('Excel มี Data Validation อยู่แล้ว กรุณาตรวจสอบเทมเพลต')
      }

      const formula = 'SECTION10_GROUP_CHOICES'
      const dataValidation =
        `<dataValidations count="1">` +
        `<dataValidation type="list" allowBlank="1" showDropDown="0" ` +
        `showInputMessage="1" promptTitle="กลุ่มบัญชีดำ" ` +
        `prompt="เลือกจากรายการกลุ่มรถส่วนกลาง" ` +
        `showErrorMessage="1" errorStyle="stop" ` +
        `errorTitle="กลุ่มบัญชีดำไม่ถูกต้อง" ` +
        `error="กรุณาเลือกกลุ่มบัญชีดำจากรายการ" ` +
        `sqref="G2:G${preparedRows}">` +
        `<formula1>${formula}</formula1>` +
        `</dataValidation></dataValidations>`
      zip.file(sheetPath, worksheetXml.replace(autoFilter[0], autoFilter[0] + dataValidation))

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Blacklist_${center?.code||centerId}_${selectedMonth}_${selectedYear}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setError('')
    } catch (e) {
      setError(`สร้าง Excel พร้อม Dropdown ไม่สำเร็จ: ${e.message}`)
    }
  }
  const uploadExcel=async(file)=>{
    if(!file || !canEdit || loading || saving) return
    if (groupsLoading || groupsError) { setError(groupsError || 'ยังโหลดรายการกลุ่มรถไม่เสร็จ'); return }
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
const importFields = HEADERS.every((name, i) => incomingHeader[i] === name)
        ? FIELDS
        : PREVIOUS_HEADERS.every((name, i) => incomingHeader[i] === name)
          ? PREVIOUS_FIELDS
          : LEGACY_HEADERS.every((name, i) => incomingHeader[i] === name)
            ? LEGACY_FIELDS
            : null
if (!importFields) throw new Error('หัวคอลัมน์ไม่ตรง กรุณาดาวน์โหลด Template ใหม่ (ยังรองรับ Template 9 และ 12 ช่องเดิม)')
      const incoming=rows.slice(1).filter(r=>r.some(c=>safe(c))).map(r=>{
        const v=emptyVehicle()
        
        importFields.forEach((key, i) => {
          if (key === 'blacklistGroup' && safe(r[i]) && !knownGroupNames.includes(safe(r[i]))) {
            throw new Error(`กลุ่มบัญชีดำใน Excel ไม่ตรงกับตัวเลือก: ${safe(r[i])}`)
          }
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
            `นำเข้า Excel สำเร็จ ${incoming.length} ครั้ง ` +
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
      const content={version:1,tableSize,casesPerPage:Number(casesPerPage),vehicles:vehicles.map(v=>({
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
    isReady:()=>valid && !loading && !saving && !error && !groupsLoading && !groupsError,
    hasData:()=>saved,
    exportPdfPages:async()=>{
      const result=[]
      for(let i=0;i<pages.length;i++) result.push({orientation:'landscape',dataUrl:await capture(i)})
      return result
    },
  }))
  const drawPage=(page)=>page.kind==='dashboard'
    ? <AnalyticsPage
        center={center}
        month={selectedMonth}
        year={selectedYear}
        monthCount={vehicles.length}
        a01Count={a01Count}
        b01Count={b01Count}
        groupStats={groupStats}
        allGroupStats={groupStats}
        part={1}
        totalParts={1}
      />
    : page.kind==='summary'
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
    group={page.group}
    events={page.events}
    index={page.index}
    total={groupedVehicles.length}
    caseOffset={page.caseOffset}
    part={page.part}
    totalParts={page.totalParts}
    />
  return <div className={`s10-editor ${canEdit?'editing':''}`}>
    {canEdit && <aside className="s10-side">
      <div className="s10-side-header"><span>หัวข้อ 10</span><h3>รายงานแจ้งเตือนรถบัญชีดำ</h3><p>หน้า Dashboard + ตารางสรุป + รวมทะเบียนซ้ำ (1–4 เคสต่อหน้า)</p></div>
      <div className="s10-side-body">
        {isAdmin && <section className="s10-group-admin">
          <button type="button" className="s10-group-admin-toggle" onClick={() => setShowGroupManager(value => !value)}>
            <span>⚙ จัดการกลุ่มรถ (ทุก สภ.)</span><span>{showGroupManager ? '▴' : '▾'}</span>
          </button>
          {showGroupManager && <div className="s10-group-admin-panel">
            <p>ใช้ร่วมกันทุกศูนย์ · นำออก/เปิดกลับได้ · ลบถาวรเฉพาะกลุ่มที่ไม่เคยมีข้อมูลในรายงาน</p>
            <div className="s10-group-admin-add">
              <input type="text" value={newGroupName} maxLength={100}
                placeholder="ชื่อกลุ่มรถใหม่" onChange={e => setNewGroupName(e.target.value)} />
              <button type="button" disabled={groupActionBusy || groupsLoading || !!groupsError}
                onClick={() => changeGroupCatalog('add')}>+ เพิ่ม</button>
            </div>
            <div className="s10-group-admin-items">
              {blacklistGroupRows.map(row => <div key={row.id} className={!row.is_active ? 'inactive' : ''}>
                <span title={row.name}>{row.name}</span>
                <button type="button" disabled={groupActionBusy || groupsLoading}
                  onClick={() => changeGroupCatalog(row.is_active ? 'deactivate' : 'activate', row)}>
                  {row.is_active ? 'นำออก' : 'เปิดกลับ'}
                </button>
                {!row.is_active && <button type="button" className="s10-group-admin-delete"
                  title="ลบถาวรเฉพาะกลุ่มที่ไม่ถูกใช้ในรายงานย้อนหลัง"
                  disabled={groupActionBusy || groupsLoading || !!groupsError}
                  onClick={() => changeGroupCatalog('delete', row)}>
                  ลบถาวร
                </button>}
              </div>)}
            </div>
            {groupActionMessage && <p className="s10-group-admin-status">{groupActionMessage}</p>}
          </div>}
        </section>}
        {groupsError && <p className="s10-group-admin-error">{groupsError}</p>}
        {groupsLoading && <p className="s10-hint">กำลังโหลดกลุ่มรถส่วนกลาง...</p>}
        <h4>นำเข้ารายการรถ</h4>
        <button type="button" className="s10-secondary" disabled={groupsLoading || !!groupsError} onClick={downloadTemplate}>↓ ดาวน์โหลด Template Excel</button>
        <button type="button" className="s10-secondary" onClick={()=>fileInput.current?.click()} disabled={loading||saving||groupsLoading||!!groupsError}>↑ อัปโหลด Excel</button>
        <input ref={fileInput} type="file" hidden accept=".xlsx,.xls" onChange={e=>{uploadExcel(e.target.files?.[0]);e.target.value=''}}/>
        <p className="s10-hint">Template 11 คอลัมน์ · 1 แถวต่อการแจ้งเตือน · รองรับไฟล์ Excel 9 และ 12 ช่องเดิม · ใช้เดือนรายงานจากระบบหลัก · วันที่ทั้งสองช่องรับ พ.ศ./ค.ศ. · รหัส A01 เรียงก่อน B01</p>
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
<label className="s10-label">จำนวนการแจ้งเตือนต่อหน้ารายละเอียด
  <select
    value={casesPerPage}
    onChange={e => { setCasesPerPage(e.target.value); setDirty(true); setActivePage(0) }}
  >
    {[1, 2, 3, 4].map(n => <option key={n} value={String(n)}>{n} เคสต่อหน้า</option>)}
  </select>
</label>

        <h4>รายการรถเดือน{MONTHS[selectedMonth-1]} ({groupedVehicles.length} คัน · {vehicles.length} ครั้ง)</h4>
        <button type="button" className="s10-secondary" onClick={()=>{const next=emptyVehicle();setVehicles(v=>[...v,next]);setOpenId(next.id);setDirty(true)}}>+ เพิ่มการแจ้งเตือนด้วยตัวเอง</button>
        <div className="s10-case-list">{vehicles.map((v,i)=><div className="s10-case-edit" key={v.id}>
          <button type="button" className="s10-case-toggle" onClick={()=>setOpenId(openId===v.id?null:v.id)}>
            <b>{String(i+1).padStart(2,'0')}</b><span>{v.plate||'ไม่ระบุทะเบียน'}<small>{v.date||'—'} · {v.location||'ไม่ระบุสถานที่'}</small></span><span>{openId===v.id?'▴':'▾'}</span>
          </button>
          {openId===v.id && <div className="s10-case-form">
            {FIELDS.map((key,i)=><label className="s10-label" key={key}>{HEADERS[i]}
              {key === 'blacklistGroup' ? (
                  <select value={v[key] ?? ''} disabled={groupsLoading || !!groupsError} onChange={e => changeVehicle(v.id, key, e.target.value)}>
                    <option value="">-- เลือกกลุ่มบัญชีดำ --</option>
                    {activeGroupNames.map(group => <option key={group} value={group}>{group}</option>)}
                    {!!v[key] && !activeGroupNames.includes(safe(v[key])) && (
                      <option value={v[key]}>{v[key]} (เลิกใช้งาน/ข้อมูลเดิม)</option>
                    )}
                  </select>
                ) : ['behavior','responsePlan','result'].includes(key) ? <textarea rows={2} value={v[key] ?? ''} onChange={e=>changeVehicle(v.id,key,e.target.value)}/>
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
            ภาพประกอบ (1 ภาพต่อการแจ้งเตือน)
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
                JPG / PNG / WEBP · 1 ภาพต่อครั้ง
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

            
            
            <button className="s10-danger" type="button" onClick={()=>{if(window.confirm('ลบการแจ้งเตือนครั้งนี้จากรายงาน?')){setVehicles(list=>list.filter(x=>x.id!==v.id));setOpenId(null);setDirty(true)}}}>ลบการแจ้งเตือนครั้งนี้</button>
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
          {page.kind==='dashboard' ? 'ภาพรวม' : page.kind==='summary' ? `ตาราง ${page.part}/${summaryChunks.length}` : `รถ ${page.index+1}/${groupedVehicles.length}${page.totalParts > 1 ? ` (${page.part}/${page.totalParts})` : ''}`}
        </button>)}
      </div>
      <div className="s10-stage" style={{width:PAPER_W*scale,height:PAPER_H*scale}}>
        {pages.map((page,i)=><div className="s10-stage-paper" key={i} ref={node=>{paperRefs.current[i]=node}} style={{opacity:i===activePage?1:0,transform:`scale(${scale})`,zIndex:i===activePage?2:1}}>{drawPage(page)}</div>)}
      </div>
      <div className="s10-counter">หน้า {activePage+1} / {pages.length}{dirty?' · มีข้อมูลที่ยังไม่ได้บันทึก':''}</div>
    </section>
  </div>
})
// SCT_MONTHLY_LAYOUT_FIX_V5: shorten Bangkok in summary only
