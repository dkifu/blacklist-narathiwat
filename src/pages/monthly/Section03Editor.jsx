
import { useEffect, useRef, useState } from 'react'
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

    

export default function Section03Editor({
  report,
  center,
  year,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const previewRef = useRef(null)
  const [previewScale, setPreviewScale] = useState(1)

  const selectedYear = Number(year)
  const calendarYear =
    selectedYear >= 2400 ? selectedYear - 543 : selectedYear

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      setRows([])

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

          const utilizedEntries = MONTHS.map(
            (_, monthIndex) =>
              monthIndex < completedMonths
                ? utilizedValues[`${monthIndex}|${type.key}`]
                : undefined
          )

          const utilized = utilizedEntries.some(
            value => value !== undefined
          )
            ? utilizedEntries.reduce(
                (sum, value) => sum + (value ?? 0), 0
              )
            : null

          return { ...type, values, total, utilized }
        })

        if (active) setRows(nextRows)
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
  }, [center?.id, calendarYear])

  
  // =========================================
  // SECTION 03 — AUTO FIT A4 PREVIEW
  // =========================================

  useEffect(() => {
    if (loading || error) return

    const element = previewRef.current
    if (!element) return

    const updateScale = () => {
      const styles = window.getComputedStyle(element)

      const paddingLeft =
        parseFloat(styles.paddingLeft) || 0

      const paddingRight =
        parseFloat(styles.paddingRight) || 0

      const availableWidth = Math.max(
        1,
        element.clientWidth - paddingLeft - paddingRight
      )

      const nextScale = Math.min(
        1,
        availableWidth / 1120
      )

      setPreviewScale(Math.max(0.1, nextScale))
    }

    updateScale()

    const observer = new ResizeObserver(updateScale)
    observer.observe(element)

    return () => observer.disconnect()
  }, [loading, error])


  const grandTotal = rows.reduce(
    (sum, row) => sum + (row.total ?? 0), 0
  )

  const grandUtilized = rows.reduce(
    (sum, row) => sum + (row.utilized ?? 0), 0
  )

  const hasData = rows.some(row => row.total != null)
  const hasUtilized = rows.some(row => row.utilized != null)

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
    
    <div className="section03-editor">
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
}
