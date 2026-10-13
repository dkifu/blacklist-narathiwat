
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import html2canvas from 'html2canvas'
import { supabase } from '../../lib/supabase'
import './Section05Editor.css'

const PAPER_WIDTH = 1120
const PAPER_HEIGHT = 792

const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

const EQUIPMENT_FIELDS = [
  { key: 'camera', label: 'Camera' },
  { key: 'switch8', label: 'Switch 8 port' },
  { key: 'power1224', label: 'Power supply 12–24 V' },
  { key: 'mediaConverter', label: 'Media Converter' },
  { key: 'power5', label: 'Power supply 5 V' },
  { key: 'computer', label: 'Computer' },
  { key: 'nvr', label: 'NVR' },
  { key: 'ups', label: 'UPS' },
  { key: 'dummyCamera', label: 'หุ่นกล้อง' },
  { key: 'fiberOptic', label: 'Fiber optic' },
  { key: 'sfp', label: 'SFP' },
  { key: 'lan', label: 'สาย LAN' },
  { key: 'electrical', label: 'ระบบไฟฟ้า' },
  { key: 'serviceBox', label: 'Service Box' },
  { key: 'selfRecovered', label: 'ใช้งานได้เอง' },
]

// สีประจำอุปกรณ์ต้องคงที่ทุกศูนย์และทุกเดือน
const EQUIPMENT_COLORS = {
  camera: '#9F1744',
  switch8: '#2563EB',
  power1224: '#D97706',
  mediaConverter: '#7C3AED',
  power5: '#E11D48',
  computer: '#0F766E',
  nvr: '#4F46E5',
  ups: '#F97316',
  dummyCamera: '#16A34A',
  fiberOptic: '#0891B2',
  sfp: '#A21CAF',
  lan: '#65A30D',
  electrical: '#B45309',
  serviceBox: '#475569',
  selfRecovered: '#EC4899',
}

const getEmptyItems = () =>
  EQUIPMENT_FIELDS.map(field => ({
    key: field.key,
    label: field.label,
    count: 0,
  }))

const formatNumber = value =>
  Number(value || 0).toLocaleString('th-TH')

const normalizeCount = value => {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}


function Section05Summary({
  totalFailures,
  failureTypeCount,
  maxFailureCount,
  maxFailureTypeCount,
  items = [],
}) {
  // หาประเภทอุปกรณ์ที่มีจำนวนเสียสูงสุดเท่ากัน
  const maxFailureNames =
    maxFailureCount > 0
      ? items
          .filter(
            item =>
              Number(item.count) === maxFailureCount
          )
          .map(item => item.label)
      : []

  // กรณีมีสูงสุดไม่เกิน 2 ประเภท ให้แสดงชื่อ
  // มากกว่า 2 ประเภท ให้แสดงจำนวนประเภท
  const maxFailureDetail =
    maxFailureCount === 0
      ? 'ไม่พบการเสีย'
      : maxFailureTypeCount <= 3
        ? maxFailureNames.join(' / ')
        : `${formatNumber(maxFailureTypeCount)} ประเภท`

   
  // ตรวจว่าชื่ออุปกรณ์ยาวจนขึ้นบรรทัดที่ 2 หรือไม่
  const detailRef = useRef(null)
  const [isCompactDetail, setIsCompactDetail] = useState(false)

  useEffect(() => {
    const element = detailRef.current
    if (!element) return

    let active = true

    const checkWrapping = () => {
      if (!active) return

      // วัดข้อความด้วยขนาดปกติก่อนเสมอ
      const originalSize = element.style.fontSize
      element.style.fontSize = '11px'

      const lineHeight = parseFloat(
        window.getComputedStyle(element).lineHeight
      )

      const textHeight = element.getBoundingClientRect().height

      element.style.fontSize = originalSize

      setIsCompactDetail(
        lineHeight > 0 && textHeight > lineHeight * 1.5
      )
    }

    const observer = new ResizeObserver(checkWrapping)
    const card = element.closest('.section05-summary-card')

    if (card) observer.observe(card)

    checkWrapping()

    document.fonts?.ready.then(() => {
      if (active) checkWrapping()
    })

    return () => {
      active = false
      observer.disconnect()
    }
  }, [maxFailureDetail])
     

  return (
    <div className="section05-summary">

      {/* การ์ด 1 — จำนวนการเสียทั้งหมด */}
      <div className="section05-summary-card section05-summary-card--blue">
        <div className="section05-summary-content">
          <span>จำนวนการเสียทั้งหมด</span>

          <div className="section05-summary-value">
            <strong>
              {formatNumber(totalFailures)}
            </strong>
            <small>ครั้ง</small>
          </div>
        </div>
      </div>

      {/* การ์ด 2 — ประเภทที่พบการเสีย */}
      <div className="section05-summary-card section05-summary-card--orange">
        <div className="section05-summary-content">
          <span>ประเภทที่พบการเสีย</span>

          <div className="section05-summary-value">
            <strong>
              {formatNumber(failureTypeCount)}
            </strong>
            <small>
              จาก {EQUIPMENT_FIELDS.length} ประเภท
            </small>
          </div>
        </div>
      </div>

      {/* การ์ด 3 — จำนวนเสียสูงสุดต่อประเภท */}
      <div className="section05-summary-card section05-summary-card--red">
        <div className="section05-summary-content">
          <span>จำนวนเสียสูงสุดต่อประเภท</span>

          <div className="section05-summary-value">
            <strong>
              {formatNumber(maxFailureCount)}
            </strong>
            <small>ครั้ง</small>
          </div>

          
            <div
            ref={detailRef}
            className={`section05-summary-detail ${
                isCompactDetail ? 'is-compact' : ''
            }`}
            title={maxFailureDetail}
            >
            {maxFailureDetail}
            </div>

        </div>
      </div>

    </div>
  )
}


