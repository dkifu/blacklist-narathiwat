// SCT_TRUE_AGGREGATION_V4
// Read-only, six-center monthly data aggregation. No INSERT / UPDATE / DELETE.
// Unknown/unreported values stay null; never silently treat missing reports as zero.
import { supabase } from '../../lib/supabase'

export const SCT_REPORTING_CENTERS = [1, 2, 4, 7, 8, 9]
const INCIDENT_TYPES = ['unrest', 'accident', 'crime', 'lpr_ai']
const REPAIR_FIELDS = ['reports', 'sites', 'withinSla', 'overSla']
const CAM_ISSUES = ['branches', 'dark', 'direction', 'lighting', 'sky', 'obstruction', 'material']
const NUMBER_KEYS_6 = ['dayNormal', 'dayAbnormal', 'nightNormal', 'nightAbnormal']
const monthNames = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

const nonNegative = value => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const sumKnown = values => {
  const valid = values.map(nonNegative).filter(value => value !== null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null
}
const toId = value => String(value)
const readAll = async (table, query, pageSize = 500) => {
  const all = []
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await query(supabase.from(table).select('*'))
      .range(start, start + pageSize - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    all.push(...(data || []))
    if (!data?.length || data.length < pageSize) break
  }
  return all
}
const saved = (rows, reportId, sectionNo) =>
  rows.find(row => toId(row.report_id) === toId(reportId) &&
    Number(row.section_no) === sectionNo)?.content || null

export async function loadSctMergedData(entries, month, year) {
  const expected = SCT_REPORTING_CENTERS
  const actual = entries.map(entry => Number(entry.center.id))
  if (expected.some(id => !actual.includes(id))) {
    throw new Error('ไม่พบข้อมูลสถานะครบทั้ง 6 ศูนย์')
  }
  if (entries.some(entry => entry.error)) {
    throw new Error('อ่านสถานะบางศูนย์ไม่ได้ โปรดตรวจสอบสิทธิ์ฐานข้อมูล')
  }
  const active = entries.filter(entry => entry.report)
  const reportIds = active.map(entry => entry.report.id)
  const centerIds = expected
  const empty = { sections: {}, centerCount: active.length, expectedCount: 6 }
  if (!reportIds.length) return empty
  const cy = Number(year) >= 2400 ? Number(year) - 543 : Number(year)
  const dateStart = `${cy}-01-01`
  const dateEnd = `${cy + 1}-01-01`
  const sectionNums = [2, 3, 5, 6, 7, 10, 11, 12]

  // One shared source for preview and PDF. Source-center report IDs are never written.
  const [sectionRows, annualRows, case09Rows, yearReports, dailyStats, monthlyStats] =
    await Promise.all([
      readAll('monthly_report_sections', q => q.in('report_id', reportIds).in('section_no', sectionNums).order('report_id').order('section_no')),
      readAll('monthly_report_annual_sections', q => q.in('center_id', centerIds).eq('report_year', Number(year)).eq('section_no', 4).order('center_id')),
      readAll('monthly_report_section09_months', q => q.in('center_id', centerIds).eq('report_year', Number(year)).eq('report_month', Number(month)).order('center_id')),
      readAll('monthly_reports', q => q.in('center_id', centerIds).eq('report_year', Number(year)).order('center_id').order('report_month')),
      readAll('usage_daily_stats', q => q.in('center_id', centerIds).gte('usage_date', dateStart).lt('usage_date', dateEnd).order('center_id').order('usage_date').order('incident_type')),
      readAll('usage_monthly_stats', q => q.in('center_id', centerIds).gte('month_start', dateStart).lt('month_start', dateEnd).order('center_id').order('month_start').order('incident_type')),
    ])
  const yearReportsById = new Map(yearReports.map(row => [toId(row.id), row]))
  const yearReportIds = yearReports.map(row => row.id)
  const yearSections = yearReportIds.length
    ? await readAll('monthly_report_sections', q => q.in('report_id', yearReportIds).in('section_no', [10, 12]).order('report_id').order('section_no'))
    : []
  const result = { sections: {}, centerCount: active.length, expectedCount: 6 }
  const contents = number => active.map(e => ({
    center: e.center, report: e.report, content: saved(sectionRows, e.report.id, number),
  })).filter(e => e.content)

  // 02: one heatmap table and one map; retain location/coordinates of every row.
  const section02 = contents(2)
  result.sections[2] = {
    rows: section02.flatMap(({ center, content }) =>
      (Array.isArray(content.rows) ? content.rows : []).map(row => ({
        ...row, sctSourceCenter: center.name, sctSourceCenterId: center.id,
      }))),
    rowsPerPage: 14,
    saved: section02.length > 0,
  }

  // 03: sum per-center effective monthly stats after that center's manual overrides.
  // The DB monthly override supersedes daily totals for that center/month/type.
  const dailyMap = new Map()
  for (const row of dailyStats) {
    if (!INCIDENT_TYPES.includes(row.incident_type)) continue
    const mi = Number(String(row.usage_date).slice(5, 7)) - 1
    if (mi < 0 || mi > 11) continue
    const key = `${row.center_id}:${mi}:${row.incident_type}`
    dailyMap.set(key, (dailyMap.get(key) || 0) + Number(row.event_count || 0))
  }
  for (const row of monthlyStats) {
    if (!INCIDENT_TYPES.includes(row.incident_type) || row.event_count == null) continue
    const mi = Number(String(row.month_start).slice(5, 7)) - 1
    if (mi < 0 || mi > 11) continue
    dailyMap.set(`${row.center_id}:${mi}:${row.incident_type}`, Number(row.event_count))
  }
  const currentDate = new Date()
  const completed = cy < currentDate.getFullYear() ? 12
    : cy === currentDate.getFullYear() ? currentDate.getMonth() : 0
  const section03Contents = contents(3)
  const section03Rows = INCIDENT_TYPES.map(key => {
    const values = Array.from({ length: 12 }, (_, mi) => {
      if (mi >= completed) return null
      return sumKnown(entries.map(entry => {
        const base = dailyMap.get(`${entry.center.id}:${mi}:${key}`)
        const content = entry.report ? saved(sectionRows, entry.report.id, 3) : null
        const manual = Number(content?.year) === cy ? content?.overrides?.[key] : null
        if (manual && Object.prototype.hasOwnProperty.call(manual, mi)) {
          return nonNegative(manual[mi])
        }
        return base ?? null
      }))
    })
    const total = sumKnown(values)
    const utilized = sumKnown(entries.map(entry => {
      const c = entry.report ? saved(sectionRows, entry.report.id, 3) : null
      const m = Number(c?.year) === cy ? c?.utilizedOverrides : null
      if (m && Object.prototype.hasOwnProperty.call(m, key)) return m[key]
      return sumKnown(Array.from({length: 12}, (_, mi) => {
        if (mi >= completed) return null
        const manual = Number(c?.year) === cy ? c?.overrides?.[key] : null
        if (manual && Object.prototype.hasOwnProperty.call(manual, mi)) return manual[mi]
        return dailyMap.get(`${entry.center.id}:${mi}:${key}`) ?? null
      }))
    }))
    return {key, values, total, utilized: utilized ?? total}
  })
  result.sections[3] = { rows: section03Rows, saved: dailyStats.length > 0 || monthlyStats.length > 0 || section03Contents.length > 0 }

  // 04: annual rows with null rather than fabricated zero when nobody reported.
  const annual4 = annualRows.filter(row => Number(row.content?.year) === cy && Array.isArray(row.content?.rows))
  result.sections[4] = {
    rows: monthNames.map((name, mi) => ({
      month: name,
      ...Object.fromEntries(REPAIR_FIELDS.map(key => [key, sumKnown(annual4.map(row => row.content.rows?.[mi]?.[key]))])),
    })),
    saved: annual4.length > 0,
  }

  // 05: sum each equipment category, keeping source entry keys unmodified.
  const sec5 = contents(5)
  const keys5 = [...new Set(sec5.flatMap(entry =>
    (entry.content.items || []).map(item => item.key).filter(Boolean)))]
  result.sections[5] = {
    items: keys5.map(key => ({
      key,
      label: sec5.flatMap(entry => entry.content.items || []).find(item => item.key === key)?.label || key,
      count: sumKnown(sec5.map(entry => (entry.content.items || []).find(item => item.key === key)?.count)) ?? 0,
    })),
    saved: sec5.some(entry => Array.isArray(entry.content.items)),
  }

  // 06: total camera angles and day/night parameters.
  const sec6 = contents(6).filter(entry => entry.content.version === 1)
  result.sections[6] = {
    normal: sumKnown(sec6.map(entry => entry.content.normal)) ?? 0,
    issues: Object.fromEntries(CAM_ISSUES.map(key => [key,
      sumKnown(sec6.map(entry => entry.content.issues?.[key])) ?? 0])),
    parameter: Object.fromEntries(NUMBER_KEYS_6.map(key => [key,
      sumKnown(sec6.map(entry => entry.content.parameter?.[key])) ?? 0])),
    saved: sec6.length > 0,
  }

  // 07: merge unique event images in chronological source-center order.
  const sec7 = contents(7)
  result.sections[7] = {
    slides: sec7.flatMap(({ center, content }) =>
      (content.slides || []).filter(slide => typeof slide.image === 'string' && slide.image.startsWith('data:image/'))
        .map(slide => ({ ...slide, id: `${center.id}:${slide.id}`, sourceCenter: center.name }))),
    saved: sec7.length > 0,
  }

  // 09: actual request records plus their existing private Storage paths.
  const sec9 = case09Rows
  result.sections[9] = {
    cases: sec9.flatMap(row => (Array.isArray(row.cases) ? row.cases : [])
      .map(item => ({ ...item, id: `${row.center_id}:${item.id}`, sourceCenterId: row.center_id }))),
    saved: sec9.length > 0,
  }

  // 10: annual counts based on each source's saved monthly vehicles.
  const year10 = yearSections.filter(row => Number(row.section_no) === 10)
  const all10 = year10.map(row => ({ report: yearReportsById.get(toId(row.report_id)), content: row.content }))
    .filter(row => row.report && row.content)
  const current10 = contents(10)
  result.sections[10] = {
    vehicles: current10.flatMap(({ center, content }) =>
      (content.vehicles || []).map(v => ({...v, id: `${center.id}:${v.id}`, sourceCenter: center.name}))),
    annualCounts: Array.from({length: 12}, (_,mi) => sumKnown(all10
      .filter(row => Number(row.report.report_month) === mi + 1)
      .map(row => Array.isArray(row.content.vehicles) ? row.content.vehicles.length : null))),
    saved: current10.length > 0,
  }

  // 11: report one combined event section. A single no-events page only when all sources have no event.
  const sec11 = contents(11)
  const slides11 = sec11.flatMap(({center,content}) =>
    (content.slides || []).filter(slide => typeof slide.image === 'string' && slide.image.startsWith('data:image/'))
      .map(slide => ({...slide, id: `${center.id}:${slide.id}`, sourceCenter: center.name})))
  result.sections[11] = {
    mode: slides11.length ? 'pdf' : 'none',
    slides: slides11,
    noEventText: 'ไม่พบเหตุการณ์สำคัญจากระบบ LPR และ Face ID',
    saved: sec11.length > 0,
  }

  // 12: per-center annual stats, latest manual edits and current-month cases.
  const annuals12 = []
  const monthly12 = Array.from({length: 12}, () => [])
  const sourceByCenter = new Map()
  for (const row of yearSections.filter(row => Number(row.section_no) === 12)) {
    const r = yearReportsById.get(toId(row.report_id))
    if (!r || row.content?.version !== 1) continue
    if (!sourceByCenter.has(Number(r.center_id))) sourceByCenter.set(Number(r.center_id), [])
    sourceByCenter.get(Number(r.center_id)).push({month:Number(r.report_month),content:row.content})
  }
  const sec12Cases = []
  for (const entry of entries) {
    const records = (sourceByCenter.get(Number(entry.center.id)) || []).sort((a,b) => a.month-b.month)
    const latestAnnual = [...records].reverse().find(row => row.month <= Number(month))?.content?.annual
    if (Array.isArray(latestAnnual)) annuals12.push(latestAnnual)
    const current = records.find(row => row.month === Number(month))
    if (current?.content) {
      sec12Cases.push(...(Array.isArray(current.content.cases) ? current.content.cases : [])
        .map(c => ({...c, id: `${entry.center.id}:${c.id}`, sourceCenter: entry.center.name})))
    }
    const overrides = {}
    for (const r of records) {
      for (const [mk, edit] of Object.entries(r.content.alertStatEdits || {})) {
        const mi = Number(mk)
        if (mi < 1 || mi > 12 || !edit || typeof edit !== 'object') continue
        const previous = overrides[mi]
        if (!previous || (Date.parse(edit.at || '') || 0) >= (Date.parse(previous.at || '') || 0)) {
          overrides[mi] = edit
        }
      }
    }
    for (let mi=1; mi<=12; mi++) {
      const row = records.find(r => r.month===mi)
      const cases = Array.isArray(row?.content?.cases) ? row.content.cases : null
      let metric = cases ? {
        alerts: cases.length,
        matched: cases.filter(c => c.result === 'match').length,
        unmatched: cases.filter(c => c.result === 'not_match').length,
      } : null
      const edit = overrides[mi]
      if (edit && !edit.deleted && [edit.alerts,edit.matched,edit.unmatched].every(n => nonNegative(n) != null)) {
        metric = {alerts: edit.alerts, matched: edit.matched, unmatched: edit.unmatched}
      }
      if (metric) monthly12[mi-1].push(metric)
    }
  }
  result.sections[12] = {
    annual: Array.from({length:12}, (_,mi) => sumKnown(annuals12.map(a=>a[mi]))),
    cases: sec12Cases,
    otherStats: monthly12.map(rows => rows.length ? {
      alerts: sumKnown(rows.map(r => r.alerts)),
      matched: sumKnown(rows.map(r => r.matched)),
      unmatched: sumKnown(rows.map(r => r.unmatched)),
      pending: Math.max(0, sumKnown(rows.map(r => r.alerts)) - sumKnown(rows.map(r => r.matched)) - sumKnown(rows.map(r => r.unmatched))),
    } : null),
    saved: contents(12).length > 0 || annuals12.length > 0,
  }
  return result
}
