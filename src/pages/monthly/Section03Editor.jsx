
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import html2canvas from 'html2canvas'
import { supabase } from '../../lib/supabase'
import './Section03Editor.css'

const MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.',
  'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.',
  'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

const TYPES = [
  { key: 'unrest', name: 'เหตุก่อความไม่สงบ' },
  { key: 'accident', name: 'อุบัติเหตุทางถนน' },
  { key: 'crime', name: 'อาชญากรรม' },
  { key: 'lpr_ai', name: 'เหตุการณ์จากระบบ LPR / AI' },
]

const TYPE_KEYS = new Set(TYPES.map(item => item.key))

const formatCount = value =>
  value == null ? '' : Number(value).toLocaleString('th-TH')


const CHART_COLORS = {
  unrest: '#dc3545',
  accident: '#f4c430',
  crime: '#20a36b',
  lpr_ai: '#2378bb',
}

function Section03Chart({ rows, year }) {
  const values = rows.flatMap(row =>
    row.values.filter(value => value != null).map(Number)
  )

  const maxValue = Math.max(0, ...values)
  const tickStep = Math.max(5, Math.ceil(maxValue / 20) * 5)
  const scaleMax = tickStep * 4

  const left = 52
  const top = 18
  const bottom = 190
  const plotHeight = bottom - top
  const plotWidth = 910
  const monthWidth = plotWidth / 12

  const barWidth = 12
  const barGap = 4
  const groupWidth = barWidth * 4 + barGap * 3

  return (
    <div className="section03-chart">
      <div className="section03-chart-header">
        <h3>สถิติการใช้งาน พ.ศ. {year}</h3>

        
      </div>

      <svg
        className="section03-chart-svg"
        viewBox="0 0 1000 245"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="กราฟแท่งเปรียบเทียบเหตุการณ์รายเดือน"
      >
        {Array.from({ length: 5 }, (_, index) => {
          const y = bottom - index * (plotHeight / 4)

          return (
            <g key={index}>
              <line
                x1={left}
                x2={left + plotWidth}
                y1={y}
                y2={y}
                stroke="#dce2e9"
                strokeWidth="1"
              />
              <text
                x={left - 8}
                y={y + 4}
                fontSize="12"
                textAnchor="end"
                fill="#64748b"
              >
                {index * tickStep}
              </text>
            </g>
          )
        })}

        {MONTHS.map((month, monthIndex) => {
          const startX =
            left +
            monthIndex * monthWidth +
            (monthWidth - groupWidth) / 2

          return (
            <g key={month}>
              {rows.map((row, typeIndex) => {
                const rawValue = row.values[monthIndex]

                if (rawValue == null) return null

                const value = Number(rawValue)
                if (value <= 0) return null

                const height = value / scaleMax * plotHeight
                const x = startX + typeIndex * (barWidth + barGap)
                const y = bottom - height

                return (
                  <g key={row.key}>
                    <title>
                      {`${month} · ${row.name}: ${value.toLocaleString('th-TH')}`}
                    </title>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={height}
                      fill={CHART_COLORS[row.key]}
                      rx="1"
                    />
                    <text
                      x={x + barWidth / 2}
                      y={Math.max(12, y - 5)}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#334155"
                    >
                      {value >= 1000
                        ? `${(value / 1000).toFixed(1)}k`
                        : value}
                    </text>
                  </g>
                )
              })}

              <text
                x={left + monthIndex * monthWidth + monthWidth / 2}
                y={bottom + 19}
                textAnchor="middle"
                fontSize="13"
                fontWeight="800"
                fill="#475569"
              >
                {month}
              </text>
            </g>
          )
        })}
      </svg>

            

      {/* LEGEND — BELOW CHART */}
      <div className="section03-chart-legend">
        {TYPES.map(type => (
          <span key={type.key}>
            <i
              style={{
                background: CHART_COLORS[type.key]
              }}
            />
            {type.name}
          </span>
        ))}
      </div>

    </div>
  )
}

    

