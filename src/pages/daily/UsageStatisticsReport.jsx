import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import liff from '@line/liff'
import './UsageStatisticsReport.css'
import UsageYearlyTable from './UsageYearlyTable'

const usageSections = [
  {
    id: 'daily',
    title: 'บันทึกสถิติรายวัน',
    description: 'บันทึกและแก้ไขข้อมูลรายวัน พร้อมสรุปสถิติเดือนปัจจุบัน และแชร์ LINE Flex',
  },
  {
    id: 'yearly',
    title: 'สถิติการใช้งานรายปี',
    description: 'แสดงสถิติรายเดือนตั้งแต่ พ.ศ. 2566 พร้อมสรุปยอดสะสมทั้งหมด',
  },
]

const incidentTypes = [
  { key: 'unrest', label: 'เหตุก่อความไม่สงบ' },
  { key: 'accident', label: 'อุบัติเหตุทางถนน' },
  { key: 'crime', label: 'อาชญากรรม' },
  { key: 'lpr_ai', label: 'เหตุการณ์จากระบบ LPR / AI' },
]

const UNSAVED_WARNING = 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการทิ้งข้อมูลที่แก้ไขหรือไม่?'

// Default to yesterday in the user's local timezone (including month/year rollover).
function getYesterdayLocalDate() {
  const today = new Date()
  today.setDate(today.getDate() - 1)
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/* =========================================
   MONTHLY USAGE - LINE FLEX MESSAGE
========================================= */

const usageFlexColors = {
  unrest: '#E05567',
  accident: '#DFA600',
  crime: '#00A88B',
  lpr_ai: '#0EA5E9',
}

function createUsageMonthlyFlex({
  centerName,
  reportMonth,
  totals,
}) {
  const [year, month] = reportMonth.split('-').map(Number)

  const monthName = new Intl.DateTimeFormat('th-TH', {
    month: 'long',
  }).format(new Date(year, month - 1, 1))

  const periodText = `${monthName} ${year + 543}`

  const currentDateText = new Intl.DateTimeFormat(
    'th-TH-u-ca-buddhist',
    {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Bangkok',
    }
    ).format(new Date())

  const formatCount = (value) =>
    Number(value ?? 0).toLocaleString('th-TH')

  const grandTotal = incidentTypes.reduce(
    (sum, item) => sum + Number(totals[item.key] ?? 0),
    0
  )

  return {
    type: 'flex',
    altText: `สรุปสถิติการใช้งาน ${centerName} เดือน${periodText}`,

    contents: {
      type: 'bubble',
      size: 'mega',

      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#6B1B35',
        paddingAll: '18px',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: 'รายงานสถิติการใช้งานระบบ',
            weight: 'bold',
            size: 'md',
            color: '#FFFFFF',
            wrap: true,
          },
          {
            type: 'text',
            text: centerName,
            size: 'sm',
            color: '#FFFFFF',
            wrap: true,
          },
          {
            type: 'text',
            text: `ประจำวันที่ ${currentDateText}`,
            size: 'sm',
            color: '#FFE0EA',
          },
        ],
      },

      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        spacing: 'lg',

        contents: [
          ...incidentTypes.map((item) => ({
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',

            contents: [
              {
                type: 'text',
                text: '●',
                color: usageFlexColors[item.key],
                size: 'sm',
                flex: 0,
              },
              {
                type: 'text',
                text: item.label,
                size: 'sm',
                color: '#334155',
                wrap: true,
                flex: 1,
                margin: 'sm',
              },
              {
                type: 'text',
                text: formatCount(totals[item.key]),
                weight: 'bold',
                color: '#0F172A',
                size: 'md',
                align: 'end',
                flex: 0,
              },
            ],
          })),

          {
            type: 'separator',
          },

          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              {
                type: 'text',
                text: 'รวมเหตุการณ์ทั้งหมด',
                weight: 'bold',
                size: 'sm',
                color: '#6B1B35',
                flex: 1,
              },
              {
                type: 'text',
                text: formatCount(grandTotal),
                weight: 'bold',
                size: 'xl',
                color: '#6B1B35',
                align: 'end',
                flex: 0,
              },
            ],
          },
        ],
      },
    },
  }
}

