import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

// SCT overview is read-only. Original records belong to the six reporting centers.
const NUMBER = value => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const format = value => Number(value || 0).toLocaleString('th-TH')
const sum = (array, callback) => array.reduce((total, item) => total + (NUMBER(callback(item)) || 0), 0)
const dateYear = year => Number(year) >= 2400 ? Number(year) - 543 : Number(year)
const two = n => String(n).padStart(2, '0')
const sectionReady = (entry, sectionNo) => Boolean(entry.report && (sectionNo === 8 || entry.savedIds.includes(sectionNo)))

async function fetchAll(makeQuery, pageSize = 500) {
  const all = []
  let start = 0
  while (true) {
    const { data, error } = await makeQuery().range(start, start + pageSize - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < pageSize) break
    start += data.length
  }
  return all
}

const METRIC_LABELS = {
  reports: 'จำนวนการแจ้งซ่อม', sites: 'จำนวน Site เข้าซ่อม',
  withinSla: 'ไม่เกิน SLA', overSla: 'เกิน SLA',
  camera: 'Camera', switch8: 'Switch 8 port', power1224: 'Power supply 12–24 V',
  mediaConverter: 'Media Converter', power5: 'Power supply 5 V', computer: 'Computer',
  nvr: 'NVR', ups: 'UPS', dummyCamera: 'มุมกล้อง', fiberOptic: 'Fiber optic',
  sfp: 'SFP', lan: 'สาย LAN', electrical: 'ระบบไฟฟ้า', serviceBox: 'Service Box',
  selfRecovered: 'ใช้งานได้เอง',
  unrest: 'เหตุก่อความไม่สงบ', accident: 'อุบัติเหตุ',
  crime: 'อาชญากรรม', lpr_ai: 'LPR / AI',
  normal: 'มุมภาพปกติ', issues: 'มุมภาพต้องปรับปรุง',
  dayNormal: 'กลางวันปกติ', dayAbnormal: 'กลางวันผิดปกติ',
  nightNormal: 'กลางคืนปกติ', nightAbnormal: 'กลางคืนผิดปกติ',
  faceDetected: 'ตรวจจับใบหน้า', alerts: 'รายการแจ้งเตือน', matched: 'ตรงตามหมายจับ', notMatched: 'ไม่ตรงตามหมายจับ',
}

function metricsFor(sectionNo, content, month) {
  const m = {}
  if (!content) return m
  const add = (key, value) => {
    const n = NUMBER(value)
    if (n !== null) m[key] = (m[key] || 0) + n
  }
  switch (sectionNo) {
    case 2: {
      const rows = Array.isArray(content.rows) ? content.rows : []
      add('events', rows.length)
      break
    }
    case 4: {
      const row = Array.isArray(content.rows) ? content.rows[Number(month) - 1] : null
      if (row) for (const key of ['reports', 'sites', 'withinSla', 'overSla']) add(key, row[key])
      break
    }
    case 5: {
      for (const item of (Array.isArray(content.items) ? content.items : [])) {
        if (item?.key) add(item.key, item.count)
      }
      break
    }
    case 6: {
      add('normal', content.normal)
      add('issues', Object.values(content.issues || {}).reduce((v, n) => v + (NUMBER(n) || 0), 0))
      for (const key of ['dayNormal', 'dayAbnormal', 'nightNormal', 'nightAbnormal']) add(key, content.parameter?.[key])
      break
    }
    case 9:
      add('cases', Array.isArray(content.cases) ? content.cases.length : 0)
      break
    case 10:
      add('vehicles', Array.isArray(content.vehicles) ? content.vehicles.length : 0)
      break
    case 12: {
      const cases = Array.isArray(content.cases) ? content.cases : []
      add('alerts', cases.length)
      if (Array.isArray(content.annual)) add('faceDetected', content.annual[Number(month) - 1])
      add('matched', cases.filter(x => normalizeCaseResult(x.result) === 'match').length)
      add('notMatched', cases.filter(x => normalizeCaseResult(x.result) === 'not_match').length)
      break
    }
    default: break
  }
  return m
}

const normalizeCaseResult = value => {
  const v = String(value ?? '').trim().toLowerCase()
  if (['match', 'ตรง', 'ใบหน้าตรง', 'ยืนยันตรง'].includes(v)) return 'match'
  if (['not_match', 'ไม่ตรง', 'ใบหน้าไม่ตรง', 'ไม่ใช่'].includes(v)) return 'not_match'
  return 'pending'
}

const METRIC_NAMES = {
  events: 'เหตุการณ์ที่บันทึก', cases: 'จำนวนเคส', vehicles: 'รายการรถบัญชีดำ',
  ...METRIC_LABELS,
}

