import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import html2canvas from 'html2canvas'
import { supabase } from '../../lib/supabase'
import './Section04Editor.css'

const PAPER_WIDTH = 1120
const PAPER_HEIGHT = 792


const MONTHS_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
]


const SHORT_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.',
  'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.',
  'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]


const REPAIR_CHART_SERIES = [
  {
    key: 'reports',
    label: 'จำนวนการแจ้งซ่อม',
    color: '#2563eb',
  },
  {
    key: 'sites',
    label: 'จำนวน Site เข้าซ่อม',
    color: '#d97706',
  },
  {
    key: 'withinSla',
    label: 'ไม่เกิน SLA',
    color: '#16a34a',
  },
  {
    key: 'overSla',
    label: 'เกิน SLA',
    color: '#dc2626',
  },
]


// ข้อมูลเริ่มต้น ยังไม่มีการกรอกข้อมูลจริง

const EMPTY_REPAIR_ROWS = MONTHS_TH.map(month => ({
  month,
  reports: null,
  sites: null,
  withinSla: null,
  overSla: null,
}))






const REPAIR_FIELDS = [
  {
    key: 'reports',
    label: 'จำนวนการแจ้งซ่อม',
    color: '#2563eb',
  },
  {
    key: 'sites',
    label: 'จำนวน Site เข้าซ่อม',
    color: '#d97706',
  },
  {
    key: 'withinSla',
    label: 'ไม่เกิน SLA',
    color: '#16a34a',
  },
  {
    key: 'overSla',
    label: 'เกิน SLA',
    color: '#dc2626',
  },
]





const formatRepairValue = value =>
  value == null
    ? '—'
    : Number(value).toLocaleString('th-TH')

const sumRows = (rows, key) => {
  const values = rows
    .map(row => row[key])
    .filter(value => value != null)

  if (!values.length) return null

  return values.reduce(
    (sum, value) => sum + Number(value),
    0
  )
}




function Section04Summary({ rows }) {

    const getTotal = key =>
    rows.reduce(
      (sum, row) => sum + Number(row[key] || 0),
      0
    )

  const reports = getTotal('reports')
  const sites = getTotal('sites')
  const withinSla = getTotal('withinSla')
  const overSla = getTotal('overSla')

  const slaTotal =
    withinSla != null && overSla != null
      ? withinSla + overSla
      : null

  const slaPercent =
    slaTotal > 0
      ? (withinSla / slaTotal * 100).toFixed(1)
      : null

  const cards = [
    {
    label: 'แจ้งซ่อมทั้งหมด',
    value: reports,
    color: 'blue',
    },
    {
      label: 'จำนวน Site เข้าซ่อม',
      value: sites,
      color: 'orange',
    },
    {
      label: 'ไม่เกิน SLA',
      value: withinSla,
      color: 'green',
      detail: slaPercent != null
        ? `${slaPercent}%`
        : null,
    },
    {
      label: 'เกิน SLA',
      value: overSla,
      color: 'red',
    },
  ]

  return (
    <div className="section04-summary">

      {cards.map(card => (
        <div
          key={card.label}
          className={`section04-summary-card ${card.color}`}
        >
          <span>{card.label}</span>

          <div className="section04-summary-value">
            <strong>
              {card.value.toLocaleString('th-TH')}
            </strong>

            <small>รายการ</small>
          </div>

          {card.detail && (
            <div className="section04-summary-detail">
              {card.detail}
            </div>
          )}
        </div>
      ))}

    </div>
  )
}