function Section05DonutChart({ items, totalFailures }) {
  const positiveItems = useMemo(() => {
    return items
      .filter(item => Number(item.count) > 0)
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return (
          EQUIPMENT_FIELDS.findIndex(f => f.key === a.key) -
          EQUIPMENT_FIELDS.findIndex(f => f.key === b.key)
        )
      })
      .map(item => ({
        ...item,
        color: EQUIPMENT_COLORS[item.key] || '#64748b',
        percent: totalFailures > 0
          ? (Number(item.count) / totalFailures) * 100
          : 0,
      }))
  }, [items, totalFailures])

  const formatPercent = value =>
    Number(value).toFixed(1).replace(/\.0$/, '')

  // วงโดนัทอยู่กึ่งกลางเสมอ ไม่มีพื้นที่สำหรับเส้นนำภายนอกอีกแล้ว
  const cx = 220
  const cy = 200
  const outerRadius = 170
  const innerRadius = 90
    // ตำแหน่งกลางความหนาของวงโดนัท  
    // ใช้รัศมีเดียวกันทุกชิ้นกราฟ
    const labelRadius = (outerRadius + innerRadius) / 2

  const polar = (angle, radius) => {
    const radian = angle * Math.PI / 180
    return {
      x: cx + Math.cos(radian) * radius,
      y: cy + Math.sin(radian) * radius,
    }
  }

  // ตรวจพื้นที่ตัวอักษรทั้ง 4 มุมและด้านของกรอบข้อความ
  // หากจำนวน+% ไม่พอดี จะลองเฉพาะจำนวน หากยังไม่พอจะเว้นว่าง
  
/* =========================================
   SECTION 05 — UNIFORM DONUT LABELS

   ระดับ 1 : จำนวน + %
   ระดับ 2 : จำนวน
   ระดับ 3 : ไม่แสดง

   ตำแหน่งกึ่งกลางชิ้นและรัศมีเดียวกัน
========================================= */

