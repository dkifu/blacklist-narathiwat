import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import './Section12Editor.css'

const WIDTH = 1120
const HEIGHT = 792
// แสดงไม่เกิน 5 เคสต่อหน้า A4 แนวนอน
const CASES_PER_PAGE = 5

const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

const SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.',
  'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.',
  'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

const EMPTY_CASE = () => ({
  id: crypto.randomUUID(),
  date: '',
  time: '',
  checkpoint: '',
  district: '',
  target: '',
  allegation: '',
  result: 'pending',
  action: '',
  photo: '',
})

const emptyAnnual = () => Array(12).fill(null)

const numeric = value => {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) return null

  const n = Number(String(value).replace(/,/g, ''))
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

const fmt = value =>
  value == null
    ? '—'
    : Number(value).toLocaleString('th-TH')

const displayYear = year =>
  Number(year) >= 2400 ? Number(year) - 543 : Number(year)

const parseMonth = value => {
  if (value === null || value === undefined) return null

  const str = String(value).trim()
  const index = MONTHS.findIndex(name => name === str)

  if (index !== -1) return index + 1

  const number = Number(str)

  return Number.isInteger(number) &&
    number >= 1 &&
    number <= 12
    ? number
    : null
}

const normalizeAnnual = rows =>
  Array.from({ length: 12 }, (_, i) => numeric(rows?.[i]))

const safeText = value => String(value ?? '').trim()

const normalizeResult = value => {
  const text = safeText(value).toLowerCase()

  if (
    ['match', 'ตรง', 'ใบหน้าตรง', 'ยืนยันตรง']
      .includes(text)
  ) return 'match'

  if (
    ['not_match', 'ไม่ตรง', 'ใบหน้าไม่ตรง', 'ไม่ใช่']
      .includes(text)
  ) return 'not_match'

  return 'pending'
}

const resultLabel = key => ({
  match: 'ใบหน้าตรง',
  not_match: 'ใบหน้าไม่ตรง',
  pending: 'รอตรวจสอบ',
}[key] || 'รอตรวจสอบ')

const sum = values =>
  values.reduce((acc, n) => acc + (numeric(n) || 0), 0)

const getPeakMonth = annual =>
  annual.reduce((best, value, index) => {
    const current = numeric(value)

    if (current == null) return best
    if (!best) return { index, value: current }

    return current > best.value
      ? { index, value: current }
      : best
  }, null)

// บันทึกการปรับสถิติแจ้งเตือนแยกจากเคสและภาพใบหน้า
// อ้างอิงเดือนในปีรายงาน ไม่แก้ content.cases ของเดือนเก่า
const normalAlertEdit = value => {
  if (!value || typeof value !== 'object') return null
  const at = safeText(value.at)

  // Tombstone: ยกเลิกค่าที่เคยแก้ เพื่อกลับไปใช้จำนวนเคสจริง
  if (value.deleted === true) return { deleted: true, at }

  const alerts = numeric(value.alerts)
  const matched = numeric(value.matched)
  const unmatched = numeric(value.unmatched)

  if (alerts == null || matched == null || unmatched == null) {
    return null
  }

  return { alerts, matched, unmatched, at }
}

const isValidAlertEdit = value =>
  !!value && (
    value.deleted === true || (
      Number.isSafeInteger(value.alerts) &&
      Number.isSafeInteger(value.matched) &&
      Number.isSafeInteger(value.unmatched) &&
      value.alerts >= 0 &&
      value.matched >= 0 &&
      value.unmatched >= 0 &&
      value.matched + value.unmatched <= value.alerts
    )
  )

// ==========================================
// IMAGE COMPRESSION
// ==========================================

async function compressedFace(file) {
  if (
    !['image/jpeg', 'image/png', 'image/webp']
      .includes(file.type)
  ) {
    throw new Error('ภาพใบหน้าต้องเป็น JPG, PNG หรือ WEBP')
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error('ภาพต้องไม่เกิน 12 MB')
  }

  const bitmap = await createImageBitmap(file)

  try {
    const ratio = Math.min(
      1,
      560 / bitmap.width,
      340 / bitmap.height
    )

    const canvas = document.createElement('canvas')

    canvas.width = Math.max(
      1,
      Math.round(bitmap.width * ratio)
    )

    canvas.height = Math.max(
      1,
      Math.round(bitmap.height * ratio)
    )

    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const data = canvas.toDataURL('image/jpeg', 0.65)

    canvas.width = 0
    canvas.height = 0

    return data
  } finally {
    bitmap.close()
  }
}

// ==========================================
// YEARLY CHART
// ==========================================

