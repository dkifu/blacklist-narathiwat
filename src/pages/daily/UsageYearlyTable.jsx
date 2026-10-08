import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import ExcelJS from 'exceljs'
import { createPortal } from 'react-dom'
import './UsageYearlyTable.css'

// This component is a replacement ONLY for UsageYearlyTable.jsx.
// It never writes to usage_daily_stats.
const START_YEAR = 2023 // พ.ศ. 2566
const MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]
const INCIDENT_TYPES = [
  { key: 'unrest', label: 'เหตุก่อความไม่สงบ' },
  { key: 'accident', label: 'อุบัติเหตุทางถนน' },
  { key: 'crime', label: 'อาชญากรรม' },
  { key: 'lpr_ai', label: 'เหตุการณ์จากระบบ LPR / AI' },
]
const ALLOWED_TYPES = new Set(INCIDENT_TYPES.map((item) => item.key))
const MANUAL_TABLE = 'usage_monthly_stats'
const MAX_COUNT = 2147483647
const formatNumber = (value) => Number(value).toLocaleString('th-TH')
const cellKey = (monthIndex, type) => `${monthIndex}|${type}`

function getLocalDate() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Store month/type buckets with explicit existence so 0 != no data.
function addDailyRow(target, row) {
  if (!ALLOWED_TYPES.has(row.incident_type)) return
  const year = Number(row.usage_date?.slice(0, 4))
  const monthIndex = Number(row.usage_date?.slice(5, 7)) - 1
  if (year < START_YEAR || monthIndex < 0 || monthIndex > 11) return
  const month = (target[year] ||= {})[monthIndex] ||= {}
  const item = (month[row.incident_type] ||= { events: 0 })
  item.events += Number(row.event_count ?? 0)
}

function addManualRow(target, row) {
  if (!ALLOWED_TYPES.has(row.incident_type)) return
  const year = Number(row.month_start?.slice(0, 4))
  const monthIndex = Number(row.month_start?.slice(5, 7)) - 1
  if (year < START_YEAR || monthIndex < 0 || monthIndex > 11) return
  const month = (target[year] ||= {})[monthIndex] ||= {}
  // NULL means cancel manual override and fall back to daily calculation.
  month[row.incident_type] = row.event_count == null ? null : Number(row.event_count)
}

// Manual value (even 0) wins; otherwise keep deriving from daily entries.
function resolvedValue(dailyByYear, manualByYear, year, monthIndex, type) {
  const override = manualByYear[year]?.[monthIndex]?.[type]
  if (override != null) return override
  return dailyByYear[year]?.[monthIndex]?.[type]?.events ?? null
}

function yearDraft(dailyByYear, manualByYear, year) {
  const draft = {}
  MONTHS.forEach((_, monthIndex) => {
    INCIDENT_TYPES.forEach(({ key }) => {
      const value = resolvedValue(dailyByYear, manualByYear, year, monthIndex, key)
      draft[cellKey(monthIndex, key)] = value == null ? '' : String(value)
    })
  })
  return draft
}

function draftValueToNumber(value) {
  if (value === '') return null
  if (!/^\d+$/.test(value)) return NaN
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric > MAX_COUNT) return NaN
  return numeric
}


async function readYearlyImport(file, years) {
  // จำกัดไฟล์ Excel ไม่เกิน 5 MB
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('กรุณาเลือกไฟล์ Excel นามสกุล .xlsx')
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('ไฟล์ Excel ต้องมีขนาดไม่เกิน 5 MB')
  }

  const workbook = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()
  await workbook.xlsx.load(buffer)

  const sheet = workbook.getWorksheet('สถิติรายปี')

  if (!sheet) {
    throw new Error(
      'ไม่พบชีต "สถิติรายปี" กรุณาใช้ Template ที่ดาวน์โหลดจากระบบ'
    )
  }

  const entries = []

  for (const [yearIndex, year] of years.entries()) {
    // โครงสร้าง Template: ตารางละ 9 แถว
    const headerRow = 4 + yearIndex * 9
    const monthRow = headerRow + 1
    const firstDataRow = headerRow + 2

    const expectedYear = `พ.ศ. ${year + 543}`
    const actualYear = String(
      sheet.getCell(headerRow, 2).value ?? ''
    ).trim()

    if (actualYear !== expectedYear) {
      throw new Error(
        `ตารางปี ${year + 543} ไม่ถูกต้องหรือหายไป กรุณาใช้ Template ล่าสุด`
      )
    }

    // ตรวจชื่อเดือนทั้ง 12 เดือน
    MONTHS.forEach((month, monthIndex) => {
      const cell = sheet.getCell(monthRow, monthIndex + 2)
      const label = String(cell.value ?? '').trim()

      if (label !== month) {
        throw new Error(
          `หัวเดือน ${month} ปี ${year + 543} ไม่ถูกต้อง`
        )
      }
    })

    // ตรวจประเภทเหตุการณ์ทั้ง 4 แถว
    INCIDENT_TYPES.forEach((type, typeIndex) => {
      const rowNumber = firstDataRow + typeIndex

      const actualType = String(
        sheet.getCell(rowNumber, 1).value ?? ''
      ).trim()

      if (actualType !== type.label) {
        throw new Error(
          `ประเภทเหตุการณ์ที่แถว ${rowNumber} ไม่ถูกต้อง`
        )
      }

      MONTHS.forEach((month, monthIndex) => {
        const cell = sheet.getCell(
          rowNumber,
          monthIndex + 2
        )

        const rawValue = cell.value

        // ช่องว่างไม่ถูกนำเข้า และไม่ลบข้อมูลเดิม
        if (
          rawValue === null ||
          rawValue === undefined ||
          rawValue === '' ||
          rawValue === '—'
        ) {
          return
        }

        // ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป
        const value = typeof rawValue === 'number'
          ? rawValue
          : (
              typeof rawValue === 'string' &&
              /^\d+$/.test(rawValue.trim())
                ? Number(rawValue.trim())
                : NaN
            )

        if (
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > MAX_COUNT
        ) {
          throw new Error(
            `ข้อมูลไม่ถูกต้องที่ ${cell.address} ` +
            `(${month} ${year + 543}) ` +
            'กรุณากรอกจำนวนเต็มตั้งแต่ 0 ถึง 2,147,483,647'
          )
        }

        entries.push({
          year,
          monthIndex,
          type: type.key,
          month_start:
            `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`,
          event_count: value,
        })
      })
    })
  }

  if (entries.length === 0) {
    throw new Error('ไม่พบตัวเลขสำหรับนำเข้าในไฟล์ Excel')
  }

  const yearsWithData = [
    ...new Set(entries.map((item) => item.year))
  ]

  return {
    fileName: file.name,
    entries,
    total: entries.reduce(
      (sum, item) => sum + item.event_count, 0
    ),
    yearsWithData,
  }
}