const findInsideLabel = segment => {
  const countText = formatNumber(segment.count)
  const percentText =
    `(${formatPercent(segment.percent)}%)`

  // ใช้รัศมีกลางวงเดียวกันทุกประเภท
  const position = polar(
    segment.middleAngle,
    labelRadius
  )

  // ประมาณความกว้างข้อความตามฟอนต์ปัจจุบัน
  const countWidth = Math.max(
    11,
    countText.length * 10.5
  )

  const percentWidth = Math.max(
    28,
    percentText.length * 7.2
  )

  // ตรวจว่ากรอบข้อความอยู่ภายในชิ้นกราฟทั้งหมด
  const canFit = mode => {
    const width =
      mode === 'full'
        ? Math.max(countWidth, percentWidth) + 6
        : countWidth + 6

    const halfWidth = width / 2

    const top = mode === 'full' ? -20 : -11
    const bottom = mode === 'full' ? 17 : 10

    const testX = [
      -halfWidth,
      0,
      halfWidth,
    ]

    const testY = [
      top,
      0,
      bottom,
    ]

    for (const dx of testX) {
      for (const dy of testY) {
        const x = position.x + dx - cx
        const y = position.y + dy - cy

        const distance = Math.hypot(x, y)

        const angle =
          Math.atan2(y, x) * 180 / Math.PI

        const offset =
          ((angle - segment.startAngle) % 360 + 360)
          % 360

        // กันไม่ให้ข้อความทับรูตรงกลาง
        // ขอบวงด้านนอก หรือเส้นแบ่งชิ้นกราฟ
        if (
          distance < innerRadius + 3 ||
          distance > outerRadius - 3 ||
          (
            segment.sweep < 359.999 &&
            (
              offset < 0.7 ||
              offset > segment.sweep - 0.7
            )
          )
        ) {
          return false
        }
      }
    }

    return true
  }

  // ยังไม่เลือกระดับในขั้นตอนนี้
  // เพราะต้องเทียบกับชิ้นที่มีจำนวนเท่ากันก่อน
  return {
    x: position.x,
    y: position.y,
    canFull: canFit('full'),
    canCount: canFit('count'),
    mode: 'none',
  }
}


  let currentAngle = -90
  const segments = positiveItems.map(item => {
    const sweep = totalFailures > 0
      ? Number(item.count) / totalFailures * 360
      : 0
    const start = currentAngle
    const end = start + sweep
    const middle = start + sweep / 2
    currentAngle = end

    const outerStart = polar(start, outerRadius)
    const outerEnd = polar(end, outerRadius)
    const innerStart = polar(start, innerRadius)
    const innerEnd = polar(end, innerRadius)
    const largeArc = sweep > 180 ? 1 : 0

    const path = [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
      'Z',
    ].join(' ')

    const segment = {
      ...item,
      path,
      isFullCircle: sweep >= 359.999,
      startAngle: start,
      middleAngle: middle,
      sweep,
    }
    return { ...segment, insideLabel: findInsideLabel(segment) }
  })
  
/* =========================================
   GROUP LABELS BY FAILURE COUNT

   จำนวนเท่ากัน ต้องใช้รูปแบบเดียวกัน
========================================= */

// จัดกลุ่มชิ้นกราฟตามจำนวนครั้งการเสีย
const countGroups = new Map()

segments.forEach(segment => {
  const count = Number(segment.count)

  if (!countGroups.has(count)) {
    countGroups.set(count, [])
  }

  countGroups.get(count).push(segment)
})