function AnnualChart({ annual }) {
  const values = annual.filter(v => v != null)
  const max = Math.max(1, ...values)

  const step = Math.max(
    1000,
    Math.ceil(max / 4 / 1000) * 1000
  )

  const ceiling = step * 4

  // กำหนดความสูงของกราฟ
  const chartBottom = 510
  const chartHeight = 435

  return (
    <div className="s12-chart">
      <div className="s12-chart-header">
        <strong>
          สถิติจำนวนการตรวจจับใบหน้าสะสมประจำปี
        </strong>
        <span>12 เดือน</span>
      </div>

      <svg
        viewBox="0 0 960 565"
        role="img"
        aria-label="กราฟการตรวจจับใบหน้ารายปี"
      >
        {Array.from({ length: 5 }, (_, i) => {
          const y = chartBottom - i * 110

          return (
            <g key={i}>
              <line
                x1="58"
                x2="950"
                y1={y}
                y2={y}
                stroke="#e6eaf1"
              />

              <text
                x="48"
                y={y + 4}
                textAnchor="end"
                fill="#718096"
                fontSize="12"
              >
                {fmt(i * step)}
              </text>
            </g>
          )
        })}

        {annual.map((n, i) => {
          const x = 74 + i * 72.5

          const h = n == null
            ? 0
            : (n / ceiling) * chartHeight

          return (
            <g key={i}>
              {n != null && n > 0 && (
                <rect
                  x={x}
                  y={chartBottom - h}
                  width="36"
                  height={h}
                  rx="5"
                  fill="#3269d7"
                />
              )}

              {n != null && (
                <text
                  x={x + 18}
                  y={Math.max(28, chartBottom - h - 9)}
                  fontSize="11"
                  fontWeight="700"
                  fill="#184986"
                  textAnchor="middle"
                >
                  {fmt(n)}
                </text>
              )}

              <text
                x={x + 18}
                y="545"
                fontSize="13"
                fontWeight="700"
                fill="#52637b"
                textAnchor="middle"
              >
                {SHORT[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ==========================================
// FACE ALERT CHART — FULL YEAR
// ==========================================

function AlertsChart({ stats }) {
  const values = stats.flatMap(s =>
    s
      ? [
          s.alerts || 0,
          s.matched || 0,
          s.unmatched || 0,
        ]
      : []
  )

  const maxValue = Math.max(0, ...values)

  // กรณีข้อมูลน้อย ใช้ระยะ 0.5
  // กรณีข้อมูลมาก ปรับระยะอัตโนมัติ
  const tickStep =
    maxValue <= 2
      ? 0.5
      : maxValue <= 8
        ? 1
        : Math.ceil(maxValue / 4)

  const yMax = Math.max(
    1.5,
    Math.ceil(maxValue / tickStep) * tickStep
  )

  const ticks = Array.from(
    { length: Math.round(yMax / tickStep) + 1 },
    (_, i) => Number((i * tickStep).toFixed(2))
  )

  const chartLeft = 32
  const chartRight = 752
  const chartTop = 40
  const chartBottom = 290

  const chartHeight = chartBottom - chartTop
  const groupWidth = (chartRight - chartLeft) / 12

  const barWidth = 11
  const barGap = 3

  const series = [
    {
      key: 'alerts',
      name: 'แจ้งเตือน',
      color: '#0ea5e9',
    },
    {
      key: 'matched',
      name: 'ใบหน้าตรง',
      color: '#16a34a',
    },
    {
      key: 'unmatched',
      name: 'ใบหน้าไม่ตรง',
      color: '#e11d48',
    },
  ]

  return (
    <div className="s12-alert-chart">
      <div className="s12-chart-header">
        <strong>
          สถิติการแจ้งเตือน Face ID ประจำปี
        </strong>

        <span>12 เดือน</span>
      </div>

      <svg
        viewBox="0 0 760 360"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="กราฟการแจ้งเตือน Face ID รายปี"
      >
        {/* เส้นกริดและตัวเลขแกน Y */}
        {ticks.map(value => {
          const y =
            chartBottom -
            (value / yMax) * chartHeight

          return (
            <g key={value}>
              <line
                x1={chartLeft}
                x2={chartRight}
                y1={y}
                y2={y}
                stroke="#e5eaf1"
                strokeWidth="1"
              />

              <text
                x={chartLeft - 8}
                y={y + 5}
                textAnchor="end"
                fontSize="13"
                fill="#718096"
              >
                {fmt(value)}
              </text>
            </g>
          )
        })}

        {/* แท่งกราฟครบทั้ง 12 เดือน */}
        {SHORT.map((monthName, i) => {
          const stat = stats[i]

          const groupCenter =
            chartLeft +
            i * groupWidth +
            groupWidth / 2

          const totalBarWidth =
            barWidth * 3 + barGap * 2

          const startX =
            groupCenter - totalBarWidth / 2

          return (
            <g key={monthName}>
              {stat &&
                series.map((item, j) => {
                  const value = Math.max(
                    0,
                    Number(stat[item.key] ?? 0)
                  )

                  const isZero = value === 0

                  const barHeight = isZero
                    ? 3
                    : (value / yMax) * chartHeight

                  const x =
                    startX + j * (barWidth + barGap)

                  return (
                    <rect
                      key={item.key}
                      x={x}
                      y={chartBottom - barHeight}
                      width={barWidth}
                      height={barHeight}
                      rx={isZero ? 1.5 : 3}
                      fill={item.color}
                      opacity={isZero ? 0.85 : 1}
                    >
                      <title>
                        {`${MONTHS[i]}: ${item.name} ${fmt(value)}`}
                      </title>
                    </rect>
                  )
                })}

              <text
                x={groupCenter}
                y="322"
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                fill="#52637b"
              >
                {monthName}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="s12-legend">
        {series.map(item => (
          <span key={item.key}>
            <i
              style={{
                background: item.color,
              }}
            />
            {item.name}
          </span>
        ))}
      </div>

      {/* ========================================
          ตารางสถิติ Face ID ครบ 12 เดือน
          ======================================== */}

      <div className="s12-alerts-year-table-wrap">
        <table
          className="s12-alerts-year-table"
          aria-label="ตารางสถิติแจ้งเตือน Face ID รายปี"
        >
          <thead>
            <tr>
              <th scope="col">รายการ</th>

              {SHORT.map(monthName => (
                <th scope="col" key={monthName}>
                  {monthName}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {series.map(item => (
              <tr key={item.key}>
                <th scope="row">
                  <span className="s12-alerts-year-label">
                    <i
                      style={{
                        backgroundColor: item.color,
                      }}
                    />
                    {item.name}
                  </span>
                </th>

                {SHORT.map((_, index) => {
                  const monthStat = stats[index]

                  const value =
                    monthStat?.[item.key]

                  return (
                    <td key={index}>
                      {value == null ? '' : fmt(value)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

// ==========================================
// PAPER
// ==========================================

function PaperHeading({
  title,
  center,
  month,
  year,
}) {
  const monthLabel =
    MONTHS[Number(month) - 1] || '-'

  return (
    <header className="s12-paper-head">
      <div>
        <h2>{title}</h2>

        <p>
          {center?.name || 'ศูนย์กล้องวงจรปิด'}
          {' · '}
          ประจำเดือน {monthLabel} {year}
        </p>
      </div>
    </header>
  )
}

// ==========================================
// PAGE 1
// ==========================================

function PageAnnual({
  center,
  month,
  year,
  annual,
}) {
  const monthLabel =
    MONTHS[Number(month) - 1] || '-'

  const peak = getPeakMonth(annual)
  const currentMonthValue =
    annual[Number(month) - 1]

  return (
    <div className="s12-paper">
      <PaperHeading
        title="สถิติการตรวจจับใบหน้าด้วยระบบ Face ID"
        center={center}
        month={month}
        year={year}
      />

      <div className="s12-metrics">
        <div
            style={{ '--accent': '#2563eb' }}
            className="s12-metric-peak s12-metric-annual"
          >
            <span>ตรวจจับสะสมประจำปี</span>

            <strong className="s12-peak-month">
              {year}
            </strong>

            <div className="s12-peak-count">
              {fmt(sum(annual))}
              <small>ครั้ง</small>
            </div>
          </div>

        <div
          style={{ '--accent': '#16a34a' }}
          className="s12-metric-peak"
        >
          <span>เดือนที่มีข้อมูลมากที่สุด</span>

          <strong className="s12-peak-month">
            {peak ? MONTHS[peak.index] : '—'}
          </strong>

          <div className="s12-peak-count">
            {peak ? fmt(peak.value) : '—'}
            <small>ครั้ง</small>
          </div>
        </div>

        <div
          style={{ '--accent': '#d97706' }}
          className="s12-metric-peak s12-metric-current"
        >
          <span>ข้อมูลเดือน</span>

          <strong
            className="s12-peak-month"
            style={{ color: '#d97706' }}
          >
            {monthLabel}
          </strong>

          <div
            className="s12-peak-count"
            style={{ color: '#d97706' }}
          >
            {fmt(currentMonthValue)}
            <small >ครั้ง</small>
          </div>
        </div>
      </div>

      <div className="s12-annual-grid">
        <div className="s12-panel s12-annual-table">
          <div className="s12-panel-title">
            ตารางสรุปประจำปี {year}
          </div>

          <table>
            <thead>
              <tr>
                <th>เดือน</th>
                <th>จำนวนตรวจจับ</th>
              </tr>
            </thead>

            <tbody>
              {MONTHS.map((name, i) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    {annual[i] == null
                      ? ''
                      : fmt(annual[i])}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td>รวมสะสม</td>
                <td>{fmt(sum(annual))}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="s12-panel s12-annual-chart">
          <AnnualChart annual={annual} />

          <div className="s12-chart-note">
            เดือนที่ยังไม่มีข้อมูลจะแสดงเป็นช่องว่าง
            ไม่คำนวณเป็นศูนย์
          </div>
        </div>
      </div>
    </div>
  )
}

// ==========================================
// FACE CASE CARD — LEFT COLUMN
// ==========================================

function FaceCaseCard({ item, index }) {
  const dateTime = [
    item.date,
    item.time,
  ].filter(Boolean).join(' ')

  const location = item.checkpoint || ''

  const titleText = [
    item.target || 'ไม่ระบุชื่อเป้าหมาย',
    item.allegation ? `(${item.allegation})` : '',
  ].filter(Boolean).join(' ')

  return (
    <article className="s12-face-case-card">
      {/* ซ้าย = รูป + สถานะ */}
      <div className="s12-face-case-photo-col">
        <div className="s12-face-case-photo">
          {item.photo ? (
            <img
              src={item.photo}
              alt={`ภาพใบหน้าเคส ${index + 1}`}
            />
          ) : (
            <div className="s12-face-case-no-photo">
              <span>ไม่มีภาพใบหน้า</span>
            </div>
          )}
        </div>

        <div
          className={`s12-result s12-face-case-result-under ${item.result}`}
        >
          {resultLabel(item.result)}
        </div>
      </div>

      {/* ขวา = ข้อมูล */}
      <div className="s12-face-case-content">
        <div className="s12-face-case-head">
          <strong title={titleText}>
            {titleText}
          </strong>
        </div>

        <div className="s12-face-case-body">
          <p title={dateTime}>
            <b>แจ้งเตือน:</b>{' '}
            {dateTime || 'ไม่ระบุวันเวลา'}
          </p>

          <p title={location}>
            <b>สถานที่:</b>{' '}
            {location || 'ไม่ระบุสถานที่'}
          </p>

          <p title={item.district || ''}>
            <b>อำเภอ:</b>{' '}
            {item.district || 'ไม่ระบุอำเภอ'}
          </p>

          <p title={item.action || ''}>
            <b>ดำเนินการ:</b>{' '}
            {item.action || 'ยังไม่มีข้อมูล'}
          </p>
        </div>
      </div>
    </article>
  )
}

// ==========================================
// PAGE 2 — CASES 40% / CHART 60%
// ==========================================

function PageCases({
  center,
  month,
  year,
  cases,
  stats,
  page,
  pages,
}) {
  const beginning =
    (page - 1) * CASES_PER_PAGE

  const subset = cases.slice(
    beginning,
    beginning + CASES_PER_PAGE
  )

  const stat = stats[Number(month) - 1]

  const matched = stat?.matched || 0
  const unmatched = stat?.unmatched || 0

  return (
    <div className="s12-paper s12-paper--cases">
      <PaperHeading
        title="สรุปการแจ้งเตือนการตรวจจับใบหน้าตามหมายจับ"
        center={center}
        month={month}
        year={year}
      />

      {/* ==================================
          SUMMARY — 3 CARDS ONLY
         ================================== */}

      <div className="s12-mini-stats">
        <span>
          เคสเดือนนี้
          <b>{cases.length}</b>
        </span>

        <span>
          ใบหน้าตรง
          <b>{matched}</b>
        </span>

        <span>
          ใบหน้าไม่ตรง
          <b>{unmatched}</b>
        </span>
      </div>

      {/* ==================================
          TWO-COLUMN CONTENT
         ================================== */}

      <div className="s12-page2-content">
        {/* LEFT — 40% CASES */}

        <section className="s12-panel s12-page2-cases">
          <div className="s12-panel-title">
            <span className="s12-page2-panel-heading">
              รายการแจ้งเตือน {cases.length} เคส
            </span>

            <span>
              ชุดที่ {page} / {pages}
            </span>
          </div>

          {subset.length > 0 ? (
            <div
              className={
                `s12-page2-case-items ` +
                `s12-case-cards--${subset.length}`
              }
            >
              {subset.map((item, i) => (
                <FaceCaseCard
                  key={item.id}
                  item={item}
                  index={beginning + i}
                />
              ))}
            </div>
          ) : (
            <div className="s12-page2-no-cases">
              ไม่พบรายการแจ้งเตือนใบหน้า
              ตามหมายจับในเดือนนี้
            </div>
          )}
        </section>

        {/* RIGHT — 60% YEARLY CHART */}

        <section className="s12-panel s12-page2-graph">
          <AlertsChart stats={stats} />
        </section>
      </div>
    </div>
  )
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default forwardRef(function Section12Editor({
  report,
  center,
  month,
  year,
  canEdit = false,
  onDataChange,
}, ref) {
  const selectedMonth = Number(month)
  const selectedYear = Number(year)
  const centerId = Number(center?.id)

  const currentMonthCount = (() => {
    const today = new Date()
    const cy = displayYear(year)

    return cy < today.getFullYear()
      ? 12
      : cy === today.getFullYear()
        ? today.getMonth()
        : 0
  })()

  const visibleCount = Math.max(
    0,
    Math.min(selectedMonth, currentMonthCount)
  )

  const [annual, setAnnual] = useState(emptyAnnual)
  const [cases, setCases] = useState([])
  const [otherStats, setOtherStats] = useState(
    Array(12).fill(null)
  )
  // สถิติที่แก้ย้อนหลังล่าสุดจากทุกเดือนของศูนย์/ปีนี้
  const [alertOverrides, setAlertOverrides] = useState({})
  // เก็บเฉพาะ edits ที่ผูกกับรายงานเดือนที่กำลังเปิด
  const [savedReportAlertEdits, setSavedReportAlertEdits] = useState({})
  // รายการที่แก้ในรอบนี้ และยังไม่ได้กดบันทึก
  const [pendingAlertEdits, setPendingAlertEdits] = useState({})
  const [editAlertMonth, setEditAlertMonth] = useState(
    Math.max(0, Number(month) - 2)
  )

  const [isSaved, setIsSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editMonth, setEditMonth] = useState(0)
  const [activePage, setActivePage] = useState(0)
  // Editor's two tabs mirror the two report sections; case detail pages may span further.
  const [editPanel, setEditPanel] = useState(0)
  const [openCase, setOpenCase] = useState(null)

  const previewRef = useRef(null)
  const pageRefs = useRef([])
  const uploadRef = useRef(null)

  const [scale, setScale] = useState(1)

  const validReport =
    !!report?.id &&
    Number(report.center_id) === centerId &&
    Number(report.report_month) === selectedMonth &&
    Number(report.report_year) === selectedYear

  const displayAnnual = annual.map(
    (n, i) => i < visibleCount ? n : null
  )

  const casePages = Math.max(
    1,
    Math.ceil(cases.length / CASES_PER_PAGE)
  )

  const pages = 1 + casePages

  const stats = useMemo(
    () => otherStats.map((saved, i) => {
      // เดือนที่เปิด: ใช้เคสในฟอร์มที่แก้อยู่เป็นค่าเริ่มต้น
      let baseline = saved
      if (i === selectedMonth - 1 && (isSaved || cases.length > 0)) {
        const matched = cases.filter(c => c.result === 'match').length
        const unmatched = cases.filter(c => c.result === 'not_match').length
        baseline = {
          alerts: cases.length,
          matched,
          unmatched,
          pending: cases.length - matched - unmatched,
        }
      }

      // ค่าที่ผู้ใช้กำลังแก้มีลำดับก่อนค่าที่เคยบันทึก
      const key = String(i + 1)
      const override = Object.prototype.hasOwnProperty.call(
        pendingAlertEdits, key
      )
        ? pendingAlertEdits[key]
        : alertOverrides[key]

      if (!override || override.deleted) return baseline

      return {
        alerts: override.alerts,
        matched: override.matched,
        unmatched: override.unmatched,
        pending: Math.max(
          0,
          override.alerts - override.matched - override.unmatched
        ),
      }
    }),
    [
      otherStats,
      alertOverrides,
      pendingAlertEdits,
      cases,
      selectedMonth,
      isSaved,
    ]
  )

  // เลือกแก้ย้อนหลังได้ถึงเดือนก่อนหน้าของเดือนรายงาน
  const alertEditLimit = Math.max(0, selectedMonth - 1)
  const selectedAlertStat = stats[editAlertMonth] ?? {
    alerts: null,
    matched: null,
    unmatched: null,
  }
  const selectedAlertOverride =
    pendingAlertEdits[String(editAlertMonth + 1)] ||
    alertOverrides[String(editAlertMonth + 1)]

  const editPreviousAlertStat = (field, value) => {
    if (editAlertMonth < 0 || editAlertMonth >= alertEditLimit) return
    const raw = String(value).replace(/\D/g, '')
    if (raw.length > 9) return

    const current = stats[editAlertMonth] || {
      alerts: 0, matched: 0, unmatched: 0,
    }
    const key = String(editAlertMonth + 1)

    setPendingAlertEdits(prev => ({
      ...prev,
      [key]: {
        alerts: Number(current.alerts || 0),
        matched: Number(current.matched || 0),
        unmatched: Number(current.unmatched || 0),
        [field]: raw === '' ? 0 : Number(raw),
        at: new Date().toISOString(),
      },
    }))
    setDirty(true)
    setError('')
  }

  const setPreviousAlertZeros = () => {
    if (
      editAlertMonth < 0 ||
      editAlertMonth >= alertEditLimit
    ) return

    const key = String(editAlertMonth + 1)

    setPendingAlertEdits(prev => ({
      ...prev,
      [key]: {
        alerts: 0,
        matched: 0,
        unmatched: 0,
        at: new Date().toISOString(),
      },
    }))

    setDirty(true)
    setError('')
    setMessage('')
  }

  const resetPreviousAlertStat = () => {
    if (editAlertMonth < 0 || editAlertMonth >= alertEditLimit) return
    setPendingAlertEdits(prev => ({
      ...prev,
      [String(editAlertMonth + 1)]: {
        deleted: true,
        at: new Date().toISOString(),
      },
    }))
    setDirty(true)
  }

  // ========================================
  // LOAD SUPABASE
  // ========================================

  useEffect(() => {
    let live = true

    setLoading(true)
    setError('')
    setMessage('')
    setAnnual(emptyAnnual())
    setCases([])
    setOtherStats(Array(12).fill(null))
    setAlertOverrides({})
    setSavedReportAlertEdits({})
    setPendingAlertEdits({})
    setEditAlertMonth(Math.max(0, selectedMonth - 2))
    setIsSaved(false)
    setDirty(false)
    setActivePage(0)
    setEditPanel(0)
    setOpenCase(null)
    setEditMonth(Math.max(0, visibleCount - 1))

    if (!validReport) {
      setLoading(false)
      return () => {
        live = false
      }
    }

    ;(async () => {
      try {
        const {
          data: reports,
          error: reportError,
        } = await supabase
          .from('monthly_reports')
          .select('id, report_month')
          .eq('center_id', centerId)
          .eq('report_year', selectedYear)

        if (reportError) throw reportError

        const byReportId = new Map(
          (reports || []).map(r => [
            String(r.id),
            Number(r.report_month),
          ])
        )

        const ids = [...byReportId.keys()]
        let rows = []

        if (ids.length) {
          const response = await supabase
            .from('monthly_report_sections')
            .select('report_id, content')
            .eq('section_no', 12)
            .in('report_id', ids)

          if (response.error) throw response.error

          rows = response.data || []
        }

        if (!live) return

        const records = rows
          .map(row => ({
            ...row,
            m: byReportId.get(String(row.report_id)),
          }))
          .filter(
            r => r.m && r.content?.version === 1
          )
          .sort((a, b) => a.m - b.m)

        const current = records.find(
          row =>
            String(row.report_id) ===
            String(report.id)
        )

        const lastEarlier = [...records]
          .reverse()
          .find(row => row.m < selectedMonth)

        const source =
          current?.content || lastEarlier?.content

        setAnnual(
          normalizeAnnual(source?.annual)
        )

        setCases(
          Array.isArray(current?.content?.cases)
            ? current.content.cases.map(c => ({
              ...EMPTY_CASE(),
              ...c,
              result: normalizeResult(c.result),
            }))
            : []
        )

        setIsSaved(!!current)

        const next = Array(12).fill(null)

        for (const row of records) {
          if (row.m < 1 || row.m > 12) continue

          const list = Array.isArray(row.content.cases)
            ? row.content.cases
            : []

          const matched = list.filter(
            c =>
              normalizeResult(c.result) === 'match'
          ).length

          const unmatched = list.filter(
            c =>
              normalizeResult(c.result) === 'not_match'
          ).length

          next[row.m - 1] = {
            alerts: list.length,
            matched,
            unmatched,
            pending:
              list.length - matched - unmatched,
          }
        }

        setOtherStats(next)

        // เก็บการแก้ตัวเลขย้อนหลังเป็นรายเดือน ไม่ทับเคส/รูปภาพ
        // หากมีการแก้เดือนเดียวกันจากหลายรายงาน ใช้รายการที่แก้ล่าสุด
        const merged = {}
        const currentLocal = {}

        for (const row of records) {
          const edits = row.content?.alertStatEdits
          if (!edits || typeof edits !== 'object') continue

          for (const [monthKey, rawValue] of Object.entries(edits)) {
            const m = Number(monthKey)
            if (!Number.isInteger(m) || m < 1 || m > 12) continue

            const item = normalAlertEdit(rawValue)
            if (!item) continue
            const key = String(m)

            if (String(row.report_id) === String(report.id)) {
              currentLocal[key] = item
            }

            const previous = merged[key]
            const itemTime = Date.parse(item.at) || 0
            const prevTime = previous ? Date.parse(previous.at) || 0 : -1
            if (!previous || itemTime >= prevTime) merged[key] = item
          }
        }

        setSavedReportAlertEdits(currentLocal)
        setAlertOverrides(merged)
      } catch (e) {
        if (live) {
          setError(
            e.message ||
            'โหลดหัวข้อ 12 ไม่สำเร็จ'
          )
          console.error('Section12 load', e)
        }
      } finally {
        if (live) setLoading(false)
      }
    })()

    return () => {
      live = false
    }
  }, [
    report?.id,
    centerId,
    selectedMonth,
    selectedYear,
    visibleCount,
    validReport,
  ])

  // ========================================
  // PREVIEW SCALE
  // ========================================

  useEffect(() => {
    const node = previewRef.current
    if (!node) return

    const resize = () =>
      setScale(
        Math.min(
          1,
          Math.max(
            0.15,
            (node.clientWidth - 38) / WIDTH
          )
        )
      )

    const observer = new ResizeObserver(resize)

    observer.observe(node)
    resize()

    return () => observer.disconnect()
  }, [canEdit])

  // ========================================
  // EDIT DATA
  // ========================================

  const changeAnnual = (index, value) => {
    setAnnual(prev =>
      prev.map((item, i) =>
        index === i ? value : item
      )
    )

    setDirty(true)
  }

  const editCase = (id, key, value) => {
    setCases(prev =>
      prev.map(c =>
        c.id === id
          ? { ...c, [key]: value }
          : c
      )
    )

    setDirty(true)
  }

  // ========================================
  // DOWNLOAD EXCEL TEMPLATE
  // ========================================

  const downloadExcel = () => {
    const book = XLSX.utils.book_new()

    const yearRows = [
      ['เดือน', 'จำนวนที่ตรวจจับได้'],
      ...MONTHS.map(
        (name, i) => [
          name,
          annual[i] ?? '',
        ]
      ),
    ]

    const annualSheet =
      XLSX.utils.aoa_to_sheet(yearRows)

    annualSheet['!cols'] = [
      { wch: 24 },
      { wch: 28 },
    ]

    XLSX.utils.book_append_sheet(
      book,
      annualSheet,
      'สถิติรายปี'
    )

    const headers = [
      'วันที่แจ้งเตือน',
      'เวลา',
      'ด่านตรวจ',
      'อำเภอ',
      'ชื่อเป้าหมาย',
      'คดีพฤติการณ์',
      'ผลใบหน้า',
      'ผลการดำเนินการ',
    ]

    const caseSheet = XLSX.utils.aoa_to_sheet([
      headers,
      ...cases.map(c => [
        c.date,
        c.time,
        c.checkpoint,
        c.district,
        c.target,
        c.allegation,
        resultLabel(c.result),
        c.action,
      ]),
    ])

    caseSheet['!cols'] = [
      18, 14, 28, 22,
      30, 36, 20, 42,
    ].map(wch => ({ wch }))

    

    XLSX.utils.book_append_sheet(
      book,
      caseSheet,
      'รายการเคส'
    )

    XLSX.writeFile(
      book,
      `FaceID_${center?.code || centerId}_${selectedMonth}_${selectedYear}.xlsx`
    )
  }

  // ========================================
  // IMPORT EXCEL
  // ========================================

  const importExcel = async file => {
    if (
      !file ||
      !canEdit ||
      loading ||
      saving
    ) return

    setError('')
    setMessage('')

    try {
      const book = XLSX.read(
        await file.arrayBuffer(),
        {
          type: 'array',
          cellDates: false,
        }
      )

      if (
        !book.Sheets['สถิติรายปี'] ||
        !book.Sheets['รายการเคส']
      ) {
        throw new Error(
          'ไฟล์ Excel ต้องมีชีต "สถิติรายปี" และ "รายการเคส" จากเทมเพลต'
        )
      }

      const rawYear =
        XLSX.utils.sheet_to_json(
          book.Sheets['สถิติรายปี'],
          {
            header: 1,
            defval: '',
          }
        )

      const nextAnnual = [...annual]
      let count = 0

      for (const row of rawYear.slice(1)) {
        const m = parseMonth(row[0])

        if (!m || m > visibleCount) continue

        const value = numeric(row[1])

        if (
          safeText(row[1]) &&
          value === null
        ) {
          throw new Error(
            `ตัวเลขสถิติเดือน ${MONTHS[m - 1]} ไม่ถูกต้อง`
          )
        }

        nextAnnual[m - 1] = value
        count++
      }

      const rawCases =
        XLSX.utils.sheet_to_json(
          book.Sheets['รายการเคส'],
          {
            header: 1,
            defval: '',
            raw: false,
          }
        )

      // ========================================
    // CHECK EXCEL CASE COLUMNS
    // ========================================

    const expectedHeaders = [
      'วันที่แจ้งเตือน',
      'เวลา',
      'ด่านตรวจ',
      'อำเภอ',
      'ชื่อเป้าหมาย',
      'คดีพฤติการณ์',
      'ผลใบหน้า',
      'ผลการดำเนินการ',
    ]

    const headerRow = rawCases[0] || []

    // รองรับไฟล์ Excel เก่าที่มีคอลัมน์เดือนรายงาน
    // แต่ไม่ใช้เดือนนั้นในการบันทึกอีกต่อไป
    const legacyFormat =
      safeText(headerRow[0]) === 'เดือนรายงาน'

    const offset = legacyFormat ? 1 : 0

    const validHeaders = expectedHeaders.every(
      (header, index) =>
        safeText(headerRow[index + offset]) === header
    )

    if (!validHeaders) {
      throw new Error(
        'คอลัมน์ Excel ไม่ถูกต้อง กรุณาดาวน์โหลด Template ใหม่'
      )
    }

    // ========================================
    // PRESERVE EXISTING CASES
    // ========================================

    const caseKey = c => [
      safeText(c.date),
      safeText(c.time),
      safeText(c.checkpoint),
      safeText(c.target),
    ].join('|')

    const nextCases = [...cases]

    const previous = new Map()

    cases.forEach((c, index) => {
      const key = caseKey(c)
      const positions = previous.get(key) || []

      positions.push(index)
      previous.set(key, positions)
    })

    const usedPositions = new Set()

    let addedCount = 0
    let updatedCount = 0
    let firstImportedId = null

    // ========================================
    // IMPORT CASES TO SELECTED REPORT MONTH
    // ========================================

    for (const row of rawCases.slice(1)) {
      if (row.every(cell => !safeText(cell))) {
        continue
      }

      const importedCase = {
        date: safeText(row[offset + 0]),
        time: safeText(row[offset + 1]),
        checkpoint: safeText(row[offset + 2]),
        district: safeText(row[offset + 3]),
        target: safeText(row[offset + 4]),
        allegation: safeText(row[offset + 5]),
        result: normalizeResult(row[offset + 6]),
        action: safeText(row[offset + 7]),
      }

      if (!importedCase.date && !importedCase.target) {
        continue
      }

      const key = caseKey(importedCase)
      const positions = previous.get(key) || []

      const existingIndex = positions.find(
        index => !usedPositions.has(index)
      )

      if (existingIndex !== undefined) {
        // อัปเดตข้อมูลเคสเดิม
        // รักษา ID และรูปภาพเดิมเอาไว้
        const oldCase = nextCases[existingIndex]

        nextCases[existingIndex] = {
          ...oldCase,
          ...importedCase,
        }

        usedPositions.add(existingIndex)

        if (!firstImportedId) {
          firstImportedId = oldCase.id
        }

        updatedCount++
      } else {
        // เพิ่มเคสใหม่ในเดือนรายงานที่เลือก
        const newCase = {
          ...EMPTY_CASE(),
          ...importedCase,
        }

        nextCases.push(newCase)

        if (!firstImportedId) {
          firstImportedId = newCase.id
        }

        addedCount++
      }
    }

    if (nextCases.length > 100) {
      throw new Error(
        'จำนวนเคสรวมต้องไม่เกิน 100 รายการต่อเดือน'
      )
    }

    // ========================================
    // APPLY IMPORT
    // ========================================

    setAnnual(nextAnnual)

    if (addedCount + updatedCount > 0) {
      setCases(nextCases)
      setOpenCase(firstImportedId)
    }

    setDirty(true)

    setMessage(
      `อ่าน Excel สำเร็จ · ` +
      `เดือน${MONTHS[selectedMonth - 1]} ${selectedYear} · ` +
      `สถิติ ${count} เดือน · ` +
      `เพิ่ม ${addedCount} เคส · ` +
      `อัปเดต ${updatedCount} เคส · ` +
      `รวม ${nextCases.length} เคส · ` +
      `กรุณากดบันทึกข้อมูล`
    )
        } catch (e) {
          setError(
            e.message || 'ไม่สามารถอ่าน Excel ได้'
          )
        }
      }

      // ========================================
      // SAVE
      // ========================================

      const save = async () => {
        if (
          !validReport ||
          !canEdit ||
          saving ||
          loading ||
          error
        ) return

        setSaving(true)
        setMessage('')

    try {
      const invalidMonth = Object.entries(pendingAlertEdits)
        .find(([, value]) => !isValidAlertEdit(value))

      if (invalidMonth) {
        throw new Error(
          `สถิติแจ้งเตือนเดือน${MONTHS[Number(invalidMonth[0]) - 1]} ` +
          'ต้องมีจำนวนใบหน้าตรง + ไม่ตรง ไม่เกินจำนวนแจ้งเตือน'
        )
      }

      // เก็บเฉพาะค่าที่เปลี่ยนในรายงานนี้ ไม่เขียนทับเคสเดือนอื่น
      const nextLocalAlertEdits = {
        ...savedReportAlertEdits,
        ...pendingAlertEdits,
      }

      const content = {
        version: 1,
        annual: normalizeAnnual(annual),
        cases: cases.map(c => ({
          ...c,
          result: normalizeResult(c.result),
        })),
        alertStatEdits: nextLocalAlertEdits,
      }

      const existing = await supabase
        .from('monthly_report_sections')
        .select('section_no')
        .eq('report_id', report.id)
        .eq('section_no', 12)
        .maybeSingle()

      if (existing.error) throw existing.error

      const response = existing.data
        ? await supabase
          .from('monthly_report_sections')
          .update({ content })
          .eq('report_id', report.id)
          .eq('section_no', 12)
        : await supabase
          .from('monthly_report_sections')
          .insert({
            report_id: report.id,
            section_no: 12,
            content,
          })

      if (response.error) throw response.error

      setSavedReportAlertEdits(nextLocalAlertEdits)
      setAlertOverrides(prev => {
        const merged = { ...prev }
        for (const [key, item] of Object.entries(pendingAlertEdits)) {
          merged[key] = item
        }
        return merged
      })
      setPendingAlertEdits({})
      setIsSaved(true)
      setDirty(false)

      setMessage(
        'บันทึกข้อมูลและสถิติแจ้งเตือนย้อนหลังเรียบร้อยแล้ว'
      )

      onDataChange?.()
    } catch (e) {
      setError(
        e.message || 'บันทึกไม่สำเร็จ'
      )
    } finally {
      setSaving(false)
    }
  }

  // ========================================
  // CAPTURE PNG / PDF
  // ========================================

  const capture = async index => {
    const node = pageRefs.current[index]

    if (!node || loading || error) {
      throw new Error(
        'หน้ารายงานหัวข้อ 12 ยังไม่พร้อม'
      )
    }

    if (document.fonts?.ready) {
      await document.fonts.ready
    }

    const beforeTransform =
      node.style.transform

    const beforeOpacity =
      node.style.opacity

    try {
      node.style.transform = 'none'
      node.style.opacity = '1'

      await Promise.all(
        [...node.querySelectorAll('img')]
          .map(img =>
            img.decode().catch(() => {})
          )
      )

      await new Promise(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      )

      const canvas = await html2canvas(
        node,
        {
          width: WIDTH,
          height: HEIGHT,
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          allowTaint: false,
          logging: false,
          scrollX: 0,
          scrollY: 0,
        }
      )

      return canvas.toDataURL('image/png')
    } finally {
      node.style.transform = beforeTransform
      node.style.opacity = beforeOpacity
    }
  }

  const png = async () => {
    if (exporting || loading || saving) return

    setExporting(true)
    setError('')

    try {
      const data = await capture(activePage)

      const link = document.createElement('a')

      link.href = data
      link.download =
        `Monthly_${center?.code || centerId}_` +
        `${selectedMonth}_${selectedYear}_` +
        `Section12_Page${activePage + 1}.png`

      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (e) {
      setError(
        e.message || 'สร้าง PNG ไม่สำเร็จ'
      )
    } finally {
      setExporting(false)
    }
  }

  useImperativeHandle(ref, () => ({
    isReady: () =>
      !loading &&
      !saving &&
      !error &&
      validReport,

    hasData: () =>
      isSaved &&
      (
        displayAnnual.some(v => v != null) ||
        cases.length > 0
      ),

    exportPdfPages: async () => {
      const result = []

      for (let i = 0; i < pages; i++) {
        result.push({
          orientation: 'landscape',
          dataUrl: await capture(i),
        })
      }

      return result
    },
  }))

  const pageLabels = [
    '01 · สถิติรายปี',
    ...Array.from(
      { length: casePages },
      (_, i) =>
        `${String(i + 2).padStart(2, '0')} · เคส ${i + 1}/${casePages}`
    ),
  ]

  const showEditPanel = panel => {
    setEditPanel(panel)
    setActivePage(panel === 0 ? 0 : 1)
  }

  // ========================================
  // RENDER
  // ========================================

  return (
    <div
      className={`s12-editor ${canEdit ? 'editing' : ''}`}
    >
      {canEdit && (
        <aside className="s12-side">
          <div className="s12-side-head">
            <span>หัวข้อ 12</span>
            <h3>รายงานการตรวจจับใบหน้า</h3>
            <p>
              แก้ไขข้อมูลแยก 2 หน้า บันทึกข้อมูลพร้อมกัน
            </p>

            <div className="s12-edit-page-switch" role="group" aria-label="เลือกหน้าแก้ไขหัวข้อ 12">
              <button
                type="button"
                className={editPanel === 0 ? 'active' : ''}
                aria-pressed={editPanel === 0}
                onClick={() => showEditPanel(0)}
              >
                <span>หน้า 1</span>
                <small>สถิติรายปี</small>
              </button>
              <button
                type="button"
                className={editPanel === 1 ? 'active' : ''}
                aria-pressed={editPanel === 1}
                onClick={() => showEditPanel(1)}
              >
                <span>หน้า 2</span>
                <small>รายการเคส / ภาพ</small>
              </button>
            </div>
          </div>

          <div className="s12-side-body">
            {editPanel === 0 && (
              <div className="s12-edit-panel-content">
                <h4>หน้า 1 · สถิติรายปี / Excel</h4>
                <h4>นำเข้าข้อมูล Excel</h4>

            <button
              className="s12-secondary"
              type="button"
              onClick={downloadExcel}
            >
              ↓ ดาวน์โหลด Template Excel
            </button>

            <button
              className="s12-secondary"
              type="button"
              disabled={saving || loading}
              onClick={() =>
                uploadRef.current?.click()
              }
            >
              ↑ อัปโหลด Excel
            </button>

            <input
              ref={uploadRef}
              hidden
              type="file"
              accept=".xlsx,.xls"
              onChange={e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                importExcel(f)
              }}
            />

            <p className="s12-hint">
              Excel มี 2 ชีต: สถิติรายปี 12 เดือน
              และเคสเฉพาะเดือนที่เลือก
              การอัปโหลดจะเตรียมข้อมูลให้ตรวจสอบ
              ก่อนกดบันทึก
            </p>

            <h4>แก้ไขสถิติรายปี</h4>

            <label className="s12-label">
              เลือกเดือน
              <select
                value={editMonth}
                disabled={!visibleCount}
                onChange={e =>
                  setEditMonth(Number(e.target.value))
                }
              >
                {MONTHS
                  .slice(0, visibleCount)
                  .map((m, i) => (
                    <option value={i} key={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </label>

            <label className="s12-label">
              จำนวนที่ตรวจจับได้
              <input
                type="text"
                inputMode="numeric"
                value={annual[editMonth] ?? ''}
                disabled={!visibleCount}
                placeholder="ยังไม่มีข้อมูล"
                onFocus={e =>
                  e.target.select()
                }
                onChange={e => {
                  const raw =
                    e.target.value.replace(/\D/g, '')

                  if (raw.length <= 12) {
                    changeAnnual(
                      editMonth,
                      raw === ''
                        ? null
                        : Number(raw)
                    )
                  }
                }}
              />
            </label>

                <div className="s12-edit-month-help">
                  <strong>สถิติรายปี · ปี {selectedYear}</strong>
                  <p>
                    เลือกเดือนในช่องด้านบนเพื่อแก้สถิติย้อนหลังของปีนี้ได้
                    ส่วนรายการเคสและภาพใบหน้าของเดือนเก่า ให้เลือกเดือนรายงานในหน้าหลักก่อนเปิดหัวข้อ 12
                  </p>
                </div>
              </div>
            )}

            {editPanel === 1 && (
              <div className="s12-edit-panel-content">
                <h4>หน้า 2 · รายการแจ้งเตือน / ภาพใบหน้า</h4>

                <section className="s12-past-stats-editor">
                  <div className="s12-past-stats-heading">
                    <strong>แก้ไขตัวเลขกราฟแจ้งเตือนย้อนหลัง</strong>
                    <span>ปี {selectedYear}</span>
                  </div>

                  {alertEditLimit > 0 ? (
                    <>
                      <label className="s12-label">
                        เลือกเดือนย้อนหลัง
                        <select
                          value={editAlertMonth}
                          onChange={event =>
                            setEditAlertMonth(Number(event.target.value))
                          }
                          disabled={loading || saving}
                        >
                          {MONTHS.slice(0, alertEditLimit).map((name, i) => (
                            <option key={name} value={i}>{name}</option>
                          ))}
                        </select>
                      </label>

                      <div className="s12-past-stats-fields">
                        {[
                          { key: 'alerts', label: 'แจ้งเตือน', color: '#0ea5e9' },
                          { key: 'matched', label: 'ใบหน้าตรง', color: '#16a34a' },
                          { key: 'unmatched', label: 'ใบหน้าไม่ตรง', color: '#e11d48' },
                        ].map(item => (
                          <label
                            className="s12-past-stat-field"
                            key={item.key}
                            style={{ '--stat-color': item.color }}
                          >
                            <span>{item.label}</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={9}
                              value={selectedAlertStat[item.key] ?? ''}
                              disabled={loading || saving}
                              onFocus={event => event.target.select()}
                              onChange={event =>
                                editPreviousAlertStat(item.key, event.target.value)
                              }
                            />
                          </label>
                        ))}
                      </div>

                      <button
                          type="button"
                          className="s12-past-stats-reset"
                          onClick={setPreviousAlertZeros}
                          disabled={loading || saving}
                        >
                          ตั้งค่าเดือนนี้เป็น 0 ทั้ง 3 รายการ
                      </button>

                      {Number(selectedAlertStat.matched || 0) +
                        Number(selectedAlertStat.unmatched || 0) >
                        Number(selectedAlertStat.alerts || 0) && (
                        <p className="s12-past-stats-warning">
                          ผลใบหน้าตรงและไม่ตรงรวมกันต้องไม่เกินจำนวนแจ้งเตือน
                        </p>
                      )}

                      <button
                        type="button"
                        className="s12-past-stats-reset"
                        onClick={resetPreviousAlertStat}
                        disabled={loading || saving || !selectedAlertOverride || selectedAlertOverride.deleted}
                      >
                        ↺ กลับไปใช้จำนวนจากรายการเคสจริง
                      </button>
                      <p className="s12-past-stats-hint">
                        แก้สถิติเดือนก่อน ๆ ได้จากหน้านี้และดูผลในกราฟทันที
                        โดยไม่แก้จำนวนเคสหรือภาพใบหน้าที่บันทึกไว้ในเดือนนั้น
                        กดปุ่มบันทึกหัวข้อ 12 ด้านล่างเพื่อจัดเก็บการเปลี่ยนแปลง
                      </p>
                    </>
                  ) : (
                    <p className="s12-past-stats-hint">
                      ยังไม่มีเดือนก่อนหน้าในปีนี้ให้แก้สถิติย้อนหลัง
                    </p>
                  )}
                </section>

                
                <h4>รายการเคสเดือน{MONTHS[selectedMonth - 1]}</h4>

            <button
              className="s12-secondary"
              type="button"
              onClick={() => {
                const c = EMPTY_CASE()
                setCases(prev => [...prev, c])
                setOpenCase(c.id)
                setDirty(true)
              }}
            >
              + เพิ่มเคสด้วยตัวเอง
            </button>

            <div className="s12-case-list">
              {cases.map((c, i) => (
                <div
                  key={c.id}
                  className="s12-case-edit"
                >
                  <button
                    type="button"
                    className="s12-case-toggle"
                    onClick={() =>
                      setOpenCase(
                        openCase === c.id
                          ? null
                          : c.id
                      )
                    }
                  >
                    <b>
                      {String(i + 1).padStart(2, '0')}
                    </b>

                    <span>
                      {c.target || `เคสที่ ${i + 1}`}
                      <small>
                        {c.date || 'ยังไม่ระบุวัน'}
                        {' · '}
                        {resultLabel(c.result)}
                        {' '}
                        {c.photo ? '· มีรูป' : ''}
                      </small>
                    </span>

                    <strong>
                      {openCase === c.id ? '⌃' : '⌄'}
                    </strong>
                  </button>

                  {openCase === c.id && (
                    <div className="s12-case-form">
                      {[
                        ['date', 'วันที่แจ้งเตือน'],
                        ['time', 'เวลา'],
                        ['checkpoint', 'ด่านตรวจ'],
                        ['district', 'อำเภอ'],
                        ['target', 'ชื่อเป้าหมาย'],
                        ['allegation', 'คดี/พฤติการณ์'],
                        ['action', 'ผลการดำเนินการ'],
                      ].map(([key, title]) => (
                        <label
                          key={key}
                          className="s12-label"
                        >
                          {title}
                          <input
                            type="text"
                            value={c[key] || ''}
                            onChange={e =>
                              editCase(
                                c.id,
                                key,
                                e.target.value
                              )
                            }
                          />
                        </label>
                      ))}

                      <label className="s12-label">
                        ผลตรวจใบหน้า
                        <select
                          value={c.result}
                          onChange={e =>
                            editCase(
                              c.id,
                              'result',
                              e.target.value
                            )
                          }
                        >
                          <option value="pending">
                            รอตรวจสอบ
                          </option>
                          <option value="match">
                            ใบหน้าตรง
                          </option>
                          <option value="not_match">
                            ใบหน้าไม่ตรง
                          </option>
                        </select>
                      </label>

                      <div className="s12-face-upload">
                        <span className="s12-face-upload-title">
                          ภาพใบหน้า (JPG / PNG / WEBP)
                        </span>

                        <label
                          className={`s12-file-picker ${
                            c.photo ? 'has-file' : ''
                          }`}
                        >
                          <input
                            className="s12-file-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={async e => {
                              const file = e.target.files?.[0]
                              e.target.value = ''

                              if (!file) return

                              try {
                                const photo = await compressedFace(file)

                                setCases(prev =>
                                  prev.map(item =>
                                    item.id === c.id
                                      ? {
                                          ...item,
                                          photo,
                                          photoName: file.name,
                                        }
                                      : item
                                  )
                                )

                                setDirty(true)
                                setError('')
                              } catch (err) {
                                setError(err.message)
                              }
                            }}
                          />

                          <span className="s12-file-picker-icon">
                            {c.photo ? '✓' : '↑'}
                          </span>

                          <span className="s12-file-picker-info">
                            <strong>
                              {c.photo
                                ? 'เปลี่ยนภาพใบหน้า'
                                : 'เลือกภาพใบหน้า'}
                            </strong>

                            <small>
                              {c.photo
                                ? c.photoName || 'มีภาพใบหน้าแล้ว'
                                : 'คลิกเพื่อเลือกไฟล์ภาพ'}
                            </small>

                            {!c.photo && (
                              <small className="s12-file-limit">
                                ขนาดไม่เกิน 12 MB
                              </small>
                            )}
                          </span>
                        </label>

                        {c.photo && (
                          <div className="s12-file-success">
                            ✓ เพิ่มภาพใบหน้าแล้ว
                          </div>
                        )}
                      </div>

                      {c.photo && (
                        <img
                          className="s12-face-preview"
                          src={c.photo}
                          alt="ภาพใบหน้า"
                        />
                      )}

                      <button
                        type="button"
                        className="s12-danger"
                        onClick={() => {
                          if (
                            !window.confirm(
                              'ลบเคสนี้จากรายการที่กำลังแก้ไข?'
                            )
                          ) return

                          setCases(prev =>
                            prev.filter(
                              item => item.id !== c.id
                            )
                          )

                          setOpenCase(null)
                          setDirty(true)
                        }}
                      >
                        ลบเคสนี้
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
              </div>
            )}

            {dirty && (
              <div className="s12-unsaved">
                มีข้อมูลเปลี่ยนแปลงที่ยังไม่ได้บันทึก
              </div>
            )}

            <button
              className="s12-save"
              type="button"
              disabled={
                loading ||
                saving ||
                !!error ||
                !validReport
              }
              onClick={save}
            >
              {saving
                ? 'กำลังบันทึก...'
                : `บันทึกหัวข้อ 12 · ${MONTHS[selectedMonth - 1]}`}
            </button>

            {message && (
              <p className="s12-message">
                {message}
              </p>
            )}

            {error && (
              <p className="s12-error">
                {error}
                <button
                  type="button"
                  onClick={() =>
                    setError('')
                  }
                >
                  ปิด
                </button>
              </p>
            )}

            <div className="s12-export">
              <h4>ส่งออกรายงาน</h4>

              <button
                className="s12-secondary"
                type="button"
                disabled={exporting || loading}
                onClick={png}
              >
                ↓ บันทึกหน้าที่เลือกเป็น PNG
              </button>

              <small>
                รวม PDF ทุกหน้าได้จากปุ่ม PDF กลางของระบบ
              </small>
            </div>
          </div>
        </aside>
      )}

      <div
        className="s12-preview"
        ref={previewRef}
      >
        <div className="s12-tabs">
          {pageLabels.map((title, i) => (
            <button
              key={i}
              type="button"
              className={
                activePage === i ? 'active' : ''
              }
              onClick={() => {
                setActivePage(i)
                setEditPanel(i === 0 ? 0 : 1)
              }}
            >
              {title}
            </button>
          ))}
        </div>

        {loading && (
          <div className="s12-loading">
            กำลังโหลดข้อมูล...
          </div>
        )}

        {!loading && error && !canEdit && (
          <div className="s12-loading">
            {error}
          </div>
        )}

        <div
          className="s12-stage"
          style={{
            width: WIDTH * scale,
            height: HEIGHT * scale,
          }}
        >
          {pageLabels.map((_, i) => (
            <div
              key={i}
              className="s12-sheet"
              ref={el => {
                pageRefs.current[i] = el
              }}
              style={{
                transform: `scale(${scale})`,
                opacity: activePage === i ? 1 : 0,
                zIndex: activePage === i ? 2 : 1,
              }}
            >
              {i === 0 ? (
                <PageAnnual
                  center={center}
                  month={month}
                  year={year}
                  annual={displayAnnual}
                />
              ) : (
                <PageCases
                  center={center}
                  month={month}
                  year={year}
                  cases={cases}
                  stats={stats}
                  page={i}
                  pages={casePages}
                />
              )}
            </div>
          ))}
        </div>

        <div className="s12-page-counter">
          หน้า {activePage + 1} / {pages}
          {' '}
          {dirty
            ? '· มีรายการแก้ไขที่ยังไม่ได้บันทึก'
            : ''}
        </div>
      </div>
    </div>
  )
})