async function createYearlyExcel(years, dailyByYear, manualByYear, isTemplate = false) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Usage Statistics Report'

  const sheet = workbook.addWorksheet('สถิติรายปี', {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  })

  sheet.columns = [
    { width: 35 },
    ...Array.from({ length: 12 }, () => ({ width: 9 })),
    { width: 16 },
    { width: 16 },
  ]

  sheet.views = [{ showGridLines: false }]

  const styleCell = (cell, bg, color = '172B46', bold = false) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${bg}` },
    }
    cell.font = {
      name: 'Tahoma',
      size: 10,
      bold,
      color: { argb: `FF${color}` },
    }
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD6E0EB' } },
      right: { style: 'thin', color: { argb: 'FFD6E0EB' } },
    }
  }

  const tones = {
    unrest: ['FCE8EA', '9D2135'],
    accident: ['FFF3D8', '916107'],
    crime: ['E0F5EC', '116D53'],
    lpr_ai: ['DDF2FC', '156B96'],
  }

  sheet.mergeCells('A1:O2')
  sheet.getCell('A1').value = 'รายงานสถิติการใช้งานระบบรายปี'
  styleCell(sheet.getCell('A1'), '17283F', 'FFFFFF', true)
  sheet.getCell('A1').font = {
    name: 'Tahoma',
    size: 17,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  }
  sheet.getRow(1).height = 30
  sheet.getRow(2).height = 20

  let start = 4

  for (const year of years) {
    const header = start
    const monthRow = start + 1
    const firstData = start + 2
    const lastData = firstData + INCIDENT_TYPES.length - 1
    const totalRow = lastData + 1

    sheet.mergeCells(`A${header}:A${monthRow}`)
    sheet.mergeCells(`B${header}:M${header}`)
    sheet.mergeCells(`N${header}:N${monthRow}`)
    sheet.mergeCells(`O${header}:O${monthRow}`)

    const heads = [
      [`A${header}`, 'เหตุการณ์'],
      [`B${header}`, `พ.ศ. ${year + 543}`],
      [`N${header}`, 'รวมเหตุการณ์'],
      [`O${header}`, 'ใช้ขยายผลได้'],
    ]

    heads.forEach(([address, label]) => {
      const cell = sheet.getCell(address)
      cell.value = label
      styleCell(cell, '203A59', 'FFFFFF', true)
    })

    sheet.getRow(header).height = 29

    MONTHS.forEach((month, index) => {
      const cell = sheet.getRow(monthRow).getCell(index + 2)
      cell.value = month
      styleCell(cell, 'E9F0F8', '203A59', true)
    })
    sheet.getRow(monthRow).height = 26

    INCIDENT_TYPES.forEach((type, typeIndex) => {
      const rowNumber = firstData + typeIndex
      const row = sheet.getRow(rowNumber)
      const [bg, fg] = tones[type.key]

      const label = row.getCell(1)
      label.value = type.label
      styleCell(label, bg, fg, true)
      label.alignment = {
        horizontal: 'left',
        vertical: 'middle',
        indent: 1,
      }

      MONTHS.forEach((_, monthIndex) => {
        const value = resolvedValue(
          dailyByYear, manualByYear,
          year, monthIndex, type.key
        )

        const cell = row.getCell(monthIndex + 2)
        cell.value = isTemplate ? null : (value == null ? '—' : value)
        cell.numFmt = '#,##0'
        styleCell(cell, typeIndex % 2 ? 'F7FAFD' : 'FFFFFF')
      })

      const total = row.getCell(14)
      total.value = {
        formula: `IF(COUNT(B${rowNumber}:M${rowNumber})=0,"—",SUM(B${rowNumber}:M${rowNumber}))`,
      }
      styleCell(total, 'DDEAF7', '17283F', true)

      const utilized = row.getCell(15)
      utilized.value = { formula: `N${rowNumber}` }
      styleCell(utilized, 'DDF5E8', '166445', true)

      row.height = 29
    })

    sheet.mergeCells(`A${totalRow}:M${totalRow}`)
    const summary = sheet.getCell(`A${totalRow}`)
    summary.value = `รวมเหตุการณ์ทั้งหมด ประจำปี พ.ศ. ${year + 543}`
    styleCell(summary, 'DDEAF7', '17283F', true)
    summary.alignment = {
      horizontal: 'left',
      vertical: 'middle',
      indent: 1,
    }

    const grandTotal = sheet.getCell(`N${totalRow}`)
    grandTotal.value = {
      formula: `IF(COUNT(N${firstData}:N${lastData})=0,"—",SUM(N${firstData}:N${lastData}))`,
    }
    styleCell(grandTotal, '203A59', 'FFFFFF', true)

    const grandUsed = sheet.getCell(`O${totalRow}`)
    grandUsed.value = { formula: `N${totalRow}` }
    styleCell(grandUsed, 'DDF5E8', '166445', true)

    sheet.getRow(totalRow).height = 33

    start = totalRow + 3
  }

  sheet.pageSetup.printArea = `A1:O${start - 3}`

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = isTemplate
    ? 'Template_สถิติการใช้งานรายปี.xlsx'
    : 'รายงานสถิติการใช้งานรายปี.xlsx'

  document.body.appendChild(link)
  link.click()
  link.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}


// Yearly report: editable manual overrides stored separately from daily records.
export default function UsageYearlyTable({
  selectedCenterId,
  onDirtyChange,
  onImportingChange,
  toolbarTarget,
  hideIntro = false
}) {
  const [dailyByYear, setDailyByYear] = useState({})
  const [manualByYear, setManualByYear] = useState({})
  const [draftByYear, setDraftByYear] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [savingYear, setSavingYear] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  
  // Excel import
  const importFileRef = useRef(null)
  const [importPreview, setImportPreview] = useState(null)
  const [importError, setImportError] = useState('')
  const [isReadingImport, setIsReadingImport] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    onImportingChange?.(isImporting)
  }, [isImporting, onImportingChange])

  useEffect(() => {
    return () => onImportingChange?.(false)
  }, [onImportingChange])


  const today = getLocalDate()
  const currentYear = Number(today.slice(0, 4))
  const [todayYear, todayMonth, todayDay] = today.split('-')
  const todayThai = `${todayDay}/${todayMonth}/${Number(todayYear) + 543}`
  const years = Array.from(
    { length: Math.max(0, currentYear - START_YEAR + 1) },
    (_, index) => START_YEAR + index
  )

  
  // สรุปเหตุการณ์ทั้งหมด ตั้งแต่ปี 2566 ถึงปีปัจจุบัน
  const overallRows = INCIDENT_TYPES.map((type) => {
    let total = 0
    let hasRecord = false

    years.forEach((year) => {
      MONTHS.forEach((_, monthIndex) => {
        const value = resolvedValue(
          dailyByYear,
          manualByYear,
          year,
          monthIndex,
          type.key
        )

        if (value !== null) {
          total += value
          hasRecord = true
        }
      })
    })

    return {
      ...type,
      total,
      hasRecord
    }
  })

  const overallTotal = overallRows.reduce(
    (sum, row) => sum + row.total,
    0
  )

  const overallHasRecord = overallRows.some(
    (row) => row.hasRecord
  )

    const maxOverallValue = Math.max(
    1,
    ...overallRows.map((row) => row.total)
  )

  const topOverallRow =
    overallRows.length > 0
      ? overallRows.reduce((max, row) =>
          row.total > max.total ? row : max
        )
      : null

  const getChangesForYear = (year) => {
    if (!draftByYear[year]) return []
    const changed = []
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      for (const type of INCIDENT_TYPES) {
        const key = cellKey(monthIndex, type.key)
        const original = resolvedValue(
          dailyByYear, manualByYear, year, monthIndex, type.key
        )
        const nextValue = draftValueToNumber(draftByYear[year][key] ?? '')
        if (nextValue !== original) {
          changed.push({ monthIndex, type: type.key, nextValue })
        }
      }
    }
    return changed
  }

  const hasUnsaved = Object.keys(draftByYear).some((year) =>
    getChangesForYear(Number(year)).length > 0
  )

  useEffect(() => {
    onDirtyChange?.(hasUnsaved)
  }, [hasUnsaved, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useEffect(() => {
    if (!hasUnsaved) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsaved])

  useEffect(() => {
    let active = true
    
    setDraftByYear({})
    setLoadError('')
    setSaveError('')
    setIsLoading(Boolean(selectedCenterId))
    if (!selectedCenterId) return () => { active = false }

    const load = async () => {
      try {
        const daily = {}
        const manual = {}
        const pageSize = 500
        let offset = 0

        // Read ALL daily rows; Supabase may otherwise stop at its row limit.
        while (true) {
          const { data, error } = await supabase
            .from('usage_daily_stats')
            .select('usage_date, incident_type, event_count')
            .eq('center_id', Number(selectedCenterId))
            .gte('usage_date', `${START_YEAR}-01-01`)
            .lte('usage_date', today)
            .order('usage_date', { ascending: true })
            .order('incident_type', { ascending: true })
            .range(offset, offset + pageSize - 1)
          if (!active) return
          if (error) throw error
          for (const row of data || []) addDailyRow(daily, row)
          offset += data?.length ?? 0
          if (!data?.length || data.length < pageSize) break
        }

        offset = 0
        while (true) {
          const { data, error } = await supabase
            .from(MANUAL_TABLE)
            .select('month_start, incident_type, event_count')
            .eq('center_id', Number(selectedCenterId))
            .gte('month_start', `${START_YEAR}-01-01`)
            .order('month_start', { ascending: true })
            .order('incident_type', { ascending: true })
            .range(offset, offset + pageSize - 1)
          if (!active) return
          if (error) throw error
          for (const row of data || []) addManualRow(manual, row)
          offset += data?.length ?? 0
          if (!data?.length || data.length < pageSize) break
        }

        if (active) {
          setDailyByYear(daily)
          setManualByYear(manual)
          setHasLoaded(true)
        }
      } catch (error) {
        if (!active) return
        console.error('Load yearly statistics error:', error)
        setLoadError(error.message || 'โหลดข้อมูลรายปีไม่สำเร็จ')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [selectedCenterId, refreshKey])

  const startEdit = (year) => {
    if (savingYear !== null || isLoading) return
    setSaveError('')
    setDraftByYear((previous) => ({
      ...previous,
      [year]: yearDraft(dailyByYear, manualByYear, year),
    }))
  }

  const cancelEdit = (year) => {
    if (savingYear !== null) return
    if (getChangesForYear(year).length > 0 &&
        !window.confirm(`ยกเลิกการแก้ไขปี พ.ศ. ${year + 543} โดยไม่บันทึกหรือไม่?`)) return
    setDraftByYear((previous) => {
      const next = { ...previous }
      delete next[year]
      return next
    })
    setSaveError('')
  }

  const changeDraft = (year, monthIndex, type, nextText) => {
    // Preserve empty string for fallback; accept only non-negative integers.
    if (!/^\d*$/.test(nextText) || nextText.length > 10) return
    if (nextText !== '' && Number(nextText) > MAX_COUNT) return
    setDraftByYear((previous) => ({
      ...previous,
      [year]: { ...(previous[year] || {}), [cellKey(monthIndex, type)]: nextText },
    }))
  }

  const saveYear = async (year) => {
    if (savingYear !== null || !draftByYear[year]) return
    const changes = getChangesForYear(year)
    if (changes.some((row) => Number.isNaN(row.nextValue))) {
      setSaveError('กรุณากรอกจำนวนเต็มตั้งแต่ 0 ถึง 2,147,483,647')
      return
    }
    if (!changes.length) {
      cancelEdit(year)
      return
    }
    if (year === currentYear && changes.some((row) => row.monthIndex === Number(todayMonth) - 1)) {
      if (!window.confirm('กำลังแก้ยอดของเดือนปัจจุบัน ซึ่งปกติคำนวณจากรายวัน หากบันทึก ยอดที่กรอกเองในช่องนี้จะมีผลแทนยอดรายวันในตารางรายปี ต้องการดำเนินการต่อหรือไม่?')) return
    }

    setSavingYear(year)
    setSaveError('')
    try {
      // Check monthly values against the version displayed when editing started.
      const { data: latest, error: checkError } = await supabase
        .from(MANUAL_TABLE)
        .select('month_start, incident_type, event_count')
        .eq('center_id', Number(selectedCenterId))
        .gte('month_start', `${year}-01-01`)
        .lte('month_start', `${year}-12-01`)
      if (checkError) throw checkError
      const live = {}
      for (const row of latest || []) {
        const index = Number(row.month_start.slice(5, 7)) - 1
        live[cellKey(index, row.incident_type)] = row.event_count
      }
      for (const change of changes) {
        const key = cellKey(change.monthIndex, change.type)
        const oldValue = manualByYear[year]?.[change.monthIndex]?.[change.type] ?? null
        const latestValue = live[key] ?? null
        if (oldValue !== latestValue) {
          throw new Error('มีผู้อื่นแก้ไขสถิติปีนี้แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก')
        }
        if (change.nextValue === null && oldValue === null) {
          throw new Error('ช่องที่ล้างเป็นยอดจากหน้ารายวัน หากต้องการให้เป็นศูนย์ให้กรอก 0 หรือแก้ที่หน้ารายวัน')
        }
      }

      // usage_monthly_stats already exists, has RLS, and is the intended
      // historical monthly source for the existing annual SQL view.
      const rowsToUpsert = changes
        .filter(({ nextValue }) => nextValue !== null)
        .map(({ monthIndex, type, nextValue }) => ({
          center_id: Number(selectedCenterId),
          month_start: `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`,
          incident_type: type,
          event_count: nextValue,
          utilized_count: nextValue, // Both annual totals must stay equal.
          updated_at: new Date().toISOString(),
        }))
      const rowsToDelete = changes.filter(({ nextValue }) => nextValue === null)

      if (rowsToUpsert.length) {
        const { error } = await supabase
          .from(MANUAL_TABLE)
          .upsert(rowsToUpsert, { onConflict: 'center_id,month_start,incident_type' })
        if (error) throw error
      }
      // Clearing a manual input restores the daily-derived value. Requires
      // the center-scoped DELETE policy in usage_monthly_clear_policy.sql.
      for (const row of rowsToDelete) {
        const oldValue = manualByYear[year]?.[row.monthIndex]?.[row.type]
        const monthDate = `${year}-${String(row.monthIndex + 1).padStart(2, '0')}-01`
        const { data, error } = await supabase
          .from(MANUAL_TABLE)
          .delete()
          .eq('center_id', Number(selectedCenterId))
          .eq('month_start', monthDate)
          .eq('incident_type', row.type)
          .eq('event_count', oldValue)
          .select('id')
        if (error) throw error
        if (!data?.length) {
          throw new Error('ล้างค่าที่กรอกเองไม่สำเร็จ กรุณาตรวจสอบสิทธิ์และโหลดข้อมูลล่าสุด')
        }
      }

      // Reload from database so a partial network error cannot leave stale
      // local state and any daily/monthly updates are reflected correctly.
      setDraftByYear((previous) => {
        const next = { ...previous }
        delete next[year]
        return next
      })
      setRefreshKey((value) => value + 1)
      window.alert(`บันทึกสถิติปี พ.ศ. ${year + 543} สำเร็จ`)
    } catch (error) {
      console.error('Save yearly statistics error:', error)
      setSaveError(error.message || 'บันทึกข้อมูลรายปีไม่สำเร็จ')
    } finally {
      setSavingYear(null)
    }
  }

  
  const handleImportFileChange = async (event) => {
    const file = event.target.files?.[0]

    // ให้เลือกไฟล์เดิมซ้ำได้
    event.target.value = ''

    if (!file) return

    if (!selectedCenterId) {
      setImportError('กรุณาเลือกศูนย์ก่อนนำเข้าข้อมูล')
      return
    }

    if (hasUnsaved || isImporting || isReadingImport) {
      setImportError('กรุณาบันทึกข้อมูลที่แก้ไขก่อนนำเข้า')
      return
    }

    const centerAtStart = String(selectedCenterId)

    setImportError('')
    setImportPreview(null)
    setIsReadingImport(true)

    try {
      const result = await readYearlyImport(file, years)

      setImportPreview({
        ...result,
        centerId: centerAtStart,
      })

    } catch (error) {
      console.error('Read Excel import error:', error)
      setImportError(
        error.message || 'ไม่สามารถอ่านไฟล์ Excel ได้'
      )
    } finally {
      setIsReadingImport(false)
    }
  }

  
  // เปรียบเทียบข้อมูลใน Excel กับข้อมูลรายปีที่โหลดไว้
  const getImportChanges = () => {
    if (!importPreview) {
      return {
        newRows: [],
        changedRows: [],
        sameRows: [],
      }
    }

    const newRows = []
    const changedRows = []
    const sameRows = []

    for (const entry of importPreview.entries) {
      const currentValue = resolvedValue(
        dailyByYear,
        manualByYear,
        entry.year,
        entry.monthIndex,
        entry.type
      )

      const item = {
        ...entry,
        previousValue: currentValue,
      }

      if (currentValue === null) {
        newRows.push(item)
      } else if (currentValue !== entry.event_count) {
        changedRows.push(item)
      } else {
        sameRows.push(item)
      }
    }

    return {
      newRows,
      changedRows,
      sameRows,
    }
  }

  const importChanges = getImportChanges()

  
  const handleConfirmImport = async () => {
    if (
      !importPreview ||
      importPreview.centerId !== String(selectedCenterId) ||
      isLoading ||
      isReadingImport ||
      isImporting ||
      savingYear !== null ||
      hasUnsaved
    ) return

    const pendingRows = [
      ...importChanges.newRows,
      ...importChanges.changedRows,
    ]

    if (pendingRows.length === 0) {
      window.alert('ข้อมูลใน Excel ตรงกับข้อมูลในระบบทั้งหมดแล้ว')
      return
    }

    const confirmed = window.confirm(
      `ยืนยันนำเข้าข้อมูล Excel?\n\n` +
      `เพิ่มใหม่: ${importChanges.newRows.length} ช่อง\n` +
      `เปลี่ยนแปลง: ${importChanges.changedRows.length} ช่อง\n\n` +
      `ข้อมูลเดิมที่แตกต่างจะถูกแทนที่ด้วยยอดจาก Excel\n` +
      `เฉพาะศูนย์ที่เลือกเท่านั้น`
    )

    if (!confirmed) return

    const centerId = Number(selectedCenterId)
    setIsImporting(true)
    setImportError('')

    try {
      // ตรวจสอบข้อมูลรายเดือนล่าสุด
      const monthStarts = [
        ...new Set(importPreview.entries.map((item) => item.month_start)),
      ]

      const { data: latestManual, error: manualError } = await supabase
        .from(MANUAL_TABLE)
        .select('month_start, incident_type, event_count')
        .eq('center_id', centerId)
        .in('month_start', monthStarts)

      if (manualError) throw manualError

      const liveManual = {}
      for (const row of latestManual || []) {
        addManualRow(liveManual, row)
      }

      // ตรวจสอบข้อมูลรายวันล่าสุดด้วย
      const liveDaily = {}
      let offset = 0
      const pageSize = 500

      while (true) {
        const { data, error } = await supabase
          .from('usage_daily_stats')
          .select('usage_date, incident_type, event_count')
          .eq('center_id', centerId)
          .gte('usage_date', `${START_YEAR}-01-01`)
          .lte('usage_date', getLocalDate())
          .order('usage_date', { ascending: true })
          .order('incident_type', { ascending: true })
          .range(offset, offset + pageSize - 1)

        if (error) throw error

        for (const row of data || []) {
          addDailyRow(liveDaily, row)
        }

        if (!data?.length || data.length < pageSize) break
        offset += data.length
      }

      const rowsToSave = []

      for (const entry of importPreview.entries) {
        const { year, monthIndex, type } = entry

        const previousManual =
          manualByYear[year]?.[monthIndex]?.[type] ?? null

        const latestManualValue =
          liveManual[year]?.[monthIndex]?.[type] ?? null

        const previousValue = resolvedValue(
          dailyByYear, manualByYear, year, monthIndex, type
        )

        const latestValue = resolvedValue(
          liveDaily, liveManual, year, monthIndex, type
        )

        // หยุดหากข้อมูลถูกแก้ไขระหว่างเตรียมนำเข้า
        if (
          previousManual !== latestManualValue ||
          previousValue !== latestValue
        ) {
          throw new Error(
            `ข้อมูลปี ${year + 543} เดือน ${MONTHS[monthIndex]} ` +
            `มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดและนำเข้าใหม่`
          )
        }

        if (latestValue === entry.event_count) continue

        rowsToSave.push({
          center_id: centerId,
          month_start: entry.month_start,
          incident_type: type,
          event_count: entry.event_count,
          utilized_count: entry.event_count,
          updated_at: new Date().toISOString(),
        })
      }

      if (rowsToSave.length > 0) {
        const { error } = await supabase
          .from(MANUAL_TABLE)
          .upsert(rowsToSave, {
            onConflict: 'center_id,month_start,incident_type',
          })

        if (error) throw error
      }

      setImportPreview(null)
      setRefreshKey((value) => value + 1)

      window.alert(
        `นำเข้าข้อมูลสำเร็จ ${rowsToSave.length} ช่อง`
      )
    } catch (error) {
      console.error('Import yearly Excel error:', error)
      setImportError(
        error.message || 'นำเข้าข้อมูลไม่สำเร็จ'
      )
    } finally {
      setIsImporting(false)
    }
  }




  const refresh = () => {
    if (savingYear !== null) return
    if (hasUnsaved && !window.confirm('มีข้อมูลที่ยังไม่บันทึก ต้องการทิ้งข้อมูลแล้วโหลดใหม่หรือไม่?')) return
    setDraftByYear({})
    setRefreshKey((value) => value + 1)
  }

  if (!selectedCenterId) {
    return <div className="usage-yearly-empty">กรุณาเลือกศูนย์เพื่อดูสถิติรายปี</div>
  }
  if (!hasLoaded) {
    return (
      <div className="usage-yearly-message" role="status">
        กำลังโหลดข้อมูลสถิติรายปี...
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="usage-yearly-message usage-yearly-message--error" role="alert">
        <span>โหลดข้อมูลรายปีไม่สำเร็จ: {loadError}</span>
        <button type="button" onClick={refresh}>ลองอีกครั้ง</button>
      </div>
    )
  }

  return (
    <div className="usage-yearly-report">
          
       {toolbarTarget && createPortal(
      <div className="usage-yearly-toolbar">
        
{/* ปุ่มดาวน์โหลด Excel */}
<button
  type="button"
  className="usage-yearly-excel-button"
  disabled={
    !hasLoaded ||
    isLoading ||
    isImporting ||
    savingYear !== null ||
    hasUnsaved
  }
  title="ดาวน์โหลดรายงานสถิติรายปีเป็น Excel"
  onClick={async () => {
    try {
      await createYearlyExcel(
        years,
        dailyByYear,
        manualByYear
      )
    } catch (error) {
      console.error('Excel export error:', error)
      window.alert('สร้างไฟล์ Excel ไม่สำเร็จ กรุณาลองอีกครั้ง')
    }
  }}
>
  ↓ ดาวน์โหลด Excel
</button>

{/* ปุ่มโหลด Template */}
<button
  type="button"
  className="usage-yearly-refresh usage-yearly-template-button"
  disabled={isLoading || isImporting || savingYear !== null}
  title="ดาวน์โหลด Template Excel สำหรับกรอกข้อมูลรายปี"
  onClick={async () => {
    try {
      await createYearlyExcel(
        years,
        dailyByYear,
        manualByYear,
        true
      )
    } catch (error) {
      console.error('Template export error:', error)
      window.alert('สร้าง Template Excel ไม่สำเร็จ กรุณาลองอีกครั้ง')
    }
  }}
>
  ↓ โหลด Template
</button>

  {/* ปุ่มนำเข้าข้อมูล */}
  <button
    type="button"
    className="usage-yearly-import-button"
    disabled={
      !selectedCenterId ||
      !hasLoaded ||
      isLoading ||
      isReadingImport ||
      isImporting ||
      savingYear !== null ||
      hasUnsaved
    }
    onClick={() => importFileRef.current?.click()}
    title="เลือกไฟล์ Excel เพื่อนำเข้าข้อมูลรายปี"
  >
    {isReadingImport
      ? '⌛ กำลังตรวจสอบ...'
      : '↑ นำเข้าข้อมูล'}
  </button>

  <input
    ref={importFileRef}
    type="file"
    accept=".xlsx"
    style={{ display: 'none' }}
    onChange={handleImportFileChange}
  />

  {/* ปุ่มโหลดข้อมูลล่าสุด */}
  <button
    type="button"
    className="usage-yearly-refresh"
    onClick={refresh}
    disabled={
      isLoading ||
      isReadingImport ||
      isImporting ||
      savingYear !== null
    }
    aria-busy={isLoading}
  >
    {isLoading
      ? '↻ กำลังอัปเดต...'
      : '↻ โหลดข้อมูลล่าสุด'}
  </button>

      </div>,
      toolbarTarget
    )}

    {!hideIntro && (
      <div className="usage-yearly-intro">
        <div>
          <h2>สถิติการใช้งานรายปี</h2>
          <p>สรุปเหตุการณ์รายเดือน ตั้งแต่ พ.ศ. 2566 จนถึงปัจจุบัน</p>
        </div>
      </div>
    )} 

          

          
          {importError && (
            <div
              className="usage-yearly-message usage-yearly-message--error"
              role="alert"
            >
              {importError}
            </div>
          )}

          
    {importPreview &&
      importPreview.centerId === String(selectedCenterId) && (
        <div className="usage-yearly-import-preview" role="status">

          <div className="usage-yearly-import-header">
            <span className="usage-yearly-import-success">
              ✓ อ่านไฟล์ Excel สำเร็จ
            </span>

            <span className="usage-yearly-import-filename">
              {importPreview.fileName}
            </span>
          </div>

          <div className="usage-yearly-import-details">

            <div className="usage-yearly-import-stat">
              ข้อมูล <strong>
                {importPreview.entries.length.toLocaleString('th-TH')} ช่อง
              </strong>
            </div>

            <div className="usage-yearly-import-stat">
              ปี พ.ศ. <strong>
                {importPreview.yearsWithData
                  .map((year) => year + 543)
                  .join(', ')}
              </strong>
            </div>

            <div className="usage-yearly-import-stat">
              รวม <strong>
                {importPreview.total.toLocaleString('th-TH')} เหตุการณ์
              </strong>
            </div>

            
              <div className="usage-yearly-import-comparison">

                <div className="usage-yearly-import-count usage-yearly-import-count--new">
                  เพิ่มใหม่
                  <strong>{importChanges.newRows.length.toLocaleString('th-TH')}</strong>
                  ช่อง
                </div>

                <div className="usage-yearly-import-count usage-yearly-import-count--changed">
                  เปลี่ยนแปลง
                  <strong>{importChanges.changedRows.length.toLocaleString('th-TH')}</strong>
                  ช่อง
                </div>

                <div className="usage-yearly-import-count usage-yearly-import-count--same">
                  ตรงกันแล้ว
                  <strong>{importChanges.sameRows.length.toLocaleString('th-TH')}</strong>
                  ช่อง
                </div>

              </div>


            <span className="usage-yearly-import-pending">
              ⓘ ยังไม่ได้บันทึก
            </span>

            <button
              type="button"
              className="usage-yearly-import-cancel"
              disabled={isImporting}
              onClick={() => {
                setImportPreview(null)
                setImportError('')
              }}
            >
              ✕ ยกเลิก
            </button>

            
            <button
              type="button"
              className="usage-yearly-import-confirm"
              disabled={
                isImporting ||
                isReadingImport ||
                isLoading ||
                savingYear !== null ||
                hasUnsaved ||
                (
                  importChanges.newRows.length +
                  importChanges.changedRows.length === 0
                )
              }
              onClick={handleConfirmImport}
            >
              {isImporting
                ? '◌ กำลังนำเข้า...'
                : '✓ ยืนยันนำเข้า'}
            </button>


          </div>
        </div>
      )}



      {saveError && <div className="usage-yearly-message usage-yearly-message--error" role="alert">{saveError}</div>}

      
      <div className="usage-yearly-dashboard">

        {/* ภาพรวมเหตุการณ์ทั้งหมดทุกปี */}
        <section className="usage-yearly-overall">
          <div className="usage-yearly-overall-header">
            <div>
              <h3>ภาพรวมเหตุการณ์ทั้งหมด</h3>
              <p>
                สถิติสะสมตั้งแต่ พ.ศ. 2566 ถึง {currentYear + 543}
              </p>
            </div>
          </div>

          <div className="usage-yearly-overall-body">
            {overallRows.map((row) => (
              <div
                key={row.key}
                className={`usage-yearly-overall-row usage-yearly-overall-row--${row.key}`}
              >
                <span className="usage-yearly-overall-name">
                  {row.label}
                </span>

                <strong>
                  {row.hasRecord ? formatNumber(row.total) : '—'}
                </strong>
              </div>
            ))}
          </div>

          <div className="usage-yearly-overall-footer">
            <span>รวมเหตุการณ์ทั้งหมด</span>

            <strong>
              {overallHasRecord ? formatNumber(overallTotal) : '—'}
            </strong>
          </div>
        </section>

      
        {/* กราฟสัดส่วนเหตุการณ์ทุกปี */}
        <section className="usage-yearly-distribution">
          <div className="usage-yearly-distribution-header">
            <h3>สัดส่วนเหตุการณ์ทั้งหมด</h3>
            <p>แยกตามประเภทเหตุการณ์ ตั้งแต่ พ.ศ. 2566</p>
          </div>

          
          <div className="usage-yearly-distribution-content">
            

            <div className="usage-yearly-horizontal-chart">
              {overallRows.map((row) => {
                const percentage =
                  overallTotal > 0
                    ? (row.total / overallTotal) * 100
                    : 0

                const widthPercent =
                  maxOverallValue > 0
                    ? (row.total / maxOverallValue) * 100
                    : 0

                return (
                  <div
                    key={row.key}
                    className={`usage-yearly-horizontal-item usage-yearly-horizontal-item--${row.key}`}
                  >
                    <div className="usage-yearly-horizontal-head">
                      <span className="usage-yearly-horizontal-name">
                        {row.label}
                      </span>

                      <div className="usage-yearly-horizontal-values">
                        <strong>
                          {row.hasRecord ? formatNumber(row.total) : '—'}
                        </strong>
                        <span>
                          {overallHasRecord
                            ? `${percentage.toFixed(1)}%`
                            : '0.0%'}
                        </span>
                      </div>
                    </div>

                    <div className="usage-yearly-horizontal-track">
                      <div
                        className="usage-yearly-horizontal-fill"
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </section>

        </div>
  


      {years.map((year) => {
        const editing = Boolean(draftByYear[year])
        const draft = draftByYear[year] || {}
        const rows = INCIDENT_TYPES.map((type) => {
          const values = MONTHS.map((_, monthIndex) =>
            resolvedValue(dailyByYear, manualByYear, year, monthIndex, type.key)
          )
          const total = values.reduce((sum, value) => sum + (value ?? 0), 0)
          return { ...type, values, total, hasRecord: values.some((value) => value != null) }
        })
        const hasAnyRecord = rows.some((row) => row.hasRecord)
        const allEvents = rows.reduce((sum, row) => sum + row.total, 0)
        const monthlyTotals = MONTHS.map((_, monthIndex) => rows.reduce(
          (sum, row) => sum + (editing
            ? draftValueToNumber(draft[cellKey(monthIndex, row.key)] ?? '') || 0
            : row.values[monthIndex] ?? 0),
          0
        ))
        const editingTotal = monthlyTotals.reduce((sum, value) => sum + value, 0)
        

        return (
          <section className="usage-yearly-year-card" key={year}>
            <div className="usage-yearly-year-title">
              <strong>พ.ศ. {year + 543}</strong>
              <div className="usage-yearly-year-actions">
                {year === currentYear && <span>ข้อมูลสะสมถึงวันที่ {todayThai}</span>}
                <button
                  type="button"
                  className={`usage-yearly-edit-btn ${editing ? 'usage-yearly-edit-btn--cancel' : ''}`}
                  disabled={savingYear !== null}
                  onClick={() => editing ? cancelEdit(year) : startEdit(year)}
                >
                  {editing ? '✕ ยกเลิก' : '✎ แก้ไข'}
                </button>
                <button
                  type="button"
                  className="usage-yearly-save-btn"
                  disabled={!editing || savingYear !== null}
                  onClick={() => saveYear(year)}
                >
                  {savingYear === year ? 'กำลังบันทึก...' : '✓ บันทึก'}
                </button>
              </div>
            </div>

            <div className="usage-yearly-table-scroll" tabIndex={0} aria-label={`ตารางรายปี พ.ศ. ${year + 543} เลื่อนได้ในแนวนอน`}>
              <table className="usage-yearly-table">
                <thead>
                  <tr>
                    <th rowSpan={2} scope="col" className="usage-yearly-type-heading">เหตุการณ์</th>
                    <th colSpan={12} scope="colgroup">สถิติการใช้งานระบบสะสม ปี พ.ศ. {year + 543}</th>
                    <th rowSpan={2} scope="col" className="usage-yearly-total-heading">รวมเหตุการณ์</th>
                    <th rowSpan={2} scope="col" className="usage-yearly-total-heading">ใช้ขยายผลได้</th>
                  </tr>
                  <tr>{MONTHS.map((month) => <th key={month} scope="col">{month}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const rowTotal = editing
                      ? MONTHS.reduce((sum, _, index) =>
                          sum + (draftValueToNumber(draft[cellKey(index, row.key)] ?? '') || 0), 0)
                      : row.total
                    return (
                      <tr key={row.key}>
                        <th scope="row" className={`usage-yearly-type usage-yearly-type--${row.key}`}>{row.label}</th>
                        {row.values.map((value, monthIndex) => (
                          <td key={monthIndex} className={year === currentYear && monthIndex > Number(todayMonth) - 1 ? 'usage-yearly-future' : ''}>
                            {editing ? (
                              <input
                                className="usage-yearly-number-input"
                                type="number" min="0" step="1" max={MAX_COUNT}
                                aria-label={`${row.label} ${MONTHS[monthIndex]} ${year + 543}`}
                                value={draft[cellKey(monthIndex, row.key)] ?? ''}
                                onChange={(event) => changeDraft(year, monthIndex, row.key, event.target.value)}
                                disabled={savingYear !== null}
                                placeholder="—"
                              />
                            ) : (value == null ? '—' : formatNumber(value))}
                          </td>
                        ))}
                        <td className="usage-yearly-total-cell">{editing || row.hasRecord ? formatNumber(rowTotal) : '—'}</td>
                        <td className="usage-yearly-total-cell">{editing || row.hasRecord ? formatNumber(rowTotal) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">รวมทั้งปี</th>
                    {MONTHS.map((_, monthIndex) => (
                      <td key={monthIndex} aria-label="ช่องสรุปรวม" />
                    ))}
                    <td>{editing || hasAnyRecord ? formatNumber(editing ? editingTotal : allEvents) : '—'}</td>
                    <td>{editing || hasAnyRecord ? formatNumber(editing ? editingTotal : allEvents) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )
      })}
      <p className="usage-yearly-note">
        — = ยังไม่มีข้อมูล, 0 = บันทึกเป็นศูนย์ • แก้ไขเฉพาะยอดรายเดือน • ช่องที่กรอกเองจะใช้ยอดนั้นแทนยอดคำนวณรายวัน • ล้างช่องที่เคยกรอกเองแล้วบันทึกเพื่อกลับไปใช้ยอดรายวัน
      </p>
    </div>
  )
}