// เลือกระดับที่ทุกชิ้นในกลุ่มรองรับได้
countGroups.forEach(group => {
  const allCanFull = group.every(
    item => item.insideLabel.canFull
  )

  const allCanCount = group.every(
    item => item.insideLabel.canCount
  )

  let groupMode = 'none'

  if (allCanFull) {
    // ระดับ 1 — ทุกชิ้นใส่จำนวน + % ได้
    groupMode = 'full'
  } else if (allCanCount) {
    // ระดับ 2 — ทุกชิ้นใส่จำนวนได้
    groupMode = 'count'
  } else {
    // ระดับ 3 — มีบางชิ้นใส่ไม่พอ
    // จึงไม่แสดงข้อความทั้งกลุ่ม
    groupMode = 'none'
  }

  group.forEach(item => {
    item.insideLabel.mode = groupMode
  })
})


  return (
    <div className={`section05-chart-block ${positiveItems.length >= 9 ? 'is-dense' : ''}`}>
      {positiveItems.length === 0 ? (
        <div className="section05-chart-placeholder">
          <strong>ไม่พบการเสียของอุปกรณ์</strong>
          <span>จำนวนการเสียรวม 0 ครั้ง</span>
        </div>
      ) : (
        <>
          <div className="section05-donut-wrap">
            <svg
              className="section05-donut-svg"
              viewBox="0 0 440 400"
              role="img"
              aria-label="กราฟโดนัทแสดงสัดส่วนการเสียแยกตามประเภทอุปกรณ์"
            >
              {segments.map(item => (
                <g key={item.key}>
                  <title>
                    {item.label}: {formatNumber(item.count)} ครั้ง ({formatPercent(item.percent)}%)
                  </title>
                  {item.isFullCircle ? (
                    <circle cx={cx} cy={cy} r={outerRadius} fill={item.color} />
                  ) : (
                    <path
                      d={item.path}
                      fill={item.color}
                      stroke="#ffffff"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  )}
                </g>
              ))}

              {/* ระดับ 1: จำนวน + เปอร์เซ็นต์ / ระดับ 2: จำนวน / ระดับ 3: ว่าง */}
              {segments.filter(item => item.insideLabel.mode !== 'none').map(item => (
                <g key={`inside-${item.key}`}>
                  <text
                    x={item.insideLabel.x}
                    y={item.insideLabel.mode === 'full' ? item.insideLabel.y - 5 : item.insideLabel.y + 5}
                    textAnchor="middle"
                    className="section05-donut-label-count"
                  >
                    {formatNumber(item.count)}
                  </text>
                  {item.insideLabel.mode === 'full' && (
                    <text
                      x={item.insideLabel.x}
                      y={item.insideLabel.y + 13}
                      textAnchor="middle"
                      className="section05-donut-label-percent"
                    >
                      ({formatPercent(item.percent)}%)
                    </text>
                  )}
                </g>
              ))}

              <circle cx={cx} cy={cy} r={innerRadius} fill="#ffffff" />
              <text x={cx} y={cy - 21} textAnchor="middle" className="section05-donut-center-top">
                รวมทั้งหมด
              </text>
              <text x={cx} y={cy + 20} textAnchor="middle" className="section05-donut-center-value">
                {formatNumber(totalFailures)}
              </text>
              <text x={cx} y={cy + 44} textAnchor="middle" className="section05-donut-center-bottom">
                ครั้ง
              </text>
            </svg>
          </div>

          
            {/* LEGEND — จุดสีกลมพร้อมชื่ออุปกรณ์ */}

            <div className="section05-chart-legend">
            {positiveItems.map(item => (
                <div
                key={item.key}
                className="section05-legend-simple"
                title={item.label}
                >
                <span
                    className="section05-legend-color-dot"
                    style={{
                    backgroundColor: item.color,
                    }}
                />

                <span className="section05-legend-simple-label">
                    {item.label}
                </span>
                </div>
            ))}
            </div>


        </>
      )}
    </div>
  )
}