// Section 03 is populated from usage tables, not only monthly_report_sections.
async function loadSection03Totals(entries, year, signal) {
  const centerIds = entries.map(item => Number(item.center.id))
  const byCenter = Object.fromEntries(centerIds.map(id => [id, {}]))
  const calendarYear = dateYear(year)
  const today = new Date()
  const completedMonths = calendarYear < today.getFullYear() ? 12
    : calendarYear === today.getFullYear() ? today.getMonth() : 0
  if (!completedMonths) return byCenter
  const startDate = `${calendarYear}-01-01`
  const endDate = completedMonths === 12 ? `${calendarYear + 1}-01-01`
    : `${calendarYear}-${two(completedMonths + 1)}-01`
  const types = ['unrest', 'accident', 'crime', 'lpr_ai']
  const [daily, monthly] = await Promise.all([
    fetchAll(() => supabase.from('usage_daily_stats')
      .select('center_id,usage_date,incident_type,event_count')
      .in('center_id', centerIds)
      .in('incident_type', types)
      .gte('usage_date', startDate).lt('usage_date', endDate)
      .order('center_id').order('usage_date').order('incident_type')),
    fetchAll(() => supabase.from('usage_monthly_stats')
      .select('center_id,month_start,incident_type,event_count')
      .in('center_id', centerIds)
      .in('incident_type', types)
      .gte('month_start', startDate).lt('month_start', endDate)
      .order('center_id').order('month_start').order('incident_type')),
  ])
  if (signal.cancelled) return byCenter
  const values = new Map()
  for (const row of daily) {
    const k = `${row.center_id}|${Number(row.usage_date.slice(5, 7)) - 1}|${row.incident_type}`
    values.set(k, (values.get(k) || 0) + (NUMBER(row.event_count) || 0))
  }
  for (const row of monthly) {
    if (row.event_count == null) continue
    const k = `${row.center_id}|${Number(row.month_start.slice(5, 7)) - 1}|${row.incident_type}`
    values.set(k, NUMBER(row.event_count) || 0)
  }
  // Respect per-center Section03 overrides, when present.
  const reportIds = entries.filter(e => e.report).map(e => e.report.id)
  if (reportIds.length) {
    const overrideRows = await fetchAll(() => supabase.from('monthly_report_sections')
      .select('report_id,content').eq('section_no', 3).in('report_id', reportIds).order('report_id'))
    const entryByReport = new Map(entries.filter(e => e.report).map(e => [String(e.report.id), e]))
    for (const row of overrideRows) {
      const entry = entryByReport.get(String(row.report_id))
      if (!entry || Number(row.content?.year) !== calendarYear) continue
      for (const [type, changes] of Object.entries(row.content?.overrides || {})) {
        if (!types.includes(type) || !changes) continue
        for (const [index, value] of Object.entries(changes)) {
          const m = Number(index)
          if (!Number.isInteger(m) || m < 0 || m >= completedMonths) continue
          if (value === null) values.delete(`${entry.center.id}|${m}|${type}`)
          else if (Number.isSafeInteger(value) && value >= 0)
            values.set(`${entry.center.id}|${m}|${type}`, value)
        }
      }
    }
  }
  for (const [key, count] of values.entries()) {
    const [centerId,, type] = key.split('|')
    const target = byCenter[Number(centerId)]
    if (target) target[type] = (target[type] || 0) + count
  }
  return byCenter
}

async function loadMetrics(entries, sectionNo, month, year, signal) {
  const result = Object.fromEntries(entries.map(entry => [String(entry.center.id), {}]))
  const valid = entries.filter(entry => entry.report)
  if (!entries.length) return result
  if (sectionNo === 3) return loadSection03Totals(entries, year, signal)
  if ([7, 8, 11].includes(sectionNo)) return result // Avoid downloading large embedded PDFs/images.
  if (sectionNo === 4) {
    if (!valid.length) return result
    const annual = await fetchAll(() => supabase.from('monthly_report_annual_sections')
      .select('center_id,content').eq('section_no', 4)
      .eq('report_year', Number(year)).in('center_id', valid.map(e => e.center.id)).order('center_id'))
    if (signal.cancelled) return result
    for (const row of annual) result[String(row.center_id)] = metricsFor(4, row.content, month)
    return result
  }
  if (sectionNo === 9) {
    if (!valid.length) return result
    const rows = await fetchAll(() => supabase.from('monthly_report_section09_months')
      .select('center_id,cases').in('center_id', valid.map(e => e.center.id))
      .eq('report_year', Number(year)).eq('report_month', Number(month)).order('center_id'))
    if (signal.cancelled) return result
    for (const row of rows) result[String(row.center_id)] = metricsFor(9, { cases: row.cases }, month)
    return result
  }
  if (!valid.length) return result
  const ids = valid.map(e => e.report.id)
  const rowData = await fetchAll(() => supabase.from('monthly_report_sections')
    .select('report_id,content').in('report_id', ids).eq('section_no', sectionNo).order('report_id'))
  if (signal.cancelled) return result
  const lookup = new Map(valid.map(e => [String(e.report.id), String(e.center.id)]))
  for (const row of rowData) {
    const centerId = lookup.get(String(row.report_id))
    if (centerId) result[centerId] = metricsFor(sectionNo, row.content, month)
  }
  return result
}