function UsageStatisticsReport({ profile }) {
  const [activeSection, setActiveSection] = useState(null)
  const [hasUnsavedYearly, setHasUnsavedYearly] = useState(false)
  const [isImportingYearly, setIsImportingYearly] = useState(false)
  const [yearlyToolbarTarget, setYearlyToolbarTarget] = useState(null)

  const [usageDate, setUsageDate] = useState(getYesterdayLocalDate)

  const yesterdayDate = getYesterdayLocalDate()

  const daysScrollRef = useRef(null)
  const [centers, setCenters] = useState([])
  const [centersError, setCentersError] = useState('')

  const canManageAllCenters = ['admin', 'supervisor'].includes(profile?.role)
  const [selectedCenterId, setSelectedCenterId] = useState(
    canManageAllCenters ? '' : String(profile?.center_id ?? '')
  )

  const reportMonth = usageDate.slice(0, 7)
  const [reportYear, reportMonthNumber] = reportMonth.split('-').map(Number)
  const daysInReportMonth = new Date(reportYear, reportMonthNumber, 0).getDate()
  const reportDates = Array.from(
    { length: daysInReportMonth },
    (_, index) => `${reportMonth}-${String(index + 1).padStart(2, '0')}`
  )

  const selectionKey = `${selectedCenterId}|${reportMonth}`
  const [loadedKey, setLoadedKey] = useState('')
  const [dailyCountsByDate, setDailyCountsByDate] = useState({})
  const [savedCountsByDate, setSavedCountsByDate] = useState({})
  const [editedUsageCells, setEditedUsageCells] = useState({})
  const [isLoadingUsage, setIsLoadingUsage] = useState(false)
  const [usageLoadError, setUsageLoadError] = useState('')
  const [usageSaveError, setUsageSaveError] = useState('')
  const [isSavingUsage, setIsSavingUsage] = useState(false)

  // สถานะกำลังแชร์ LINE Flex
  const [isSharingUsageLine, setIsSharingUsageLine] =
    useState(false)

  const [reloadVersion, setReloadVersion] = useState(0)

  const hasUnsavedUsage = Object.keys(editedUsageCells).length > 0
  const isDataReady = Boolean(
    selectedCenterId &&
      loadedKey === selectionKey &&
      !isLoadingUsage &&
      !usageLoadError
  )

  // Read only active centers; regular users see their own center.
  useEffect(() => {
    let active = true

    const loadCenters = async () => {
      setCentersError('')
      if (!canManageAllCenters && !profile?.center_id) {
        setCenters([])
        return
      }

      let query = supabase
        .from('centers')
        .select('id, name, code, active')
        .eq('active', true)
        .order('name')

      if (!canManageAllCenters) {
        query = query.eq('id', profile.center_id)
      }

      const { data, error } = await query
      if (!active) return

      if (error) {
        console.error('Load usage centers error:', error)
        setCenters([])
        setCentersError(error.message || 'ไม่สามารถโหลดรายชื่อศูนย์ได้')
        return
      }
      setCenters(data || [])
    }

    loadCenters()
    return () => { active = false }
  }, [canManageAllCenters, profile?.center_id])

  useEffect(() => {
    if (!canManageAllCenters) {
      setSelectedCenterId(String(profile?.center_id ?? ''))
    }
  }, [canManageAllCenters, profile?.center_id])

  // Reload when the selected center/month changes. Ignore late replies.
  useEffect(() => {
    let active = true

    setDailyCountsByDate({})
    setSavedCountsByDate({})
    setEditedUsageCells({})
    setLoadedKey('')
    setUsageLoadError('')
    setUsageSaveError('')
    setIsLoadingUsage(Boolean(selectedCenterId && reportMonth))

    if (!selectedCenterId || !reportMonth) {
      return () => { active = false }
    }

    const loadDailyUsage = async () => {
      try {
        const firstDate = `${reportMonth}-01`
        const lastDate = `${reportMonth}-${String(daysInReportMonth).padStart(2, '0')}`
        const { data, error } = await supabase
          .from('usage_daily_stats')
          .select('usage_date, incident_type, event_count')
          .eq('center_id', Number(selectedCenterId))
          .gte('usage_date', firstDate)
          .lte('usage_date', lastDate)
          .order('usage_date')

        if (!active) return
        if (error) throw error

        const mapped = {}
        for (const row of data || []) {
          if (!mapped[row.usage_date]) mapped[row.usage_date] = {}
          mapped[row.usage_date][row.incident_type] = Number(row.event_count ?? 0)
        }

        setDailyCountsByDate(mapped)
        setSavedCountsByDate(mapped)
        setLoadedKey(selectionKey)
        setUsageLoadError('')
      } catch (error) {
        if (!active) return
        console.error('Load daily usage error:', error)
        setUsageLoadError(error.message || 'ไม่สามารถโหลดข้อมูลได้')
      } finally {
        if (active) setIsLoadingUsage(false)
      }
    }

    loadDailyUsage()
    return () => { active = false }
  }, [selectedCenterId, reportMonth, daysInReportMonth, reloadVersion])

  // Warn on refresh/closing the tab when local changes have not been saved.
  useEffect(() => {
    if (!hasUnsavedUsage) return undefined
    const warnBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedUsage])

  // Keep the selected day visible when opening the form or choosing another day.
  useEffect(() => {
    if (activeSection !== 'daily') return
    const scroller = daysScrollRef.current
    const selectedHeader = scroller?.querySelector('[data-usage-selected="true"]')
    if (!scroller || !selectedHeader) return

    const scrollRect = scroller.getBoundingClientRect()
    const selectedRect = selectedHeader.getBoundingClientRect()
    const centeredLeft = scroller.scrollLeft + selectedRect.left - scrollRect.left -
      (scroller.clientWidth - selectedRect.width) / 2

    scroller.scrollTo({ left: Math.max(0, centeredLeft), behavior: 'smooth' })
  }, [activeSection, usageDate])

  const discardLocalChanges = () => {
    setDailyCountsByDate(savedCountsByDate)
    setEditedUsageCells({})
  }

  const confirmDiscard = () =>
    !(hasUnsavedUsage || hasUnsavedYearly) ||
    window.confirm(UNSAVED_WARNING)

  const handleBack = () => {
    if (isSavingUsage || isLoadingUsage || isImportingYearly) return
    if (!confirmDiscard()) return
    if (hasUnsavedUsage) discardLocalChanges()
    setActiveSection(null)
  }

  const handleDateChange = (nextDate) => {
    if (!nextDate || nextDate < '2023-01-01' || isSavingUsage) return
    if (nextDate === usageDate) return
    // A different day becomes the *only* editable column. Don't silently keep
    // unsaved edits in a different day's locked column.
    if (!confirmDiscard()) return
    if (hasUnsavedUsage) discardLocalChanges()
    setUsageDate(nextDate)
  }

  const handleCenterChange = (nextCenterId) => {
    if (
      nextCenterId === selectedCenterId ||
      isSavingUsage ||
      isImportingYearly
    ) return
    if (!confirmDiscard()) return
    setSelectedCenterId(nextCenterId)
  }

  const handleReloadUsage = () => {
    if (isSavingUsage || !confirmDiscard()) return
    setReloadVersion((version) => version + 1)
  }

  const handleDailyCountChange = (date, type, rawValue) => {
    if (!isDataReady || isSavingUsage || date !== usageDate) return

    const nextValue = Math.max(0, Math.trunc(Number(rawValue) || 0))
    const originalValue = Number(savedCountsByDate[date]?.[type] ?? 0)
    const cellKey = `${date}|${type}`

    setDailyCountsByDate((previous) => ({
      ...previous,
      [date]: { ...(previous[date] || {}), [type]: nextValue },
    }))

    setEditedUsageCells((previous) => {
      const updated = { ...previous }
      if (nextValue === originalValue) delete updated[cellKey]
      else updated[cellKey] = true
      return updated
    })
  }

  // Only write changed event_count fields. Never overwrite utilized_count.
  const handleSaveUsage = async () => {
    if (isSavingUsage || !isDataReady || !hasUnsavedUsage) return

    const validTypes = new Set(incidentTypes.map((item) => item.key))
    const validDates = new Set(reportDates)
    const changedRows = Object.keys(editedUsageCells)
      .filter((key) => editedUsageCells[key])
      .map((key) => {
        const [date, type] = key.split('|')
        if (date !== usageDate || !validDates.has(date) || !validTypes.has(type)) return null
        return {
          center_id: Number(selectedCenterId),
          usage_date: date,
          incident_type: type,
          event_count: Number(dailyCountsByDate[date]?.[type] ?? 0),
        }
      })
      .filter(Boolean)

    if (!changedRows.length) return
    setIsSavingUsage(true)
    setUsageSaveError('')

    try {
      const { data: existingRows, error: readError } = await supabase
        .from('usage_daily_stats')
        .select('id, usage_date, incident_type, event_count')
        .eq('center_id', Number(selectedCenterId))
        .gte('usage_date', `${reportMonth}-01`)
        .lte('usage_date', `${reportMonth}-${String(daysInReportMonth).padStart(2, '0')}`)

      if (readError) throw readError

      const currentByKey = new Map(
        (existingRows || []).map((row) => [
          `${row.usage_date}|${row.incident_type}`,
          row,
        ])
      )

      const toInsert = []
      const toUpdate = []

      for (const row of changedRows) {
        const key = `${row.usage_date}|${row.incident_type}`
        const current = currentByKey.get(key)
        const lastSeen = Number(savedCountsByDate[row.usage_date]?.[row.incident_type] ?? 0)
        const currentValue = current ? Number(current.event_count ?? 0) : 0

        // Another operator has changed this cell since it was loaded.
        if (currentValue !== lastSeen && currentValue !== row.event_count) {
          throw new Error(
            `ข้อมูลวันที่ ${row.usage_date} ถูกแก้ไขจากเครื่องอื่น กรุณาตรวจสอบก่อนบันทึกใหม่`
          )
        }

        // Already updated (e.g., retry after a partial network failure).
        if (current && currentValue === row.event_count) continue
        if (current) toUpdate.push({ ...row, id: current.id, previousCount: currentValue })
        else toInsert.push(row)
      }

      // For new rows, DB defaults utilized_count to 0.
      if (toInsert.length) {
        const { error: insertError } = await supabase
          .from('usage_daily_stats')
          .insert(toInsert)
        if (insertError) {
          if (insertError.code === '23505') {
            throw new Error('มีการเพิ่มข้อมูลรายการเดียวกันจากเครื่องอื่น กรุณาตรวจสอบแล้วบันทึกใหม่')
          }
          throw insertError
        }
      }

      // Update only event_count, keeping any existing utilized_count unchanged.
      // Update in small parallel groups to avoid too many simultaneous requests.
      for (let start = 0; start < toUpdate.length; start += 8) {
        const chunk = toUpdate.slice(start, start + 8)
        const results = await Promise.all(
          chunk.map((row) =>
            supabase
              .from('usage_daily_stats')
              .update({ event_count: row.event_count })
              .eq('id', row.id)
              .eq('event_count', row.previousCount)
              .select('id')
          )
        )

        for (const result of results) {
          if (result.error) throw result.error
          if (!result.data?.length) {
            throw new Error('ข้อมูลถูกเปลี่ยนแปลงระหว่างบันทึก กรุณาตรวจสอบก่อนลองอีกครั้ง')
          }
        }
      }

      setSavedCountsByDate(dailyCountsByDate)
      setEditedUsageCells({})
      window.alert('บันทึกสถิติรายวันสำเร็จ')
    } catch (error) {
      console.error('Save daily usage error:', error)
      setUsageSaveError(error.message || 'เกิดข้อผิดพลาด')
      window.alert(`บันทึกข้อมูลไม่สำเร็จ: ${error.message || 'เกิดข้อผิดพลาด'}`)
    } finally {
      setIsSavingUsage(false)
    }
  }

   /* =========================================
   LOAD MONTHLY TOTALS FOR LINE FLEX
    ========================================= */

    const loadUsageMonthlyTotals = async () => {
    if (!selectedCenterId || !isDataReady) {
        throw new Error('กรุณาเลือกศูนย์และรอโหลดข้อมูลให้เสร็จ')
    }

    if (hasUnsavedUsage) {
        throw new Error('กรุณาบันทึกข้อมูลที่แก้ไขก่อนแชร์ LINE')
    }

    const firstDate = `${reportMonth}-01`

    const lastDate =
        `${reportMonth}-${String(daysInReportMonth).padStart(2, '0')}`

    const { data, error } = await supabase
        .from('usage_daily_stats')
        .select('incident_type, event_count')
        .eq('center_id', Number(selectedCenterId))
        .gte('usage_date', firstDate)
        .lte('usage_date', lastDate)

    if (error) throw error

    const totals = {
        unrest: 0,
        accident: 0,
        crime: 0,
        lpr_ai: 0,
    }

    for (const row of data || []) {
        if (
        Object.prototype.hasOwnProperty.call(
            totals,
            row.incident_type
        )
        ) {
        totals[row.incident_type] +=
            Number(row.event_count ?? 0)
        }
    }

    return totals
    }

    /* =========================================
    SHARE MONTHLY USAGE VIA LINE FLEX
    ========================================= */

    const handleShareUsageLine = async () => {
    if (isSharingUsageLine || isSavingUsage) return

    if (hasUnsavedUsage) {
        window.alert('กรุณาบันทึกข้อมูลก่อนแชร์ LINE')
        return
    }

    if (!selectedCenterId || !isDataReady) {
        window.alert('กรุณาเลือกศูนย์และรอโหลดข้อมูลให้เสร็จ')
        return
    }

    const liffId = import.meta.env.VITE_LIFF_ID

    if (!liffId) {
        window.alert('ไม่พบการตั้งค่า LIFF ID')
        return
    }

    setIsSharingUsageLine(true)

    try {
        // 1. อ่านยอดรวมจาก Supabase
        const totals = await loadUsageMonthlyTotals()

        // 2. หาชื่อศูนย์ที่กำลังเลือก
        const selectedCenter = centers.find(
        (center) =>
            String(center.id) === String(selectedCenterId)
        )

        if (!selectedCenter) {
        throw new Error('ไม่พบข้อมูลศูนย์ที่เลือก')
        }

        const centerName = selectedCenter.code
        ? `${selectedCenter.name} (${selectedCenter.code})`
        : selectedCenter.name

        // 3. สร้าง Flex Message
        const flexMessage = createUsageMonthlyFlex({
        centerName,
        reportMonth,
        totals,
        })

        // 4. เริ่ม LINE LIFF
        await liff.init({ liffId })

        // 5. ตรวจสอบ LINE Login
        if (!liff.isLoggedIn()) {
        liff.login({
            redirectUri: window.location.href,
        })
        return
        }

        // 6. ตรวจสอบความสามารถในการแชร์
        if (!liff.isApiAvailable('shareTargetPicker')) {
        throw new Error(
            'ไม่สามารถเปิดหน้าต่างแชร์ LINE ได้ กรุณาตรวจสอบการตั้งค่า LIFF'
        )
        }

        // 7. เปิดหน้าต่างเลือกเพื่อนหรือกลุ่ม LINE
        await liff.shareTargetPicker(
        [flexMessage],
        {
            isMultiple: true,
        }
        )

    } catch (error) {
        console.error('Usage LINE Flex Error:', error)

        window.alert(
        `แชร์ LINE ไม่สำเร็จ: ${
            error?.message || 'เกิดข้อผิดพลาด'
        }`
        )

    } finally {
        setIsSharingUsageLine(false)
    }
    }

  return (
    <div className="usage-report-page">
      <header className="usage-report-hero">
        <span className="usage-report-eyebrow">USAGE STATISTICS</span>
        <h1>รายงานสถิติการใช้งานระบบ</h1>
        <p>จัดการและสรุปสถิติการใช้งานระบบ ตั้งแต่วันที่ 1 มกราคม 2566</p>
      </header>

      {activeSection === null ? (
        <div className="usage-report-grid">
          {usageSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="usage-report-section usage-report-section--button"
              onClick={() => setActiveSection(section.id)}
            >
              <h2>{section.title}</h2>
              <p>{section.description}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="usage-report-section usage-report-section--detail">
          <button
            type="button"
            className="daily-hub-back-button"
            onClick={handleBack}
          >
            ← กลับไปเลือกหมวดสถิติ
          </button>

          <div
            className={`usage-report-center-bar ${
              activeSection === 'yearly'
                ? 'usage-report-center-bar--yearly'
                : ''
            }`}
          >
            <div className="usage-report-center-label">
              <strong>
                {activeSection === 'daily' ? 'บันทึกสถิติรายวัน' : 'ศูนย์ที่จัดทำรายงาน'}
              </strong>
              <span>
                {activeSection === 'daily'
                  ? 'บันทึกข้อมูลแยกตามวันที่และศูนย์ที่เลือก'
                  : canManageAllCenters
                    ? 'เลือกศูนย์ที่ต้องการดูสถิติ'
                    : 'ศูนย์ประจำบัญชีผู้ใช้งาน'}
              </span>
            </div>

            {activeSection === 'daily' && (
              <div className="usage-report-inline-date">
                <label htmlFor="usage-date">วันที่บันทึกสถิติ</label>
                <input
                  id="usage-date"
                  type="date"
                  min="2023-01-01"
                  value={usageDate}
                  disabled={isSavingUsage}
                  onChange={(event) => handleDateChange(event.target.value)}
                />
              </div>
            )}

            {activeSection === 'yearly' && (
            <>
              <div className="usage-report-yearly-heading">
                <h2>สถิติการใช้งานรายปี</h2>
                <p>สรุปเหตุการณ์รายเดือน ตั้งแต่ พ.ศ. 2566 จนถึงปัจจุบัน</p>
              </div>

              <div
                ref={setYearlyToolbarTarget}
                className="usage-yearly-toolbar-target"
              />
            </>
          )}

            {canManageAllCenters ? (
              <select
                className="usage-report-center-select"
                value={selectedCenterId}
                disabled={isSavingUsage || isImportingYearly}
                onChange={(event) => handleCenterChange(event.target.value)}
              >
                <option value="">-- เลือกศูนย์ --</option>
                {centers.map((center) => (
                  <option key={center.id} value={String(center.id)}>
                    {center.name}{center.code ? ` (${center.code})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="usage-report-center-locked">
                {centers.find((center) => String(center.id) === String(selectedCenterId))?.name ||
                  profile?.agency ||
                  (profile?.center_id ? `ศูนย์ ID: ${profile.center_id}` : 'บัญชียังไม่ผูกศูนย์')}
              </div>
            )}
          </div>

          {centersError && (
            <div className="usage-daily-error" role="alert">
              โหลดรายชื่อศูนย์ไม่สำเร็จ: {centersError}
            </div>
          )}

          {activeSection === 'daily' ? (
            <div className="usage-daily-form">
              {selectedCenterId && !isDataReady && !usageLoadError && (
                <div className="usage-daily-loading" role="status">
                  กำลังโหลดข้อมูลสถิติรายวัน...
                </div>
              )}

              {usageLoadError && (
                <div className="usage-daily-error" role="alert">
                  โหลดข้อมูลไม่สำเร็จ: {usageLoadError}{' '}
                  <button
                    type="button"
                    onClick={handleReloadUsage}
                    disabled={isSavingUsage}
                    style={{ marginLeft: 8, cursor: 'pointer' }}
                  >
                    ลองอีกครั้ง
                  </button>
                </div>
              )}

              {usageSaveError && (
                <div className="usage-daily-error" role="alert">
                  บันทึกไม่สำเร็จ: {usageSaveError}{' '}
                  <button
                    type="button"
                    onClick={handleReloadUsage}
                    disabled={isSavingUsage}
                    style={{ marginLeft: 8, cursor: 'pointer' }}
                  >
                    โหลดข้อมูลล่าสุด
                  </button>
                </div>
              )}

              <div className="usage-monthly-panels">
                <section className="usage-monthly-overview">
                  <div className="usage-monthly-overview-header">
                    <strong>ภาพรวมเดือนนี้</strong>
                    <button
                        type="button"
                        className="usage-monthly-line-button"
                        onClick={handleShareUsageLine}
                        disabled={
                            !isDataReady ||
                            isSavingUsage ||
                            isSharingUsageLine ||
                            hasUnsavedUsage
                        }
                        title={
                            hasUnsavedUsage
                            ? 'กรุณาบันทึกข้อมูลก่อนแชร์ LINE'
                            : 'แชร์สรุปสถิติผ่าน LINE Flex'
                        }
                        >
                        {isSharingUsageLine
                            ? 'กำลังแชร์...'
                            : 'แชร์ LINE'}
                        </button>
                  </div>

                  {incidentTypes.map((item) => {
                    const total = reportDates.reduce(
                      (sum, date) => sum + Number(dailyCountsByDate[date]?.[item.key] ?? 0),
                      0
                    )
                    return (
                      <div
                        className={`usage-monthly-overview-row usage-tone-${item.key}`}
                        key={item.key}
                      >
                        <span>{item.label}</span>
                        <strong>{total}</strong>
                      </div>
                    )
                  })}
                </section>

                <section className="usage-monthly-days-panel">
                  <div className="usage-monthly-days-title">รายวันของเดือน</div>
                  <div className="usage-monthly-days-scroll" ref={daysScrollRef}>
                    <div
                      className="usage-monthly-days-inner"
                      style={{ '--usage-days': reportDates.length }}
                    >
                      <div className="usage-monthly-days-header">
                        {reportDates.map((date) => (
                          <span
                            key={date}
                            data-usage-selected={date === usageDate ? 'true' : undefined}
                            title={date === usageDate ? 'วันที่เลือกสำหรับบันทึกสถิติ' : 'ดูข้อมูลย้อนหลัง (แก้ไขไม่ได้)'}
                            style={
                                date === usageDate
                                    ? {
                                        // วันที่เลือก: สีฟ้า
                                        backgroundColor: 'rgba(56, 189, 248, 0.18)',
                                        color: '#eaf7ff',
                                        borderRadius: '6px',
                                        fontWeight: 800,
                                    }
                                    : date === yesterdayDate
                                    ? {
                                        // เมื่อวาน: สีเหลือง
                                        backgroundColor: 'rgba(245, 158, 11, 0.22)',
                                        color: '#fde68a',
                                        borderRadius: '6px',
                                        fontWeight: 800,
                                        }
                                    : date < yesterdayDate
                                        ? {
                                            // วันที่ผ่านมา: สีเขียว
                                            backgroundColor: 'rgba(34, 197, 94, 0.18)',
                                            color: '#86efac',
                                            borderRadius: '6px',
                                            fontWeight: 700,
                                        }
                                        : undefined
                                }
                          >
                            {Number(date.slice(-2))}
                          </span>
                        ))}
                      </div>

                      {incidentTypes.map((item) => (
                        <div className="usage-monthly-day-row" key={item.key}>
                          {reportDates.map((date) => (
                            <div className="usage-monthly-day-cell" key={date}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                placeholder="0"
                                disabled={!isDataReady || isSavingUsage || date !== usageDate}
                                aria-label={`${item.label} วันที่ ${Number(date.slice(-2))}`}
                                title={date === usageDate ? 'แก้ไขได้: วันที่เลือก' : 'ล็อกไว้: เลือกวันที่นี้จากช่องวันที่บันทึกสถิติก่อน'}
                                style={
                                    date === usageDate
                                        ? {
                                            // วันที่เลือก: สีฟ้า แก้ไขได้
                                            borderColor: '#38bdf8',
                                            backgroundColor: '#17354c',
                                            color: '#ffffff',
                                            opacity: 1,
                                        }
                                        : date === yesterdayDate
                                        ? {
                                            // เมื่อวาน: สีเหลือง
                                            borderColor: '#d97706',
                                            backgroundColor: '#45351e',
                                            color: '#fde68a',
                                            opacity: 1,
                                            cursor: 'not-allowed',
                                            }
                                        : date < yesterdayDate
                                            ? {
                                                // วันที่ผ่านมา: สีเขียว
                                                borderColor: '#15803d',
                                                backgroundColor: '#173c30',
                                                color: '#86efac',
                                                opacity: 1,
                                                cursor: 'not-allowed',
                                            }
                                            : {
                                                // วันที่ยังมาไม่ถึง
                                                opacity: 0.62,
                                                cursor: 'not-allowed',
                                            }
                                    }
                                value={dailyCountsByDate[date]?.[item.key] ?? 0}
                                onFocus={(event) => {
                                  event.target.select()
                                }}
                                onChange={(event) =>
                                  handleDailyCountChange(date, item.key, event.target.value)
                                }
                              />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>

              <div className="usage-daily-save-actions">

                <div className="usage-day-color-legend">

                    <div className="usage-day-color-legend-item">
                    <span className="usage-day-color-swatch usage-day-color-swatch--green" />
                    <span>วันที่ผ่านมาแล้ว</span>
                    </div>

                    <div className="usage-day-color-legend-item">
                    <span className="usage-day-color-swatch usage-day-color-swatch--yellow" />
                    <span>เมื่อวาน</span>
                    </div>

                    <div className="usage-day-color-legend-item">
                    <span className="usage-day-color-swatch usage-day-color-swatch--blue" />
                    <span>วันที่เลือก / แก้ไขได้</span>
                    </div>

                    <div className="usage-day-color-legend-item">
                    <span className="usage-day-color-swatch usage-day-color-swatch--gray" />
                    <span>วันที่ยังไม่ถึง</span>
                    </div>

                </div>

                <button
                    type="button"
                    className="usage-daily-save-button"
                    onClick={handleSaveUsage}
                    disabled={
                    !selectedCenterId ||
                    isLoadingUsage ||
                    isSavingUsage ||
                    Boolean(usageLoadError) ||
                    !hasUnsavedUsage
                    }
                >
                    {isSavingUsage
                    ? 'กำลังบันทึก...'
                    : 'บันทึกข้อมูล'}
                </button>

                </div>

            </div>
          ) : (
            <UsageYearlyTable
              selectedCenterId={selectedCenterId}
              onDirtyChange={setHasUnsavedYearly}
              onImportingChange={setIsImportingYearly}
              toolbarTarget={yearlyToolbarTarget}
              hideIntro
            />
          )}
        </div>
      )}
    </div>
  )
}

export default UsageStatisticsReport