function Section05StatusTable({ items, totalFailures }) {
  const maxValue = Math.max(0, ...items.map(item => Number(item.count || 0)))

  return (
    <div className="section05-table-wrap">
      <div className="section05-table-header">
        <span>ลำดับ</span>
        <span>ประเภทอุปกรณ์</span>
        <span>จำนวนการเสีย (ครั้ง)</span>
        <span>สถานะ</span>
      </div>
      <div className="section05-table-body">
        {items.map((item, index) => {
          const count = normalizeCount(item.count)
          const hasFailure = count > 0
          const percent = totalFailures > 0 ? (count / totalFailures) * 100 : 0
          const widthPercent = hasFailure && maxValue > 0 ? (count / maxValue) * 100 : 0

          return (
            <div className="section05-table-row" key={item.key}>
              <div className="section05-col-order">{index + 1}</div>
              <div className="section05-col-name" title={item.label}>{item.label}</div>
              <div className="section05-col-bar">
                <span className="section05-col-count">{formatNumber(count)}</span>
                <div className="section05-bar-track">
                  <div
                    className={`section05-bar-fill ${hasFailure ? 'has-value' : ''}`}
                    style={{
                      width: `${widthPercent}%`,
                      background: hasFailure ? EQUIPMENT_COLORS[item.key] : 'transparent',
                    }}
                  />
                </div>
                <span className="section05-col-percent">{Math.round(percent)}%</span>
              </div>
              <div className="section05-col-status">
                {hasFailure ? (
                  <>
                    <span className="section05-status-icon danger">
                      <svg
                        viewBox="0 0 24 24" width="16" height="16" fill="none"
                        stroke="currentColor" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                      >
                        <path d="M21.2 6.5a7 7 0 0 1-9.1 8.5l-7 7a2 2 0 0 1-2.8-2.8l7-7a7 7 0 0 1 8.5-9.1L14 7l3 3 4.2-3.5Z" />
                      </svg>
                    </span>
                    <span className="section05-status-value danger">
                      {formatNumber(count)} ครั้ง
                    </span>
                  </>
                ) : (
                  <>
                    <span className="section05-status-icon success">✓</span>
                    <span className="section05-status-value success">0 ครั้ง</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default forwardRef(function Section05Editor({
  report,
  center,
  month,
  year,
  canEdit = false,
  onDataChange,
}, ref) {
  const previewRef = useRef(null)
  const paperRef = useRef(null)
  const [previewScale, setPreviewScale] = useState(1)
  const [items, setItems] = useState(getEmptyItems)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [rowExists, setRowExists] = useState(false)
  const [hasStoredItems, setHasStoredItems] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [exportingPng, setExportingPng] = useState(false)

  const monthLabel = MONTHS_TH[Number(month) - 1] || '-'
  const reportMatchesSelection =
    !!report?.id &&
    String(report.center_id) === String(center?.id) &&
    Number(report.report_month) === Number(month) &&
    Number(report.report_year) === Number(year)

  const normalizedItems = items.map(item => ({
    ...item,
    count: normalizeCount(item.count),
  }))

  const totalFailures = normalizedItems.reduce(
    (sum, item) => sum + Number(item.count || 0), 0
  )
  const failureTypeCount = normalizedItems.filter(item => item.count > 0).length
  const maxFailureCount = Math.max(0, ...normalizedItems.map(item => item.count))
  const maxFailureTypeCount = maxFailureCount > 0
    ? normalizedItems.filter(item => item.count === maxFailureCount).length
    : 0

  useEffect(() => {
    let active = true

    const loadSection05 = async () => {
      setLoading(true)
      setLoadError('')
      setSaveMessage('')
      setSaveStatus('')
      setItems(getEmptyItems())
      setRowExists(false)
      setHasStoredItems(false)

      if (!report?.id) {
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('monthly_report_sections')
          .select('content')
          .eq('report_id', report.id)
          .eq('section_no', 5)
          .maybeSingle()

        if (error) throw error
        if (!active) return

        setRowExists(!!data)
        const savedItems = Array.isArray(data?.content?.items)
          ? data.content.items : []
        setHasStoredItems(savedItems.length > 0)
        const savedMap = new Map(savedItems.map(item => [item.key, item]))
        setItems(EQUIPMENT_FIELDS.map(field => ({
          key: field.key,
          label: field.label,
          count: normalizeCount(savedMap.get(field.key)?.count),
        })))
      } catch (err) {
        if (!active) return
        console.error('Load Section 05 error:', err)
        setLoadError(err.message || 'ไม่สามารถโหลดข้อมูลได้')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadSection05()
    return () => { active = false }
  }, [report?.id])

  useEffect(() => {
    const element = previewRef.current
    if (!element) return

    const updateScale = () => {
      const availableWidth = element.clientWidth - 40
      if (availableWidth <= 100) return
      setPreviewScale(Math.min(1, availableWidth / PAPER_WIDTH))
    }

    const observer = new ResizeObserver(updateScale)
    observer.observe(element)
    updateScale()
    return () => observer.disconnect()
  }, [canEdit])

  const setItemCount = (key, nextValue) => {
    setItems(previous => previous.map(item =>
      item.key === key ? { ...item, count: nextValue } : item
    ))
  }

  const saveSection05 = async () => {
    if (!reportMatchesSelection) {
      setSaveStatus('error')
      setSaveMessage('ข้อมูลศูนย์หรือเดือนรายงานไม่ตรงกัน กรุณาโหลดรายงานใหม่')
      return
    }
    if (!canEdit || !report?.id || saving || loading || loadError) return

    setSaving(true)
    setSaveMessage('')
    setSaveStatus('')
    try {
      const content = {
        version: 2,
        items: normalizedItems.map(item => ({
          key: item.key,
          count: normalizeCount(item.count),
        })),
      }

      if (rowExists) {
        const { error } = await supabase
          .from('monthly_report_sections')
          .update({ content })
          .eq('report_id', report.id)
          .eq('section_no', 5)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('monthly_report_sections')
          .insert({ report_id: report.id, section_no: 5, content })
        if (error) throw error
        setRowExists(true)
      }

      setHasStoredItems(true)
      setSaveStatus('success')
      setSaveMessage('บันทึกข้อมูลเรียบร้อยแล้ว')
      onDataChange?.()
    } catch (err) {
      console.error('Save Section 05 error:', err)
      setSaveStatus('error')
      setSaveMessage(err.message || 'ไม่สามารถบันทึกข้อมูลได้')
    } finally {
      setSaving(false)
    }
  }

  const captureSection05 = async () => {
    const node = paperRef.current
    if (loading || loadError || !node) {
      throw new Error('หน้ารายงานหัวข้อ 05 ยังไม่พร้อม')
    }
    if (document.fonts?.ready) await document.fonts.ready
    const originalTransform = node.style.transform
    const originalOrigin = node.style.transformOrigin

    try {
      node.style.transform = 'none'
      node.style.transformOrigin = 'top left'
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const canvas = await html2canvas(node, {
        width: PAPER_WIDTH,
        height: PAPER_HEIGHT,
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: false,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: PAPER_WIDTH,
        windowHeight: PAPER_HEIGHT,
      })
      return canvas.toDataURL('image/png')
    } finally {
      node.style.transform = originalTransform
      node.style.transformOrigin = originalOrigin
    }
  }

  const downloadSection05Png = async () => {
    if (exportingPng || saving || loading) return
    setExportingPng(true)
    setSaveMessage('')
    setSaveStatus('')
    try {
      const dataUrl = await captureSection05()
      const centerName = center?.code || center?.name || 'CENTER'
      const safeCenterName = String(centerName).replace(/[^a-zA-Z0-9ก-๙_-]/g, '_')
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `Monthly_Report_${safeCenterName}_${month}_${year}_Section05.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setSaveStatus('success')
      setSaveMessage('ดาวน์โหลด PNG หัวข้อ 05 เรียบร้อยแล้ว')
    } catch (err) {
      console.error('Section 05 PNG error:', err)
      setSaveStatus('error')
      setSaveMessage(err.message || 'ไม่สามารถดาวน์โหลด PNG ได้')
    } finally {
      setExportingPng(false)
    }
  }

  useImperativeHandle(ref, () => ({
    isReady: () => !loading && !loadError && !!center?.id,
    hasData: () => !loading && !loadError && reportMatchesSelection && hasStoredItems,
    exportPdfPages: async () => [{
      orientation: 'landscape',
      dataUrl: await captureSection05(),
    }],
  }))

  return (
    <div className={`section05-editor ${canEdit ? 'section05-editing' : ''}`}>
      {canEdit && (
        <aside className="section05-panel">
          <div className="section05-panel-head">
            <span>หัวข้อ 05</span>
            <h3>แก้ไขสถิติการเสียประจำเดือน</h3>
            <p>กรอกจำนวนการเสียของอุปกรณ์แต่ละประเภท</p>
          </div>
          <div className="section05-panel-body">
            <div className="section05-field-list">
              {items.map(item => (
                <label key={item.key} className="section05-edit-field">
                  <span>{item.label}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0"
                    disabled={loading || saving || !!loadError}
                    value={item.count ?? ''}
                    onFocus={event => event.target.select()}
                    onChange={event => {
                      const raw = event.target.value.replace(/\D/g, '')
                      if (raw.length > 12) return
                      const nextValue = raw === '' ? null : Number(raw)
                      if (nextValue !== null && !Number.isSafeInteger(nextValue)) return
                      setItemCount(item.key, nextValue)
                    }}
                    onBlur={() => {
                      if (item.count === null) setItemCount(item.key, 0)
                    }}
                  />
                </label>
              ))}
            </div>

            <div className="section05-save-actions">
              <button
                type="button"
                className="section05-save-button"
                onClick={saveSection05}
                disabled={saving || loading || !!loadError || !center?.id || !reportMatchesSelection}
              >
                {saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
              </button>
            </div>

            <div className="section05-export-block">
              <h4>ส่งออกรายงาน</h4>
              <button
                type="button"
                className="section05-export-button"
                onClick={downloadSection05Png}
                disabled={exportingPng || saving || loading || !!loadError}
              >
                {exportingPng ? 'กำลังสร้าง PNG...' : '↓ บันทึกหน้า 05 เป็น PNG'}
              </button>
              <small>
                บันทึกเฉพาะหัวข้อ 05 เป็นภาพ PNG ขนาด A4 แนวนอน
                โดย PDF ใช้ระบบรวมรายงานทั้งเล่ม
              </small>
            </div>

            {saveMessage && (
              <p role="status" className={`section05-save-message ${saveStatus}`}>
                {saveMessage}
              </p>
            )}
            <p className="section05-panel-notice">
              {loading ? 'กำลังโหลดข้อมูลรายงาน...'
                : loadError ? `โหลดข้อมูลไม่สำเร็จ: ${loadError}`
                  : 'ข้อมูลจะแสดงในตัวอย่างทันที แต่ยังไม่ได้บันทึก'}
            </p>
          </div>
        </aside>
      )}

      <div className="section05-preview" ref={previewRef}>
        <div
          className="section05-paper-stage"
          style={{
            width: PAPER_WIDTH * previewScale,
            height: PAPER_HEIGHT * previewScale,
          }}
        >
          <div
            className="section05-paper"
            ref={paperRef}
            style={{ transform: `scale(${previewScale})` }}
          >
            <header className="section05-heading">
              <h2>สถิติการเสียของอุปกรณ์ประจำเดือน</h2>
              <p>{center?.name || 'ศูนย์กล้องวงจรปิด'}{' · '}{monthLabel} {year}</p>
            </header>

            
            <Section05Summary
            totalFailures={totalFailures}
            failureTypeCount={failureTypeCount}
            maxFailureCount={maxFailureCount}
            maxFailureTypeCount={maxFailureTypeCount}
            items={normalizedItems}
            />


            <div className="section05-content">
              <div className="section05-chart-card">
                <div className="section05-card-head">
                  <div className="section05-card-title-group">
                    <div>
                      <h3>สัดส่วนการเสียแยกตามประเภทอุปกรณ์</h3>
                      <p>เปรียบเทียบสัดส่วนการเสียของอุปกรณ์ประจำเดือน</p>
                    </div>
                  </div>
                  <span className="section05-card-unit">หน่วย : ครั้ง</span>
                </div>
                <div className="section05-chart-inner">
                  <Section05DonutChart items={normalizedItems} totalFailures={totalFailures} />
                </div>
              </div>

              <div className="section05-status-card">
                <div className="section05-card-head">
                  <div className="section05-card-title-group">
                    <div>
                      <h3>สถานะการเสียของอุปกรณ์ทั้งหมด</h3>
                      <p>รายละเอียดการเสียแยกตามอุปกรณ์ทั้ง 15 ประเภท</p>
                    </div>
                  </div>
                </div>
                <Section05StatusTable items={normalizedItems} totalFailures={totalFailures} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