function Section04Chart({ rows }) {
  const values = rows.flatMap(row =>
    REPAIR_CHART_SERIES
        .map(series => row[series.key])
        .filter(value => value != null)
        .map(Number)
        .filter(value =>
        Number.isFinite(value) && value >= 0
        )
    )

  const hasData = values.some(value => value > 0)
  const maxValue = Math.max(0, ...values)

  const tickStep = Math.max(1, Math.ceil(maxValue / 4))
  const scaleMax = tickStep * 4

  const left = 28
  const bottom = 276
  const plotHeight = 228
  const plotWidth = 612

  const groupWidth = plotWidth / 12
  const barWidth = 8
  const barGap = 3
  const seriesCount = REPAIR_CHART_SERIES.length


  return (
    <div className="section04-chart-card">

      <div className="section04-chart-heading">
        <h3>สถิติการแจ้งซ่อมประจำปี</h3>
        
      </div>

      <svg
        className="section04-chart-svg"
        viewBox="0 0 660 330"
        role="img"
        aria-label="กราฟจำนวนการแจ้งซ่อมรายเดือน"
      >

        {/* เส้นตารางและแกน Y */}
        {Array.from({ length: 5 }, (_, index) => {
          const y =
            bottom - (index * plotHeight / 4)

          return (
            <g key={index}>
              <line
                x1={left}
                x2={left + plotWidth}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />

              <text
                x={left - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="#64748b"
              >
                {index * tickStep}
              </text>
            </g>
          )
        })}

        {/* เดือนและกราฟแท่ง */}
        {SHORT_MONTHS.map((month, monthIndex) => {
          const centerX =
            left +
            monthIndex * groupWidth +
            groupWidth / 2

          const row = rows[monthIndex]

          return (
            <g key={month}>
              {REPAIR_CHART_SERIES.map(
                (series, seriesIndex) => {
                  const raw = row?.[series.key]

                  if (raw == null) return null

                  const value = Number(raw)

                  if (
                    !Number.isFinite(value) ||
                    value <= 0
                  ) return null

                  const height =
                    value / scaleMax * plotHeight

                  const totalWidth =
                    barWidth * seriesCount +
                    barGap * (seriesCount - 1)

                  const x =
                    centerX -
                    totalWidth / 2 +
                    seriesIndex * (barWidth + barGap)

                  const y = bottom - height

                  return (
                    <g key={series.key}>
                      <title>
                        {month} - {series.label}: {value}
                      </title>

                      <rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={height}
                        rx="2"
                        fill={series.color}
                      />

                      
                    </g>
                  )
                }
              )}

              <text
                x={centerX}
                y={bottom + 24}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="#475569"
              >
                {month}
              </text>
            </g>
          )
        })}

        {/* สถานะยังไม่มีข้อมูล */}
        {!hasData && (
          <g>
            <text
              x="336"
              y="155"
              textAnchor="middle"
              fontSize="17"
              fontWeight="800"
              fill="#94a3b8"
            >
              ยังไม่มีข้อมูลการแจ้งซ่อม
            </text>

            <text
              x="336"
              y="179"
              textAnchor="middle"
              fontSize="12"
              fill="#94a3b8"
            >
              กราฟจะแสดงเมื่อมีการกรอกข้อมูล
            </text>
          </g>
        )}
      </svg>

      <div className="section04-chart-legend">
        {REPAIR_CHART_SERIES.map(series => (
          <span key={series.key}>
            <i
              style={{
                background: series.color,
              }}
            />
            {series.label}
          </span>
        ))}
      </div>

    </div>
  )
}




export default forwardRef(function Section04Editor({
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

  const [repairRows, setRepairRows] = useState(
        EMPTY_REPAIR_ROWS
    )
    
    const [loadingRows, setLoadingRows] = useState(false)
    const [loadError, setLoadError] = useState('')

    
    const [savingRows, setSavingRows] = useState(false)
    const [saveMessage, setSaveMessage] = useState('')
    const [saveStatus, setSaveStatus] = useState('')
    const [annualUpdatedAt, setAnnualUpdatedAt] = useState(null)
    const [exportingPng, setExportingPng] = useState(false)


  
    const selectedYear = Number(year)

    const calendarYear =
    selectedYear >= 2400
        ? selectedYear - 543
        : selectedYear

    const today = new Date()

    const editableMonthCount =
    calendarYear < today.getFullYear()
        ? 12
        : calendarYear === today.getFullYear()
        ? today.getMonth()
        : 0
    

    
    const selectedReportMonth = Number(month)

    const visibleMonthCount = Math.max(
    0,
    Math.min(
        editableMonthCount,
        Number.isInteger(selectedReportMonth)
        ? selectedReportMonth
        : 0
    )
    )    
    
    const displayRows = repairRows.map((row, index) => {
        if (index < visibleMonthCount) return row

        return {
            ...row,
            reports: null,
            sites: null,
            withinSla: null,
            overSla: null,
        }
    })

    
        

    const [editMonth, setEditMonth] = useState(
        Math.max(0, visibleMonthCount - 1)
    )

    useEffect(() => {
        setEditMonth(Math.max(0, visibleMonthCount - 1))
    }, [calendarYear, visibleMonthCount, center?.id])

    
    useEffect(() => {
        let active = true

        const loadRepairData = async () => {
            setLoadingRows(true)
            setLoadError('')
            setAnnualUpdatedAt(null)

            // เริ่มต้นด้วยข้อมูลว่าง
            setRepairRows(
            EMPTY_REPAIR_ROWS.map(row => ({ ...row }))
            )

            if (!center?.id) {
            setLoadingRows(false)
            return
            }

            try {
            
            
            const { data: annualSection, error: annualError } =
            await supabase
                .from('monthly_report_annual_sections')
                .select('content, updated_at')
                .eq('center_id', center?.id)
                .eq('report_year', Number(year))
                .eq('section_no', 4)
                .maybeSingle()

            if (annualError) throw annualError
            if (!active) return

            const content = annualSection?.content || null
            setAnnualUpdatedAt(annualSection?.updated_at ?? null)



            if (
                Number(content?.year) === calendarYear &&
                Array.isArray(content?.rows) &&
                content.rows.length === 12
            ) {
                const loadedRows = MONTHS_TH.map(
                (month, index) => {
                    const saved = content.rows[index] || {}

                    const getValue = key => {
                    const value = saved[key]

                    return Number.isSafeInteger(value) &&
                        value >= 0
                        ? value
                        : null
                    }

                    return {
                    month,
                    reports: getValue('reports'),
                    sites: getValue('sites'),
                    withinSla: getValue('withinSla'),
                    overSla: getValue('overSla'),
                    }
                }
                )

                setRepairRows(loadedRows)
            }
            } catch (err) {
            if (!active) return

            console.error('Load Section 04 error:', err)
            setLoadError(
                err.message || 'ไม่สามารถโหลดข้อมูลได้'
            )
            } finally {
            if (active) {
                setLoadingRows(false)
            }
        }
    }

    loadRepairData()

    return () => {
        active = false
    }
    }, [report?.id, center?.id, year, calendarYear])


  

  useEffect(() => {
    const element = previewRef.current
    if (!element) return

    const updateScale = () => {
      const availableWidth = element.clientWidth - 40

      if (availableWidth <= 100) return

      setPreviewScale(
        Math.min(1, availableWidth / PAPER_WIDTH)
      )
    }

    const observer = new ResizeObserver(updateScale)
    observer.observe(element)
    updateScale()

    

    
    return () => observer.disconnect()
  }, [canEdit])

  

const saveRepairData = async () => {
  if (
    !canEdit ||
    !center?.id ||
    savingRows ||
    loadingRows ||
    !!loadError ||
    visibleMonthCount === 0
  ) return


  setSavingRows(true)
  setSaveMessage('')
  setSaveStatus('')

  try {
    // บันทึกเฉพาะเดือนที่สิ้นสุดแล้ว
    const rowsToSave = repairRows.map((row, index) => {
      const isCompleted = index < editableMonthCount

      return {
        month: MONTHS_TH[index],
        reports: isCompleted ? row.reports : null,
        sites: isCompleted ? row.sites : null,
        withinSla: isCompleted ? row.withinSla : null,
        overSla: isCompleted ? row.overSla : null,
      }
    })







    
const nextContent = {
  version: 1,
  year: calendarYear,
  rows: rowsToSave,
}

const key = {
  center_id: Number(center.id),
  report_year: Number(year),
  section_no: 4,
}

const now = new Date().toISOString()

if (annualUpdatedAt) {
  // อัปเดตเฉพาะเมื่อข้อมูลยังเป็นเวอร์ชันที่เราโหลดมา
  const { data, error } = await supabase
    .from('monthly_report_annual_sections')
    .update({
      content: nextContent,
      updated_at: now,
    })
    .match({
      ...key,
      updated_at: annualUpdatedAt,
    })
    .select('updated_at')
    .maybeSingle()

  if (error) throw error

  if (!data) {
    throw new Error(
      'ข้อมูลรายปีมีการเปลี่ยนแปลง กรุณาโหลดหน้าใหม่ก่อนบันทึกอีกครั้ง'
    )
  }

  setAnnualUpdatedAt(data.updated_at)

} else {
  // ยังไม่มีข้อมูลกลางของศูนย์และปีนี้
  const { data, error } = await supabase
    .from('monthly_report_annual_sections')
    .insert({
      ...key,
      content: nextContent,
      updated_at: now,
    })
    .select('updated_at')
    .single()

  if (error) throw error

  setAnnualUpdatedAt(data.updated_at)
}


    setSaveStatus('success')
    setSaveMessage('บันทึกข้อมูลเรียบร้อยแล้ว')

    onDataChange?.()

  } catch (err) {
    console.error('Save Section 04 error:', err)

    setSaveStatus('error')
    setSaveMessage(
      err.message || 'ไม่สามารถบันทึกข้อมูลได้'
    )
  } finally {
    setSavingRows(false)
  }
}

const captureSection04 = async () => {
  const node = paperRef.current

  if (loadingRows || loadError || !node) {
    throw new Error('หน้ารายงานหัวข้อ 04 ยังไม่พร้อม')
  }

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  const originalTransform = node.style.transform
  const originalOrigin = node.style.transformOrigin

  try {
    // ใช้ขนาด A4 จริง ไม่ใช้ขนาดที่ย่อใน Preview
    node.style.transform = 'none'
    node.style.transformOrigin = 'top left'

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
      })
    })

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

const downloadSection04Png = async () => {
  if (exportingPng || savingRows || loadingRows) return

  setExportingPng(true)
  setSaveMessage('')
  setSaveStatus('')

  try {
    const dataUrl = await captureSection04()

    const centerName =
      center?.code || center?.name || 'CENTER'

    
    const safeCenterName = String(centerName)
        .replace(/[^a-zA-Z0-9ก-๙_-]/g, '_')


    const link = document.createElement('a')

    link.href = dataUrl
    link.download =
      `Monthly_Report_${safeCenterName}_${month}_${year}_Section04.png`

    document.body.appendChild(link)
    link.click()
    link.remove()

    setSaveStatus('success')
    setSaveMessage('ดาวน์โหลด PNG หัวข้อ 04 เรียบร้อยแล้ว')
  } catch (err) {
    console.error('Section 04 PNG error:', err)

    setSaveStatus('error')
    setSaveMessage(
      err.message || 'ไม่สามารถดาวน์โหลด PNG ได้'
    )
  } finally {
    setExportingPng(false)
  }
}


useImperativeHandle(ref, () => ({
  isReady: () => {
    return !loadingRows && !loadError && !!center?.id
  },

  hasData: () => {
    return displayRows.some(row =>
      REPAIR_FIELDS.some(field => row[field.key] != null)
    )
  },

  exportPdfPages: async () => {
    const dataUrl = await captureSection04()

    return [
      {
        orientation: 'landscape',
        dataUrl,
      },
    ]
  },
}))

  
return (
  <div className={`section04-editor ${canEdit ? 'section04-editing' : ''}`}>

    {canEdit && (
      <aside className="section04-panel">

        <div className="section04-panel-head">
          <span>หัวข้อ 04</span>
          <h3>แก้ไขรายงานการซ่อม</h3>
          <p>เลือกเดือนที่ต้องการแก้ไขข้อมูล</p>
        </div>

        <div className="section04-panel-body">
          <label
            className="section04-field-label"
            htmlFor="section04-edit-month"
          >
            เดือนที่ต้องการแก้ไข
          </label>

          <select
            id="section04-edit-month"
            className="section04-month-select"
            value={editMonth}            
            disabled={visibleMonthCount === 0}
            onChange={e =>
              setEditMonth(Number(e.target.value))
            }
          >
            {MONTHS_TH
              .slice(0, visibleMonthCount)
              .map((monthName, index) => (
                <option key={monthName} value={index}>
                  {monthName}
                </option>
              ))}
          </select>

          {visibleMonthCount === 0 && (
            <p className="section04-panel-notice">
              ยังไม่มีเดือนที่สิ้นสุดสำหรับปีนี้
            </p>
          )}

          
<div className="section04-panel-divider" />

    <div className="section04-edit-fields">
    {REPAIR_FIELDS.map(field => (
        <label
        key={field.key}
        className="section04-edit-field"
        >
        <span>
            <i style={{ background: field.color }} />
            {field.label}
        </span>

        <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            disabled={visibleMonthCount === 0 || loadingRows || !!loadError}
            value={
            repairRows[editMonth]?.[field.key] ?? ''
            }
            onFocus={e => e.target.select()}
            onChange={e => {
            const raw = e.target.value.replace(/\D/g, '')

            const nextValue =
                raw === '' ? null : Number(raw)

            if (
                nextValue !== null &&
                !Number.isSafeInteger(nextValue)
            ) return

            setRepairRows(previous =>
                previous.map((row, index) =>
                index === editMonth
                    ? { ...row, [field.key]: nextValue }
                    : row
                )
            )
            }}
        />
        </label>
    ))}
    </div>


    
    <div className="section04-save-actions">
        <button
            type="button"
            className="section04-save-button"
            onClick={saveRepairData}
            disabled={
            savingRows ||
            loadingRows ||
            !!loadError ||
            !center?.id ||
            visibleMonthCount === 0
            }
        >
            {savingRows
            ? 'กำลังบันทึก...'
            : 'บันทึกข้อมูล'}
        </button>
        </div>


        
        <div className="section04-export-block">
            <h4>ส่งออกรายงาน</h4>

            <button
                type="button"
                className="section04-png-button"
                onClick={downloadSection04Png}
                disabled={
                exportingPng ||
                savingRows ||
                loadingRows ||
                !!loadError
                }
            >
                {exportingPng
                ? 'กำลังสร้าง PNG...'
                : '↓ บันทึกหน้า 04 เป็น PNG'}
            </button>

            <small>
                บันทึกเฉพาะหัวข้อ 04 เป็นภาพ A4 แนวนอน
            </small>
        </div>


        {saveMessage && (
        <p
            role="status"
            className={`section04-save-message ${saveStatus}`}
        >
            {saveMessage}
        </p>
    )}

    
    <p className="section04-panel-notice">
        {loadingRows
            ? 'กำลังโหลดข้อมูลรายงาน...'
            : loadError
            ? `โหลดข้อมูลไม่สำเร็จ: ${loadError}`
            : 'ข้อมูลจะแสดงในตัวอย่างทันที แต่ยังไม่ได้บันทึก'}
    </p>


        </div>

      </aside>
    )}

    <div className="section04-preview" ref={previewRef}>

        <div
          className="section04-paper-stage"
          style={{
            width: PAPER_WIDTH * previewScale,
            height: PAPER_HEIGHT * previewScale,
          }}
        >
          
            <div
                className="section04-paper"
                ref={paperRef}
                style={{
                    transform: `scale(${previewScale})`,
                }}
            >

            <header className="section04-heading">
              <h2>สรุปรายงานการซ่อม ประจำปี {year}</h2>
              <p>
                {center?.name || 'ศูนย์กล้องวงจรปิด'}
              </p>
            </header>

            
            <Section04Summary rows={displayRows} />


            <div className="section04-content">
              
                <div className="section04-table-card">

                    <div className="section04-table-title">
                        <strong>ตารางสรุปรายงานการซ่อม ประจำปี {year}</strong>
                        
                    </div>

                    <table className="section04-table">
                        
                        <colgroup>
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '20%' }} />
                        </colgroup>


                        <thead>
                        <tr>
                            <th>เดือน</th>
                            <th className="section04-th-report">
                                จำนวนการแจ้ง
                            </th>
                            <th className="section04-th-site">
                                จำนวน Site เข้าซ่อม
                            </th>
                            <th className="section04-th-sla">
                                ไม่เกิน SLA
                            </th>
                            <th className="section04-th-over">
                                เกิน SLA
                            </th>
                        </tr>
                        </thead>

                        
                        <tbody>
                            {displayRows.map((row, index) => (
                                <tr key={row.month}>
                                
                                <td className="section04-month-cell">
                                    {row.month}
                                </td>


                                {REPAIR_FIELDS.map(field => (
                                    <td key={field.key}>                                    
                                    {index >= visibleMonthCount
                                        ? ''
                                        : formatRepairValue(row[field.key])}

                                    </td>
                                ))}
                                </tr>
                            ))}
                        </tbody>


                        <tfoot>
                            <tr>
                                <th>รวม</th>
                                    <td>{formatRepairValue(sumRows(displayRows, 'reports'))}</td>
                                    <td>{formatRepairValue(sumRows(displayRows, 'sites'))}</td>
                                    <td>{formatRepairValue(sumRows(displayRows, 'withinSla'))}</td>
                                    <td>{formatRepairValue(sumRows(displayRows, 'overSla'))}</td>
                            </tr>
                        </tfoot>
                    </table>

                    </div>


              
                <Section04Chart rows={displayRows} />

            </div>

          </div>
        </div>
      </div>
    </div>
  )
})
