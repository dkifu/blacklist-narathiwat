
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import html2canvas from 'html2canvas'
import { supabase } from '../../lib/supabase'
import './Section06Editor.css'

const PAPER_W = 1120
const PAPER_H = 792

const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

const PROBLEMS = [
  { key: 'branches', name: 'กิ่งต้นไม้', color: '#2563eb' },
  { key: 'dark', name: 'กล้องมืด', color: '#7c3aed' },
  { key: 'direction', name: 'ปรับทิศทาง', color: '#d97706' },
  { key: 'lighting', name: 'ไฟส่องไม่ถึง', color: '#0891b2' },
  { key: 'sky', name: 'เห็นฟ้า', color: '#16a34a' },
  { key: 'obstruction', name: 'สิ่งกีดขวางกล้อง', color: '#dc2626' },
  { key: 'material', name: 'สายเคเบิล/วัสดุบังมุมกล้อง', color: '#9f1744' },
]

const emptyData = () => ({
  normal: 0,
  issues: Object.fromEntries(
    PROBLEMS.map(item => [item.key, 0])
  ),
  parameter: {
    dayNormal: 0,
    dayAbnormal: 0,
    nightNormal: 0,
    nightAbnormal: 0,
  },
})

const number = value => {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : 0
}

const fmt = value =>
  number(value).toLocaleString('th-TH')

const pct = (part, total) =>
  total > 0 ? (part / total) * 100 : 0

const displayPct = value =>
  `${Number(value).toFixed(1).replace(/\.0$/, '')}%`

// ==========================================
// INPUT — ตัวเลขไม่มีปุ่ม spinner
// ==========================================

function NumberField({
  title,
  value,
  onChange,
  disabled,
}) {
  return (
    <label className="section06-field">
      <span>{title}</span>

      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value ?? ''}
        disabled={disabled}
        placeholder="0"
        onFocus={event => event.target.select()}
        onChange={event => {
          const raw = event.target.value.replace(/\D/g, '')

          if (raw.length > 9) return

          onChange(raw === '' ? null : Number(raw))
        }}
        onBlur={() => {
          if (value === null) onChange(0)
        }}
      />
    </label>
  )
}

// ==========================================
// การ์ดสรุปหน้า 1
// ==========================================

function SummaryCard({
  title,
  value,
  color,
  note,
}) {
  return (
    <div
      className="section06-summary-card"
      style={{ '--metric-color': color }}
    >
      <span>{title}</span>

      <div>
        <strong>{fmt(value)}</strong>
        <small>มุม</small>
      </div>

      {note && <em>{note}</em>}
    </div>
  )
}

// ==========================================
// การ์ดรวมกลางวัน / กลางคืน หน้า 2
// ==========================================

function ParameterSummary({
  period,
  normal,
  abnormal,
  color,
  badColor,
}) {
  const total = number(normal) + number(abnormal)

  return (
    <section
      className="section06-param-summary"
      style={{
        '--param-color': color,
        '--param-bad': badColor,
      }}
    >
      <div className="section06-param-summary-head">
        <strong>PARAMETER {period}</strong>
        <span>รวม {fmt(total)} มุม</span>
      </div>

      <div className="section06-param-summary-stats">
        <div>
          <span>ตั้งค่าปกติ</span>
          <strong className="normal">
            {fmt(normal)} <small>มุม</small>
          </strong>
        </div>

        <div>
          <span>ตั้งค่าผิดปกติ</span>
          <strong className="abnormal">
            {fmt(abnormal)} <small>มุม</small>
          </strong>
        </div>
      </div>
    </section>
  )
}

// ==========================================
// DONUT — ใช้ร่วมกันทั้งหน้า 1 และหน้า 2
// ==========================================