const Section03Editor = forwardRef(function Section03Editor({
  report,
  center,
  month,
  year,
  canEdit = false,
  onDataChange,
}, ref) {
  const [rows, setRows] = useState([])

  const [sourceRows, setSourceRows] = useState([])

  const [savedRows, setSavedRows] = useState([])

  const [manualUtilizedKeys, setManualUtilizedKeys] = useState([])
  const [savedManualUtilizedKeys, setSavedManualUtilizedKeys] = useState([])

  const [sectionSaving, setSectionSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [exportingPng, setExportingPng] = useState(false)

  const [editMonth, setEditMonth] = useState(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const previewRef = useRef(null)
  const paperRef = useRef(null)
  const [previewScale, setPreviewScale] = useState(1)

  const selectedYear = Number(year)
  const calendarYear =
    selectedYear >= 2400 ? selectedYear - 543 : selectedYear

  const today = new Date()

        const editableMonthCount =
        calendarYear < today.getFullYear()
            ? 12
            : calendarYear === today.getFullYear()
            ? today.getMonth()
            : 0

        useEffect(() => {
        setEditMonth(Math.max(0, editableMonthCount - 1))
        }, [calendarYear, editableMonthCount, center?.id])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      setRows([])
      setSourceRows([])
      setSavedRows([])
      setSaveMessage('')
      setManualUtilizedKeys([])
      setSavedManualUtilizedKeys([])

      try {
        const centerId = Number(center?.id)
        const now = new Date()

        if (!centerId || !Number.isInteger(calendarYear)) {
          throw new Error('ไม่พบข้อมูลศูนย์หรือปีรายงาน')
        }

        const completedMonths =
          calendarYear < now.getFullYear()
            ? 12
            : calendarYear === now.getFullYear()
              ? now.getMonth()
              : 0

        const monthlyValues = {}
        const utilizedValues = {}

        if (completedMonths > 0) {
          const endExclusive = completedMonths === 12
            ? `${calendarYear + 1}-01-01`
            : `${calendarYear}-${String(
                completedMonths + 1
              ).padStart(2, '0')}-01`

          const fetchAll = async (
            table,
            dateField,
            columns
          ) => {
            const result = []
            const pageSize = 500
            let offset = 0

            while (true) {
              const { data, error: fetchError } =
                await supabase
                  .from(table)
                  .select(columns)
                  .eq('center_id', centerId)
                  .gte(dateField, `${calendarYear}-01-01`)
                  .lt(dateField, endExclusive)
                  .order(dateField, { ascending: true })
                  .order('incident_type', { ascending: true })
                  .range(offset, offset + pageSize - 1)

              if (!active) return []
              if (fetchError) throw fetchError

              result.push(...(data || []))

              if (!data?.length || data.length < pageSize) {
                break
              }

              offset += data.length
            }

            return result
          }

          // 1. ดึงข้อมูลรายวัน
          const dailyRows = await fetchAll(
            'usage_daily_stats',
            'usage_date',
            'usage_date, incident_type, event_count, utilized_count'
          )

          dailyRows.forEach(item => {
            if (!TYPE_KEYS.has(item.incident_type)) return

            const monthIndex =
              Number(item.usage_date.slice(5, 7)) - 1

            const key = `${monthIndex}|${item.incident_type}`

            monthlyValues[key] =
              (monthlyValues[key] ?? 0) +
              Number(item.event_count ?? 0)

            utilizedValues[key] =
              (utilizedValues[key] ?? 0) +
              Number(item.utilized_count ?? 0)
          })

          // 2. ดึงค่าที่แก้ไขในตารางรายปี
          const manualRows = await fetchAll(
            'usage_monthly_stats',
            'month_start',
            'month_start, incident_type, event_count'
          )

          // ค่าที่แก้เองมีลำดับความสำคัญสูงกว่า
          manualRows.forEach(item => {
            if (!TYPE_KEYS.has(item.incident_type)) return
            if (item.event_count == null) return

            const monthIndex =
              Number(item.month_start.slice(5, 7)) - 1

            const key = `${monthIndex}|${item.incident_type}`

            monthlyValues[key] = Number(item.event_count)
          })
        }

        const nextRows = TYPES.map(type => {
          const values = MONTHS.map((_, monthIndex) => {
            if (monthIndex >= completedMonths) return null

            const key = `${monthIndex}|${type.key}`
            return monthlyValues[key] ?? null
          })

          const total = values.some(value => value != null)
            ? values.reduce((sum, value) => sum + (value ?? 0), 0)
            : null

          
            /* ใช้ขยายผลได้: ค่าเริ่มต้นเท่ากับยอดรวม */
            const utilized = total

            return { ...type, values, total, utilized }

                    })

        
const displayRows = nextRows.map(row => ({
    ...row,
    values: [...row.values],
    }))
    let loadedManualKeys = []

    // โหลดเฉพาะข้อมูลที่บันทึกของรายงานหัวข้อ 03
    if (report?.id) {
    const { data: sectionData, error: sectionError } =
        await supabase
        .from('monthly_report_sections')
        .select('content')
        .eq('report_id', report.id)
        .eq('section_no', 3)
        .maybeSingle()

    if (sectionError) throw sectionError

    const content = sectionData?.content

    if (content && Number(content.year) === calendarYear) {
        const overrides = content.overrides || {}
        const utilizedOverrides = content.utilizedOverrides || {}

        loadedManualKeys = Object.keys(utilizedOverrides).filter(
            key => TYPE_KEYS.has(key)
        )

        displayRows.forEach(row => {
        const monthChanges = overrides[row.key] || {}

        row.values = row.values.map((original, index) => {
            if (index >= completedMonths) return null

            if (!Object.prototype.hasOwnProperty.call(
            monthChanges, index
            )) {
            return original
            }

            const value = monthChanges[index]

            return value === null ||
            (Number.isSafeInteger(value) && value >= 0)
            ? value
            : original
        })

        const validValues = row.values.filter(
            value => value !== null
        )

        row.total = validValues.length
            ? validValues.reduce((sum, value) => sum + value, 0)
            : null
            // ค่าอัตโนมัติใช้ยอดรวมล่าสุด
                row.utilized = row.total

        if (Object.prototype.hasOwnProperty.call(
            utilizedOverrides, row.key
        )) {
            const value = utilizedOverrides[row.key]

            if (
            value === null ||
            (Number.isSafeInteger(value) && value >= 0)
            ) {
            row.utilized = value
            }
        }
        })
    }
    }

    if (active) {
    setSourceRows(
        nextRows.map(row => ({
        ...row,
        values: [...row.values],
        }))
    )

    setRows(displayRows)

    setSavedRows(
        displayRows.map(row => ({
        ...row,
        values: [...row.values],
        }))
    )

    setManualUtilizedKeys(loadedManualKeys)
    setSavedManualUtilizedKeys([...loadedManualKeys])

    }

      } catch (err) {
        if (active) {
          setError(err.message || 'ไม่สามารถโหลดข้อมูลได้')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [center?.id, calendarYear, report?.id])

  
  // =========================================
  // SECTION 03 — AUTO FIT A4 PREVIEW
  // =========================================

  
useEffect(() => {
  if (loading || error) return

  const element = previewRef.current
  if (!element) return

  let frameId = 0

  const updateScale = () => {
    cancelAnimationFrame(frameId)

    frameId = requestAnimationFrame(() => {
      const styles = window.getComputedStyle(element)

      const padding =
        (parseFloat(styles.paddingLeft) || 0) +
        (parseFloat(styles.paddingRight) || 0)

      const availableWidth = Math.max(
        0,
        element.clientWidth - padding
        )

      // อย่าย่อกระดาษตอนพื้นที่ยังซ่อนอยู่
      if (availableWidth <= 100) return

      const nextScale = Math.min(
        1,
        availableWidth / 1120
      )

      setPreviewScale(nextScale)
    })
  }

  const observer = new ResizeObserver(updateScale)

    observer.observe(element)

  window.addEventListener('resize', updateScale)

  updateScale()

  return () => {
    cancelAnimationFrame(frameId)
    observer.disconnect()
    window.removeEventListener('resize', updateScale)
  }
}, [loading, error, canEdit])



  const grandTotal = rows.reduce(
    (sum, row) => sum + (row.total ?? 0), 0
  )

  const grandUtilized = rows.reduce(
    (sum, row) => sum + (row.utilized ?? 0), 0
  )

  const hasData = rows.some(row => row.total != null)
  const hasUtilized = rows.some(row => row.utilized != null)

  
    const handleManualChange = (typeKey, rawValue) => {
    if (
        !canEdit ||
        editMonth < 0 ||
        editMonth >= editableMonthCount
    ) return

    const value =
        rawValue === '' ? null : Number(rawValue)

    if (
        value !== null &&
        (!Number.isSafeInteger(value) || value < 0)
    ) return

    setRows(previous =>
        previous.map(row => {
        if (row.key !== typeKey) return row

        const values = [...row.values]
        values[editMonth] = value

        
        const hasValue = values.some(v => v != null)

        const total = hasValue
        ? values.reduce(
            (sum, v) => sum + (v ?? 0), 0
            )
        : null

        return {
        ...row,
        values,
        total,

        // หากไม่ได้แก้ Manual ให้ตามยอดรวม
        utilized: manualUtilizedKeys.includes(typeKey)
            ? row.utilized
            : total,
        }

        })
    )
    }



const handleUtilizedChange = (typeKey, rawValue) => {
  if (!canEdit) return

  const value =
    rawValue === '' ? null : Number(rawValue)

  if (
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0)
  ) return

  // เมื่อกรอกเอง ให้จดจำว่าเป็น Manual
  setManualUtilizedKeys(previous =>
    previous.includes(typeKey)
      ? previous
      : [...previous, typeKey]
  )

  setRows(previous =>
    previous.map(row =>
      row.key === typeKey
        ? { ...row, utilized: value }
        : row
    )
  )

  setSaveMessage('')
}


const enableAutoUtilized = typeKey => {
  if (!canEdit) return

  setManualUtilizedKeys(previous =>
    previous.filter(key => key !== typeKey)
  )

  setRows(previous =>
    previous.map(row =>
      row.key === typeKey
        ? { ...row, utilized: row.total }
        : row
    )
  )

  setSaveMessage('')
}



    
const rowsDifferFrom = reference =>
  rows.some((row, index) => {
    const original = reference[index]
    if (!original) return false

    return (
      row.utilized !== original.utilized ||
      row.values.some(
        (value, monthIndex) =>
          value !== original.values[monthIndex]
      )
    )
  })

  
const sameManualKeys = (a, b) =>
  a.length === b.length &&
  a.every(key => b.includes(key))

const hasManualChanges =
  rowsDifferFrom(savedRows) ||
  !sameManualKeys(
    manualUtilizedKeys,
    savedManualUtilizedKeys
  )

const hasSourceDifferences =
  rowsDifferFrom(sourceRows) ||
  manualUtilizedKeys.length > 0

    

    
    const saveManualReport = async () => {
    if (sectionSaving) return

    if (!canEdit || !report?.id) {
        setSaveStatus('error')
        setSaveMessage('ไม่มีสิทธิ์แก้ไขหรือไม่พบ Report ID')
        return
    }

    if (!hasManualChanges) return

    setSectionSaving(true)
    setSaveMessage('')

    try {
        const overrides = {}
        const utilizedOverrides = {}

        rows.forEach(row => {
        const original = sourceRows.find(
            item => item.key === row.key
        )

        if (!original) return

        const monthChanges = {}

        row.values.forEach((value, index) => {
            // ไม่บันทึกเดือนปัจจุบันและเดือนอนาคต
            if (index >= editableMonthCount) return

            if (value !== original.values[index]) {
            monthChanges[index] = value
            }
        })

        if (Object.keys(monthChanges).length > 0) {
            overrides[row.key] = monthChanges
        }

        if (manualUtilizedKeys.includes(row.key)) {
            utilizedOverrides[row.key] = row.utilized
        }
        })

        const snapshot = rows.map(row => ({
        ...row,
        values: [...row.values],
        }))

        const { error: saveError } = await supabase
        .from('monthly_report_sections')
        .upsert(
            {
            report_id: report.id,
            section_no: 3,
            content: {
                version: 1,
                year: calendarYear,
                overrides,
                utilizedOverrides,
            },
            updated_at: new Date().toISOString(),
            },
            {
            onConflict: 'report_id,section_no',
            }
        )

        if (saveError) throw saveError

        setSavedRows(snapshot)
        setSavedManualUtilizedKeys([...manualUtilizedKeys])
        setSaveStatus('success')
        setSaveMessage('บันทึกข้อมูลรายงานเรียบร้อยแล้ว')

        onDataChange?.()

    } catch (err) {
        console.error('Save Section 03 error:', err)

        setSaveStatus('error')
        setSaveMessage(
        err.message || 'ไม่สามารถบันทึกข้อมูลได้'
        )
    } finally {
        setSectionSaving(false)
    }
    }



    
    const resetManualChanges = () => {
        setRows(
            sourceRows.map(row => ({
            ...row,
            values: [...row.values],
            }))
        )

        setManualUtilizedKeys([])
        setSaveMessage('')
        setSaveStatus('')
    }

  
/* =========================================
   SECTION 03 — EXPORT A4
========================================= */

const captureSection03 = async () => {
  const node = paperRef.current

  if (loading || error || !node) {
    throw new Error('หน้ารายงานหัวข้อ 03 ยังไม่พร้อม')
  }

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  const originalTransform = node.style.transform
  const originalOrigin = node.style.transformOrigin

  try {
    // จับภาพจากขนาดกระดาษจริง ไม่ใช้ขนาดที่ย่อใน Preview
    node.style.transform = 'none'
    node.style.transformOrigin = 'top left'

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
      })
    })

    const canvas = await html2canvas(node, {
      width: 1120,
      height: 792,
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: false,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 1120,
      windowHeight: 792,
    })

    return canvas.toDataURL('image/png')

  } finally {
    node.style.transform = originalTransform
    node.style.transformOrigin = originalOrigin
  }
}