export default function SctCombinedSection({ entries, sectionNo, month, year, onViewCenter }) {
  const [metrics, setMetrics] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const signal = { cancelled: false }
    setError('')
    setLoading(true)
    setMetrics({})
    loadMetrics(entries, sectionNo, month, year, signal)
      .then(result => { if (!signal.cancelled) setMetrics(result) })
      .catch(err => { if (!signal.cancelled) setError(err.message || 'โหลดข้อมูลรวมไม่สำเร็จ') })
      .finally(() => { if (!signal.cancelled) setLoading(false) })
    return () => { signal.cancelled = true }
  }, [entries, sectionNo, month, year])

  const totals = useMemo(() => {
    const out = {}
    for (const entry of entries) {
      if (!sectionReady(entry, sectionNo)) continue
      for (const [key, value] of Object.entries(metrics[String(entry.center.id)] || {})) {
        out[key] = (out[key] || 0) + (NUMBER(value) || 0)
      }
    }
    return out
  }, [entries, metrics, sectionNo])
  const keys = Object.keys(totals)
  const readyCount = entries.filter(entry => sectionReady(entry, sectionNo)).length
  const hasNumeric = keys.length > 0

  return (
    <section className="sct-combined-section">
      <header className="sct-combined-heading">
        <div>
          <span>ศชต. · รายงานรวมทุกศูนย์</span>
          <h4>หัวข้อ {two(sectionNo)} — ข้อมูลรวมของ {entries.length} ศูนย์</h4>
          <p>ข้อมูลต้นฉบับแยกตามศูนย์ กด “ดูรายศูนย์” เพื่อตรวจรายละเอียดในหน้าเดิม</p>
        </div>
        <strong>{readyCount}/{entries.length} ศูนย์มีข้อมูล</strong>
      </header>
      {error && <div className="sct-combined-error" role="alert">{error} — ไม่สามารถยืนยันยอดรวมได้</div>}
      {loading ? <p className="sct-combined-loading">กำลังตรวจสอบและรวบรวมข้อมูลรายศูนย์...</p> : (
        <>
          {hasNumeric && !error && (
            <div className="sct-combined-kpis">
              {keys.map(key => (
                <div key={key} className="sct-combined-kpi">
                  <span>{METRIC_NAMES[key] || key}</span><strong>{format(totals[key])}</strong>
                </div>
              ))}
            </div>
          )}
          {!hasNumeric && !error && (
            <p className="sct-combined-note">
              {[7, 11].includes(sectionNo)
                ? 'หัวข้อนี้เป็นภาพหรือเอกสาร ใช้วิธีรวบรวมต้นฉบับโดยไม่แก้ไขหรือบวกจำนวนหน้าเข้ากับข้อมูลสถิติ'
                : sectionNo === 8
                  ? 'หน้าคั่นภาคผนวกจะใช้ของศชต.เพียงครั้งเดียวในไฟล์ PDF รวม'
                  : 'ยังไม่พบตัวเลขที่ยืนยันได้จากข้อมูลที่บันทึกไว้'}
            </p>
          )}
        </>
      )}
      <div className="sct-combined-table-wrap">
        <table className="sct-combined-table">
          <thead><tr><th>ศูนย์</th><th>สถานะ</th>{!loading && hasNumeric && <th>รายละเอียดตัวเลข</th>}<th>ตรวจสอบ</th></tr></thead>
          <tbody>
            {entries.map(entry => {
              const saved = sectionReady(entry, sectionNo)
              const values = metrics[String(entry.center.id)] || {}
              return <tr key={entry.center.id}>
                <td><strong>{entry.center.name}</strong></td>
                <td><span className={`sct-combined-state ${entry.error ? 'unknown' : saved ? 'complete' : 'missing'}`}>
                  {entry.error ? 'ตรวจสอบไม่ได้' : saved ? 'มีข้อมูล' : entry.report ? 'ข้อมูลไม่ครบ' : 'ยังไม่มีรายงาน'}
                </span></td>
                {!loading && hasNumeric && <td>{Object.keys(values).length
                  ? Object.entries(values).map(([key, value]) => `${METRIC_NAMES[key] || key}: ${format(value)}`).join(' · ')
                  : '—'}</td>}
                <td><button type="button" disabled={!entry.report} onClick={() => onViewCenter(entry.center.id)}>ดูรายศูนย์</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {hasNumeric && sectionNo === 3 && <p className="sct-combined-note">ยอดรวมจากข้อมูลรายวันและค่าที่แก้รายเดือนของแต่ละศูนย์ โดยไม่ตัดเหตุการณ์ที่อาจซ้ำกันข้ามศูนย์</p>}
      {hasNumeric && sectionNo === 4 && <p className="sct-combined-note">ตัวเลขหัวข้อ 04 เป็นผลรวมของเดือนที่เลือกจากตารางรายปีของแต่ละศูนย์</p>}
      {hasNumeric && sectionNo === 12 && <p className="sct-combined-note">จำนวนเคสเป็นยอดจากรายการที่บันทึกในเดือนที่เลือก ยังไม่ใช่ยอดแจ้งเตือนที่อาจถูกแก้ย้อนหลังจากเดือนอื่น</p>}
    </section>
  )
}