function RingChart({
  slices,
  title,
  centerValue,
  centerLabel,
  centerNote,
  showSlicePercent = false,
  legendPercent = false,
}) {
  const activeSlices = slices.filter(
    item => number(item.value) > 0
  )

  const total = activeSlices.reduce(
    (sum, item) => sum + number(item.value),
    0
  )

  // วงหนาเข้าด้านในตามรูปแบบที่ตกลงกัน
  const radius = 76
  const thickness = 43

  let running = 0

  const arcs = activeSlices.map(item => {
    const part = pct(number(item.value), total)
    const start = running

    running += part

    const radians =
      ((start + part / 2) * 3.6 - 90) *
      Math.PI / 180

    return {
      ...item,
      part,
      start,
      x: 120 + Math.cos(radians) * radius,
      y: 120 + Math.sin(radians) * radius,
    }
  })

  return (
    <div className="section06-ring-block">
      <div className="section06-ring-holder">

        <svg
          className="section06-ring"
          viewBox="0 0 240 240"
          role="img"
          aria-label={title}
        >
          <circle
            cx="120"
            cy="120"
            r={radius}
            stroke="#e8edf4"
            strokeWidth={thickness}
            fill="none"
          />

          {total > 0 && (
            <g transform="rotate(-90 120 120)">
              {arcs.map(item => (
                <circle
                  key={item.key}
                  cx="120"
                  cy="120"
                  r={radius}
                  fill="none"
                  pathLength={100}
                  stroke={item.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${item.part} ${100 - item.part}`}
                  strokeDashoffset={-item.start}
                >
                  <title>
                    {item.label}: {fmt(item.value)}
                    {' '}({displayPct(item.part)})
                  </title>
                </circle>
              ))}
            </g>
          )}

          {showSlicePercent &&
            arcs
              .filter(item => item.part >= 9)
              .map(item => (
                <text
                  key={`pct-${item.key}`}
                  x={item.x}
                  y={item.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#ffffff"
                  fontSize={item.part >= 20 ? 10.5 : 9.5}
                  fontWeight="900"
                  stroke="rgba(15,23,42,.15)"
                  strokeWidth="1.5"
                  paintOrder="stroke"
                >
                  {displayPct(item.part)}
                </text>
              ))}
        </svg>

        <div className="section06-ring-center">
          <span>{centerLabel || title}</span>
          <strong>{centerValue ?? fmt(total)}</strong>
          <small>{centerNote}</small>
        </div>
      </div>

      <div className="section06-ring-legend">
        {activeSlices.map(item => (
          <div
            className="section06-legend-item"
            key={item.key}
          >
            <i style={{ background: item.color }} />
            <span>{item.label}</span>

            {legendPercent && (
              <b>
                {displayPct(
                  pct(number(item.value), total)
                )}
              </b>
            )}
          </div>
        ))}

        {total === 0 && (
          <div className="section06-legend-empty">
            ยังไม่มีข้อมูล
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// SECTION 06 — MAIN COMPONENT
// ==========================================

export default forwardRef(function Section06Editor({
  report,
  center,
  month,
  year,
  canEdit = false,
  onDataChange,
}, ref) {

  const previewRef = useRef(null)
  const pageRefs = useRef([])

  const [scale, setScale] = useState(1)
  const [activePage, setActivePage] = useState(1)
  const [data, setData] = useState(emptyData)

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [rowExists, setRowExists] = useState(false)
  const [hasStoredData, setHasStoredData] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(0)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')

  const monthLabel =
    MONTHS[Number(month) - 1] || '-'

  const validReport =
    !!report?.id &&
    String(report.center_id) === String(center?.id) &&
    Number(report.report_month) === Number(month) &&
    Number(report.report_year) === Number(year)

  const normal = number(data.normal)

  const issueItems = PROBLEMS.map(item => ({
    ...item,
    value: number(data.issues?.[item.key]),
  }))

  const issueTotal = issueItems.reduce(
    (sum, item) => sum + item.value,
    0
  )

  const total = normal + issueTotal

  const activeIssues = issueItems.filter(
    item => item.value > 0
  ).length

  const dayNormal =
    number(data.parameter?.dayNormal)

  const dayAbnormal =
    number(data.parameter?.dayAbnormal)

  const nightNormal =
    number(data.parameter?.nightNormal)

  const nightAbnormal =
    number(data.parameter?.nightAbnormal)

  const dayTotal = dayNormal + dayAbnormal
  const nightTotal = nightNormal + nightAbnormal

  const disabled =
    loading || saving || !!loadError

  // ========================================
  // LOAD FROM SUPABASE
  // ========================================

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setLoadError('')
      setData(emptyData())
      setHasUnsavedChanges(false)
      setRowExists(false)
      setHasStoredData(false)
      setMessage('')

      if (!report?.id) {
        setLoading(false)
        return
      }

      try {
        const { data: row, error } = await supabase
          .from('monthly_report_sections')
          .select('content')
          .eq('report_id', report.id)
          .eq('section_no', 6)
          .maybeSingle()

        if (error) throw error
        if (!active) return

        setRowExists(!!row)

        if (row?.content?.version === 1) {
          const stored = row.content

          setHasStoredData(true)

          setData({
            normal: number(stored.normal),

            issues: Object.fromEntries(
              PROBLEMS.map(item => [
                item.key,
                number(stored.issues?.[item.key]),
              ])
            ),

            parameter: {
              dayNormal:
                number(stored.parameter?.dayNormal),

              dayAbnormal:
                number(stored.parameter?.dayAbnormal),

              nightNormal:
                number(stored.parameter?.nightNormal),

              nightAbnormal:
                number(stored.parameter?.nightAbnormal),
            },
          })
        }
      } catch (error) {
        if (!active) return

        console.error('Section 06 load error:', error)

        setLoadError(
          error.message ||
          'โหลดข้อมูลหัวข้อ 06 ไม่สำเร็จ'
        )
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [report?.id])

  // ========================================
  // SCALE PREVIEW
  // ========================================

  useEffect(() => {
    const node = previewRef.current

    if (!node) return

    const resize = () => {
      setScale(
        Math.min(
          1,
          Math.max(
            0.1,
            (node.clientWidth - 40) / PAPER_W
          )
        )
      )
    }

    const observer = new ResizeObserver(resize)

    observer.observe(node)
    resize()

    return () => observer.disconnect()
  }, [canEdit])

  // ========================================
  // EDIT DATA
  // ========================================

  const setNormal = value => {
    setHasUnsavedChanges(true)

    setData(previous => ({
      ...previous,
      normal: value,
    }))
  }

  const setIssue = (key, value) => {
    setHasUnsavedChanges(true)

    setData(previous => ({
      ...previous,
      issues: {
        ...previous.issues,
        [key]: value,
      },
    }))
  }

  const setParam = (key, value) => {
    setHasUnsavedChanges(true)

    setData(previous => ({
      ...previous,
      parameter: {
        ...previous.parameter,
        [key]: value,
      },
    }))
  }

  // ========================================
  // SAVE BOTH PAGES
  // ========================================

  const save = async () => {
    if (!canEdit || !validReport || disabled) return

    setSaving(true)
    setMessage('')

    try {
      const content = {
        version: 1,
        normal,

        issues: Object.fromEntries(
          issueItems.map(item => [
            item.key,
            item.value,
          ])
        ),

        parameter: {
          dayNormal,
          dayAbnormal,
          nightNormal,
          nightAbnormal,
        },
      }

      let error

      if (rowExists) {
        ({ error } = await supabase
          .from('monthly_report_sections')
          .update({ content })
          .eq('report_id', report.id)
          .eq('section_no', 6))
      } else {
        ({ error } = await supabase
          .from('monthly_report_sections')
          .insert({
            report_id: report.id,
            section_no: 6,
            content,
          }))
      }

      if (error) throw error

      setRowExists(true)
      setHasStoredData(true)
      setHasUnsavedChanges(false)

      setMessageType('success')
      setMessage(
        'บันทึกข้อมูลหัวข้อ 06 ทั้งสองหน้าเรียบร้อยแล้ว'
      )

      onDataChange?.()
    } catch (error) {
      console.error('Section 06 save error:', error)

      setMessageType('error')
      setMessage(
        error.message ||
        'บันทึกข้อมูลไม่สำเร็จ'
      )
    } finally {
      setSaving(false)
    }
  }

  // ========================================
  // EXPORT PAGE AS PNG
  // ========================================

  const capturePage = async index => {
    const node = pageRefs.current[index]

    if (!node || loading || loadError) {
      throw new Error('หน้ารายงาน 06 ยังไม่พร้อม')
    }

    if (document.fonts?.ready) {
      await document.fonts.ready
    }

    const previousTransform = node.style.transform
    const previousOrigin = node.style.transformOrigin

    try {
      node.style.transform = 'none'
      node.style.transformOrigin = 'top left'

      await new Promise(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      )

      const canvas = await html2canvas(node, {
        width: PAPER_W,
        height: PAPER_H,
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: false,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: PAPER_W,
        windowHeight: PAPER_H,
      })

      return canvas.toDataURL('image/png')
    } finally {
      node.style.transform = previousTransform
      node.style.transformOrigin = previousOrigin
    }
  }

  const downloadPng = async page => {
    if (exporting || disabled) return

    setExporting(page)
    setMessage('')

    try {
      const dataUrl = await capturePage(page - 1)

      const rawName =
        center?.code ||
        center?.name ||
        'CENTER'

      const safeName = String(rawName)
        .replace(/[\\/:*?"<>|]/g, '_')

      const link = document.createElement('a')

      link.href = dataUrl
      link.download =
        `Monthly_Report_${safeName}_${month}_${year}_Section06_Page${page}.png`

      document.body.appendChild(link)
      link.click()
      link.remove()

      setMessageType('success')
      setMessage(
        `ดาวน์โหลด PNG หัวข้อ 06 หน้า ${page} เรียบร้อยแล้ว`
      )
    } catch (error) {
      setMessageType('error')

      setMessage(
        error.message ||
        'ส่งออก PNG ไม่สำเร็จ'
      )
    } finally {
      setExporting(0)
    }
  }

  // ========================================
  // PDF CENTRAL EXPORT API
  // ========================================

  useImperativeHandle(ref, () => ({
    isReady: () =>
      !loading &&
      !loadError &&
      !!center?.id,

    hasData: () =>
      !loading &&
      !loadError &&
      validReport &&
      hasStoredData,

    exportPdfPages: async () => [
      {
        orientation: 'landscape',
        dataUrl: await capturePage(0),
      },
      {
        orientation: 'landscape',
        dataUrl: await capturePage(1),
      },
    ],
  }))

  const heading = title => (
    <header className="section06-heading">
      <div>
        <h2>{title}</h2>
        <p>
          {center?.name || 'ศูนย์กล้องวงจรปิด'}
          {' · '}
          {monthLabel} {year}
        </p>
      </div>
    </header>
  )

  // ========================================
  // UI
  // ========================================

  return (
    <div
      className={`section06-editor ${
        canEdit ? 'section06-editing' : ''
      }`}
    >
      {canEdit && (
        <aside className="section06-panel">
          <div className="section06-panel-header">
            <span>หัวข้อ 06</span>

            <h3>
              ตารางสรุปรายงานมุมภาพประจำเดือน
            </h3>

            <p>
              กรอกข้อมูลทั้งสองหน้า
              แล้วบันทึกพร้อมกัน
            </p>

            <div className="section06-page-switch">
              <button
                type="button"
                className={activePage === 1 ? 'active' : ''}
                onClick={() => setActivePage(1)}
              >
                <span>หน้า 1</span>
                <small>สถานะมุมภาพ</small>
              </button>

              <button
                type="button"
                className={activePage === 2 ? 'active' : ''}
                onClick={() => setActivePage(2)}
              >
                <span>หน้า 2</span>
                <small>Parameter กล้อง</small>
              </button>
            </div>
          </div>

          <div className="section06-panel-body">
            {activePage === 1 && (
              <>
                <h4>หน้า 1 · สถานะมุมภาพ</h4>

                <NumberField
                  title="มุมกล้องปกติ (มุม)"
                  value={data.normal}
                  onChange={setNormal}
                  disabled={disabled}
                />

                <p className="section06-panel-help">
                  จำนวนที่ต้องปรับปรุงจะคำนวณจาก
                  รายการปัญหาด้านล่างโดยอัตโนมัติ
                </p>

                {PROBLEMS.map(item => (
                  <NumberField
                    key={item.key}
                    title={item.name}
                    value={data.issues?.[item.key]}
                    onChange={value =>
                      setIssue(item.key, value)
                    }
                    disabled={disabled}
                  />
                ))}
              </>
            )}

            {activePage === 2 && (
              <>
                <h4>หน้า 2 · Parameter กล้อง</h4>

                <NumberField
                  title="กลางวัน · ตั้งค่าปกติ"
                  value={data.parameter?.dayNormal}
                  onChange={value =>
                    setParam('dayNormal', value)
                  }
                  disabled={disabled}
                />

                <NumberField
                  title="กลางวัน · ตั้งค่าผิดปกติ"
                  value={data.parameter?.dayAbnormal}
                  onChange={value =>
                    setParam('dayAbnormal', value)
                  }
                  disabled={disabled}
                />

                <NumberField
                  title="กลางคืน · ตั้งค่าปกติ"
                  value={data.parameter?.nightNormal}
                  onChange={value =>
                    setParam('nightNormal', value)
                  }
                  disabled={disabled}
                />

                <NumberField
                  title="กลางคืน · ตั้งค่าผิดปกติ"
                  value={data.parameter?.nightAbnormal}
                  onChange={value =>
                    setParam('nightAbnormal', value)
                  }
                  disabled={disabled}
                />

                {total > 0 &&
                  (
                    (dayTotal > 0 && dayTotal !== total) ||
                    (nightTotal > 0 && nightTotal !== total)
                  ) && (
                    <p className="section06-panel-warning">
                      จำนวน Parameter กลางวัน/กลางคืน
                      ไม่เท่ากับมุมภาพรวม
                      โปรดตรวจสอบหากต้องการใช้
                      ฐานจำนวนกล้องเดียวกัน
                    </p>
                  )}
              </>
            )}

            <div
              className={`section06-save-state ${
                hasUnsavedChanges
                  ? 'unsaved'
                  : hasStoredData
                    ? 'saved'
                    : ''
              }`}
            >
              {hasUnsavedChanges
                ? '● มีข้อมูลที่ยังไม่ได้บันทึก'
                : hasStoredData
                  ? '✓ บันทึกข้อมูลแล้ว'
                  : 'ยังไม่ได้บันทึกข้อมูล'}
            </div>

            <button
              className="section06-save"
              type="button"
              onClick={save}
              disabled={disabled || !validReport}
            >
              {saving
                ? 'กำลังบันทึก...'
                : 'บันทึกข้อมูลทั้ง 2 หน้า'}
            </button>

            <div className="section06-export-controls">
              <h4>ส่งออกรายงาน</h4>

              <button
                type="button"
                disabled={disabled || exporting !== 0}
                onClick={() => downloadPng(1)}
              >
                {exporting === 1
                  ? 'กำลังสร้างภาพ...'
                  : '↓ บันทึก PNG หน้า 1'}
              </button>

              <button
                type="button"
                disabled={disabled || exporting !== 0}
                onClick={() => downloadPng(2)}
              >
                {exporting === 2
                  ? 'กำลังสร้างภาพ...'
                  : '↓ บันทึก PNG หน้า 2'}
              </button>

              <small>
                PDF ทั้ง 2 หน้าจะรวมผ่าน
                ปุ่มดาวน์โหลด PDF ของรายงานหลัก
              </small>
            </div>

            {message && (
              <p
                className={`section06-message ${messageType}`}
                role="status"
              >
                {message}
              </p>
            )}

            <p className="section06-panel-help">
              {loading
                ? 'กำลังโหลดข้อมูล...'
                : loadError ||
                  'พรีวิวเปลี่ยนทันที ส่วนข้อมูลจะจัดเก็บเมื่อกดบันทึก'}
            </p>
          </div>
        </aside>
      )}

      <div
        className="section06-preview"
        ref={previewRef}
      >
        {!canEdit && (
          <div className="section06-view-switch">
            <button
              type="button"
              className={activePage === 1 ? 'active' : ''}
              onClick={() => setActivePage(1)}
            >
              หน้า 1 · สถานะมุมภาพ
            </button>

            <button
              type="button"
              className={activePage === 2 ? 'active' : ''}
              onClick={() => setActivePage(2)}
            >
              หน้า 2 · Parameter
            </button>
          </div>
        )}

        <div
          className="section06-page-stack"
          style={{
            width: PAPER_W * scale,
            height: PAPER_H * scale,
          }}
        >

          {/* ==================== PAGE 1 ==================== */}

          <div
            className="section06-stage"
            style={{
              width: PAPER_W * scale,
              height: PAPER_H * scale,
              zIndex: activePage === 1 ? 2 : 1,
            }}
          >
            <article
              className="section06-paper section06-paper-one"
              ref={node => {
                pageRefs.current[0] = node
              }}
              style={{
                transform: `scale(${scale})`,
              }}
            >
              {heading(
                'ตารางสรุปรายงานมุมภาพประจำเดือน'
              )}

              <div className="section06-summary section06-summary-three">
                <SummaryCard
                  title="มุมกล้องภาพรวมทั้งหมด"
                  value={total}
                  color="#9f1744"
                />

                <SummaryCard
                  title="มุมกล้องปกติ"
                  value={normal}
                  color="#0f766e"
                  note={
                    total
                      ? `${displayPct(pct(normal, total))} ของทั้งหมด`
                      : 'ยังไม่มีข้อมูล'
                  }
                />

                <SummaryCard
                  title="มุมกล้องต้องปรับปรุง"
                  value={issueTotal}
                  color="#d97706"
                  note={`${activeIssues} ประเภทปัญหา`}
                />
              </div>

              <section className="section06-box section06-compare">
                <div className="section06-box-header">
                  <div>
                    <h3>
                      เปรียบเทียบสถานะมุมภาพรวม
                    </h3>
                    <p>
                      จำนวนมุมกล้องปกติและ
                      มุมกล้องที่ต้องปรับปรุง
                    </p>
                  </div>

                  <span>หน่วย : มุม</span>
                </div>

                <div className="section06-bars">
                  {[
                    {
                      label: 'มุมกล้องปกติ',
                      value: normal,
                      color: '#0f766e',
                    },
                    {
                      label: 'ต้องปรับปรุง',
                      value: issueTotal,
                      color: '#d97706',
                    },
                  ].map(item => (
                    <div
                      className="section06-bar-row"
                      key={item.label}
                    >
                      <b>{item.label}</b>

                      <div className="section06-bar-track">
                        <div
                          style={{
                            width: `${pct(item.value, total)}%`,
                            background: item.color,
                          }}
                        />
                      </div>

                      <strong>{fmt(item.value)}</strong>
                    </div>
                  ))}

                  <p>
                    รวม {fmt(total)} มุม
                    {' · '}
                    มุมภาพปกติ{' '}
                    {displayPct(pct(normal, total))}
                  </p>
                </div>
              </section>

              <div className="section06-lower">
                <section className="section06-box section06-problems">
                  <div className="section06-box-header">
                    <div>
                      <h3>
                        รายการมุมภาพที่มีปัญหา
                      </h3>
                      <p>
                        จำแนกตามลักษณะปัญหาที่พบ
                      </p>
                    </div>

                    <span>{fmt(issueTotal)} มุม</span>
                  </div>

                  <div className="section06-problem-table">
                    {issueItems.map((item, i) => (
                      <div
                        className="section06-problem-row"
                        key={item.key}
                      >
                        <span>
                          {String(i + 1).padStart(2, '0')}
                        </span>

                        <i
                          style={{
                            background: item.color,
                          }}
                        />

                        <b>{item.name}</b>

                        <strong>
                          {fmt(item.value)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="section06-box section06-problem-chart">
                  <div className="section06-box-header">
                    <div>
                      <h3>
                        สัดส่วนประเภทปัญหามุมภาพ
                      </h3>
                      <p>
                        เทียบจากมุมภาพที่ต้องปรับปรุงทั้งหมด
                      </p>
                    </div>
                  </div>

                  <RingChart
                    title="มุมภาพที่มีปัญหา"
                    slices={issueItems.map(item => ({
                      key: item.key,
                      label: item.name,
                      color: item.color,
                      value: item.value,
                    }))}
                    centerValue={fmt(issueTotal)}
                    centerLabel="มุมภาพที่มีปัญหา"
                    centerNote={
                      total
                        ? `คิดเป็น ${displayPct(pct(issueTotal, total))} ของทั้งหมด`
                        : 'ยังไม่มีข้อมูล'
                    }
                    showSlicePercent
                  />
                </section>
              </div>
            </article>
          </div>

          {/* ==================== PAGE 2 ==================== */}

          <div
            className="section06-stage"
            style={{
              width: PAPER_W * scale,
              height: PAPER_H * scale,
              zIndex: activePage === 2 ? 2 : 1,
            }}
          >
            <article
              className="section06-paper section06-paper-two"
              ref={node => {
                pageRefs.current[1] = node
              }}
              style={{
                transform: `scale(${scale})`,
              }}
            >
              {heading(
                'สรุปการตั้งค่า Parameter กล้องวงจรปิด'
              )}

              {/* การ์ดสรุป: กลางวันและกลางคืน */}

              <div className="section06-param-summary-grid">
                <ParameterSummary
                  period="กลางวัน"
                  normal={dayNormal}
                  abnormal={dayAbnormal}
                  color="#0f766e"
                  badColor="#d97706"
                />

                <ParameterSummary
                  period="กลางคืน"
                  normal={nightNormal}
                  abnormal={nightAbnormal}
                  color="#2563eb"
                  badColor="#9f1744"
                />
              </div>

              {/* กราฟ Parameter สองช่วงเวลา */}

              <div className="section06-parameter-grid">

                <section className="section06-box section06-parameter-card">
                  <div className="section06-box-header">
                    <div>
                      <h3>PARAMETER กลางวัน</h3>
                      <p>
                        สัดส่วนการตั้งค่าภาพกลางวัน ปกติ/ผิดปกติ
                      </p>
                    </div>
                  </div>

                  <RingChart
                    title="การตั้งค่ากลางวัน"
                    slices={[
                      {
                        key: 'day-normal',
                        label: 'ตั้งค่าปกติ',
                        color: '#0f766e',
                        value: dayNormal,
                      },
                      {
                        key: 'day-abnormal',
                        label: 'ตั้งค่าผิดปกติ',
                        color: '#d97706',
                        value: dayAbnormal,
                      },
                    ]}
                    centerLabel="ตั้งค่าปกติ"
                    centerValue={fmt(dayNormal)}
                    centerNote={
                      `ตั้งค่าปกติ ${displayPct(pct(dayNormal, dayTotal))}`
                    }
                    showSlicePercent
                    legendPercent
                  />
                </section>

                <section className="section06-box section06-parameter-card">
                  <div className="section06-box-header">
                    <div>
                      <h3>PARAMETER กลางคืน</h3>
                      <p>
                        สัดส่วนการตั้งค่าภาพกลางคืน ปกติ/ผิดปกติ
                      </p>
                    </div>
                  </div>

                  <RingChart
                    title="การตั้งค่ากลางคืน"
                    slices={[
                      {
                        key: 'night-normal',
                        label: 'ตั้งค่าปกติ',
                        color: '#2563eb',
                        value: nightNormal,
                      },
                      {
                        key: 'night-abnormal',
                        label: 'ตั้งค่าผิดปกติ',
                        color: '#9f1744',
                        value: nightAbnormal,
                      },
                    ]}
                    centerLabel="ตั้งค่าปกติ"
                    centerValue={fmt(nightNormal)}
                    centerNote={
                      `ตั้งค่าปกติ ${displayPct(pct(nightNormal, nightTotal))}`
                    }
                    showSlicePercent
                    legendPercent
                  />
                </section>

              </div>
            </article>
          </div>

        </div>
      </div>
    </div>
  )
})