/* =========================================
   DOWNLOAD PNG — SECTION 03 ONLY
========================================= */

const downloadSection03Png = async () => {
  if (exportingPng || sectionSaving) return

  setExportingPng(true)
  setSaveMessage('')

  try {
    const dataUrl = await captureSection03()

    const centerName =
      center?.code || center?.name || 'CENTER'

    const safeCenterName = String(centerName)
      .replace(/[\\/:*?"<>|]/g, '_')

    const link = document.createElement('a')

    link.href = dataUrl
    link.download =
      `Monthly_Report_${safeCenterName}_${month}_${year}_Section03.png`

    document.body.appendChild(link)
    link.click()
    link.remove()

    setSaveStatus('success')
    setSaveMessage('ดาวน์โหลด PNG หัวข้อ 03 เรียบร้อยแล้ว')

  } catch (err) {
    console.error('Section 03 PNG error:', err)

    setSaveStatus('error')
    setSaveMessage(
      err.message || 'ไม่สามารถดาวน์โหลด PNG ได้'
    )

  } finally {
    setExportingPng(false)
  }
}


/* API สำหรับ MonthlyReport.jsx */
useImperativeHandle(ref, () => ({
  isReady: () => !loading && !error && rows.length === 4,

  hasData: () =>
    rows.some(row =>
      row.values.some(value => value != null) ||
      row.utilized != null
    ),

  exportPng: async () => {
    return await captureSection03()
  },

  exportPdfPages: async () => {
    const dataUrl = await captureSection03()

    return [{
      sectionNo: 3,
      orientation: 'landscape',
      dataUrl,
    }]
  },
}))


  if (loading) {
    return <div className="section03-message">
      กำลังโหลดสถิติรายปี...
    </div>
  }

  if (error) {
    return <div className="section03-message">
      โหลดข้อมูลไม่สำเร็จ: {error}
    </div>
  }

  return (
    
    
<div className={`section03-editor ${canEdit ? 'section03-editing' : ''}`}>

  {canEdit && (
    <aside className="section03-panel">

      <div className="section03-panel-head">
        <span>หัวข้อ 03</span>
        <h3>แก้ไขข้อมูลรายงาน</h3>
        <p>ปรับข้อมูลเฉพาะรายงานฉบับนี้</p>
      </div>

      <div className="section03-panel-body">

        <label className="section03-field-label">
          เลือกเดือนที่ต้องการแก้ไข
        </label>

        <select
          className="section03-month-select"
          value={editableMonthCount > 0 ? editMonth : ''}
          disabled={editableMonthCount === 0}
          onChange={e => setEditMonth(Number(e.target.value))}
        >
          {editableMonthCount === 0 && (
            <option value="">ยังไม่มีเดือนที่ปิดแล้ว</option>
          )}

          {MONTHS.slice(0, editableMonthCount).map(
            (name, index) => (
              <option key={name} value={index}>
                {name} พ.ศ. {selectedYear}
              </option>
            )
          )}
        </select>

        <div className="section03-edit-fields">
          {rows.map(row => (
            <label className="section03-edit-field" key={row.key}>
              <span>
                <i
                  style={{
                    background: CHART_COLORS[row.key],
                  }}
                />
                {row.name}
              </span>

              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                disabled={editableMonthCount === 0}
                value={row.values[editMonth] ?? ''}
                placeholder="ว่าง"
                onChange={e =>
                  handleManualChange(row.key, e.target.value)
                }
              />
            </label>
          ))}
        </div>

        
        {/* ===== UTILIZED TOTAL EDITOR ===== */}
        <div className="section03-utilized-block">

        <h4>ใช้ขยายผลได้</h4>

        <p>
            แก้ไขยอดรวมของปี แยกตามประเภทเหตุการณ์
        </p>

        
        {rows.map(row => (
            <div
                key={row.key}
                className="section03-utilized-field"
            >
                <span>
                <i
                    style={{
                    background: CHART_COLORS[row.key]
                    }}
                />
                {row.name}
                </span>

                <div className="section03-utilized-controls">

                <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={row.utilized ?? ''}
                    placeholder="ว่าง"
                    aria-label={`ใช้ขยายผลได้ ${row.name}`}
                    disabled={sectionSaving}
                    onChange={e =>
                    handleUtilizedChange(
                        row.key,
                        e.target.value
                    )
                    }
                />

                {manualUtilizedKeys.includes(row.key) && (
                    <button
                    type="button"
                    className="section03-auto-button"
                    disabled={sectionSaving}
                    onClick={() =>
                        enableAutoUtilized(row.key)
                    }
                    >
                    อัตโนมัติ
                    </button>
                )}

                </div>
            </div>
        ))}


        </div>

        
        <button
        type="button"
        className="section03-save-button"
        disabled={
            sectionSaving ||
            !hasManualChanges ||
            !report?.id
        }
        onClick={saveManualReport}
        >
        {sectionSaving
            ? 'กำลังบันทึก...'
            : 'บันทึกข้อมูลรายงาน'}
        </button>

        {saveMessage && (
        <p className={`section03-save-message ${saveStatus}`}>
            {saveMessage}
        </p>
        )}


        <button
          type="button"
          className="section03-reset-button"
          disabled={sectionSaving || !hasSourceDifferences}
          onClick={resetManualChanges}
        >
          คืนค่าจากสถิติรายปี
        </button>

        <p className="section03-edit-note">
        {hasManualChanges
            ? 'มีข้อมูลที่แก้ไขแต่ยังไม่ได้บันทึก'
            : 'ไม่มีการเปลี่ยนแปลงที่รอบันทึก'}
        </p>

        
        

        {/* SECTION 03 — PNG EXPORT */}
        <div className="section03-export-block">
        <h4>ส่งออกรายงาน</h4>

        <button
            type="button"
            className="section03-png-button"
            onClick={downloadSection03Png}
            disabled={
            exportingPng ||
            sectionSaving ||
            !report?.id
            }
        >
            {exportingPng
            ? 'กำลังสร้าง PNG...'
            : '↓ บันทึกหน้า 03 เป็น PNG'}
        </button>

        <small>
            บันทึกเฉพาะหัวข้อ 03 เป็นภาพ A4 แนวนอน
         </small>
      </div>

    </div>
  </aside>
)}

  <div className="section03-preview" ref={previewRef}>


            <div
            className="section03-paper-stage"
            style={{
                width: 1120 * previewScale,
                height: 792 * previewScale,
            }}
            >

            <div
                className="section03-paper"
                ref={paperRef}
                style={{
                    transform: `scale(${previewScale})`,
                }}
            >

          <div className="section03-heading">
            <h2>สรุปเหตุการณ์สะสมประจำเดือน</h2>
            <p>
              {center?.name || 'ศูนย์'} · พ.ศ. {selectedYear}
            </p>
          </div>

          <div className="section03-table-wrap">
            <table className="section03-table">
              <thead>
                <tr>
                  <th>ประเภทเหตุการณ์</th>
                  {MONTHS.map(name => (
                    <th key={name}>{name}</th>
                  ))}
                  <th>รวม</th>
                  <th>ใช้ขยายผลได้</th>
                </tr>
              </thead>

              <tbody>
                {rows.map(row => (
                  <tr key={row.key}>
                    <th>{row.name}</th>

                    {row.values.map((value, index) => (
                      <td key={index}>
                        {formatCount(value)}
                      </td>
                    ))}

                    <td className="section03-total">
                      {formatCount(row.total)}
                    </td>
                    <td className="section03-total">
                      {formatCount(row.utilized)}
                    </td>
                  </tr>
                ))}

                <tr className="section03-grand-total">
                  <th colSpan={13}>รวมทั้งหมด</th>
                  <td>{hasData ? formatCount(grandTotal) : ''}</td>
                  <td>{hasUtilized ? formatCount(grandUtilized) : ''}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <Section03Chart rows={rows} year={selectedYear} />

          <p className="section03-note">
            ข้อมูลอ้างอิงจากสถิติรายปี · ไม่รวมเดือนปัจจุบัน
          </p>
        </div>  {/* paper */}
        </div>    {/* paper-stage */}
      </div>      {/* preview */}
    </div>        // editor
   )
})

export default Section03Editor
