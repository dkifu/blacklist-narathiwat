import {
  useEffect,
  useRef,
  useState,
} from 'react'
import { jsPDF } from 'jspdf'
import { flushSync } from 'react-dom'
import { supabase } from '../lib/supabase'
import './MonthlyReport.css'
import Section01Editor from './monthly/Section01Editor'
import Section02Editor from './monthly/Section02Editor'
import Section03Editor from './monthly/Section03Editor'
import Section04Editor from './monthly/Section04Editor'
import Section05Editor from './monthly/Section05Editor'
import Section06Editor from './monthly/Section06Editor'
import Section07Editor from './monthly/Section07Editor'
import Section08Editor from './monthly/Section08Editor'
import Section09Editor from './monthly/Section09Editor'
import Section10Editor from './monthly/Section10Editor'
// SECTION10_GLOBAL_GROUPS_V2: editor receives admin-only menu permission.
import Section11Editor from './monthly/Section11Editor'
import Section12Editor from './monthly/Section12Editor'
import { loadSctMergedData } from './monthly/SctMergedData'
const MONTHS = [
  { value: 1, label: 'มกราคม' },
  { value: 2, label: 'กุมภาพันธ์' },
  { value: 3, label: 'มีนาคม' },
  { value: 4, label: 'เมษายน' },
  { value: 5, label: 'พฤษภาคม' },
  { value: 6, label: 'มิถุนายน' },
  { value: 7, label: 'กรกฎาคม' },
  { value: 8, label: 'สิงหาคม' },
  { value: 9, label: 'กันยายน' },
  { value: 10, label: 'ตุลาคม' },
  { value: 11, label: 'พฤศจิกายน' },
  { value: 12, label: 'ธันวาคม' },
]
const REPORT_SECTIONS = [
  {
    id: 1,
    title: 'หน้าปก',
    detail: 'หน้าปกรายงานประจำเดือนของศูนย์',
  },
  {
    id: 2,
    title: 'รายงานประจำเดือน',
    detail: 'ตาราง Heatmap และแผนที่ Heatmap',
  },
  {
    id: 3,
    title: 'สรุปเหตุการณ์สะสมประจำเดือน',
    detail: 'สรุปจำนวนเหตุการณ์และกราฟสะสม',
  },
  {
    id: 4,
    title: 'ตารางสรุปรายงานการซ่อม ประจำปี',
    detail: 'สถิติการแจ้งซ่อมและ SLA',
  },
  {
    id: 5,
    title: 'สถิติการเสียประจำเดือน',
    detail: 'สรุปอุปกรณ์และประเภทการเสีย',
  },
  {
    id: 6,
    title: 'ตารางสรุปรายงานมุมภาพประจำเดือน',
    detail: 'มุมภาพปกติและรายการที่ต้องปรับปรุง',
  },
  {
    id: 7,
    title: 'เหตุการณ์สำคัญประจำเดือน',
    detail: 'รองรับเหตุการณ์สำคัญหลายเหตุการณ์และหลายหน้า',
  },
  {
    id: 8,
    title: 'ภาคผนวก',
    detail: 'หน้าคั่นและเอกสารประกอบรายงาน',
  },
  {
    id: 9,
    title: 'ใบคำร้องขอดูภาพและภาพประกอบ',
    detail: 'รองรับใบคำร้องและภาพ CCTV หลายเหตุการณ์',
  },
  {
    id: 10,
    title: 'สรุปการแจ้งเตือนรถบัญชีดำ',
    detail: 'สรุปการแจ้งเตือนรถ Blacklist ประจำเดือน',
  },
  {
    id: 11,
    title: 'รายงานผลการปฏิบัติเหตุสำคัญประจำเดือน',
    detail: 'รายละเอียดและผลการปฏิบัติงาน',
  },
  {
    id: 12,
    title: 'สรุปการแจ้งเตือนการตรวจจับใบหน้า',
    detail: 'สรุป Face Detection และการแจ้งเตือน',
  },
]
// Reporting centers included in the ศชต. consolidated monthly report.
const SCT_CENTER_ID = 10
const SCT_SOURCE_CENTER_IDS = new Set([1, 2, 4, 7, 8, 9])
// SCT_STATUS_ALL_CENTERS_V2 — six fixed sources for the public completeness board.
// Fallback names allow center accounts (whose center selector is restricted)
// to see every center's status WITHOUT expanding their report access.
const SCT_STATUS_CENTERS = [
  { id: 1, name: 'ศูนย์นราธิวาส' },
  { id: 2, name: 'ศูนย์ปัตตานี' },
  { id: 4, name: 'ศูนย์หาดใหญ่' },
  { id: 7, name: 'ศูนย์ตากใบ' },
  { id: 8, name: 'ศูนย์สุไหง-โกลก' },
  { id: 9, name: 'ศูนย์เบตง' },
]
const SCT_REQUIRED_SECTIONS = REPORT_SECTIONS.filter(section => section.id !== 1)
const isSctCenter = center =>
  Number(center?.id) === SCT_CENTER_ID ||
  /ศชต\.|ศูนย์ปฏิบัติการสำนักงานตำรวจแห่งชาติส่วนหน้า/u.test(center?.name || '')
const sctHasSection = (item, id) =>
  !!item?.report && (id === 8 || item.savedIds.includes(id))
const sctSectionLabel = (id) => String(id).padStart(2, '0')

// ==========================================
// CHECK SAVED SECTION STATUS
// ==========================================
function hasSavedMonthlySectionContent(section) {
  const content = section?.content
  if (!content || typeof content !== 'object') {
    return false
  }
  const id = Number(section.section_no)
  if (id === 7) {
    return Array.isArray(content.slides) &&
      content.slides.length > 0
  }
  return Object.entries(content).some(([key, value]) => {
    if (
      key === 'version' ||
      key === 'rowsPerPage'
    ) return false
    if (Array.isArray(value)) {
      return value.length > 0
    }
    if (typeof value === 'string') {
      return value.trim().length > 0
    }
    if (typeof value === 'number') {
      return Number.isFinite(value)
    }
    if (typeof value === 'boolean') {
      return value
    }
    return !!value &&
      typeof value === 'object' &&
      Object.keys(value).length > 0
  })
}
// ==========================================
// SAVED SECTION IDS
// ==========================================
async function getSavedMonthlySectionIds(report, rows) {
  
  const ids = new Set(
    (rows || [])
      .filter(row => row.has_saved_content === true)
      .map(row => Number(row.section_no))
  )


  // หัวข้อ 03 ตรวจข้อมูลที่ดึงมาอัตโนมัติ
  if (report?.center_id != null && !ids.has(3)) {
    try {
      const reportYear = Number(report.report_year)
      const calendarYear =
        reportYear >= 2400 ? reportYear - 543 : reportYear

      const now = new Date()
      const completedMonths =
        calendarYear < now.getFullYear()
          ? 12
          : calendarYear === now.getFullYear()
            ? now.getMonth()
            : 0

      if (Number.isInteger(calendarYear) && completedMonths > 0) {
        const startDate = `${calendarYear}-01-01`
        const endDate = completedMonths === 12
          ? `${calendarYear + 1}-01-01`
          : `${calendarYear}-${String(completedMonths + 1).padStart(2, '0')}-01`

        const types = ['unrest', 'accident', 'crime', 'lpr_ai']

        const [daily, monthly] = await Promise.all([
          supabase
            .from('usage_daily_stats')
            .select('incident_type')
            .eq('center_id', report.center_id)
            .gte('usage_date', startDate)
            .lt('usage_date', endDate)
            .in('incident_type', types)
            .limit(1),

          supabase
            .from('usage_monthly_stats')
            .select('incident_type')
            .eq('center_id', report.center_id)
            .gte('month_start', startDate)
            .lt('month_start', endDate)
            .in('incident_type', types)
            .not('event_count', 'is', null)
            .limit(1),
        ])

        if (daily.error) throw daily.error
        if (monthly.error) throw monthly.error

        if (daily.data?.length || monthly.data?.length) {
          ids.add(3)
        }
      }
    } catch (error) {
      console.warn('Section 03 status lookup failed:', error)
    }
  }


  // หัวข้อ 04 ใช้ข้อมูลรายปี
  if (report?.center_id != null) {
    try {
      const { data, error } = await supabase
        .from('monthly_report_annual_sections')
        .select('content')
        .eq('center_id', report.center_id)
        .eq('report_year', report.report_year)
        .eq('section_no', 4)
        .maybeSingle()
      if (error) throw error
      const reportMonth = Number(report.report_month)
      const reportYear = Number(report.report_year)
      const calendarYear =
        reportYear >= 2400
          ? reportYear - 543
          : reportYear
      const content = data?.content
      const monthRow = content?.rows?.[reportMonth - 1]
      const hasSavedData =
        Number(content?.year) === calendarYear &&
        Array.isArray(content?.rows) &&
        content.rows.length === 12 &&
        Number.isInteger(reportMonth) &&
        reportMonth >= 1 &&
        reportMonth <= 12 &&
        [
          'reports',
          'sites',
          'withinSla',
          'overSla',
        ].some(key =>
          Number.isSafeInteger(monthRow?.[key]) &&
          monthRow[key] >= 0
        )
      if (hasSavedData) {
        ids.add(4)
      }
    } catch (error) {
      console.warn(
        'Section 04 status lookup failed:',
        error
      )
    }
  }
  // หัวข้อ 09 ใช้ข้อมูลเคสแยก
  if (report?.center_id != null) {
    try {
      const { data, error } = await supabase
        .from('monthly_report_section09_months')
        .select('report_month')
        .eq('center_id', report.center_id)
        .eq('report_month', report.report_month)
        .eq('report_year', report.report_year)
        .limit(1)
      if (error) throw error
      if (data?.length) {
        ids.add(9)
      }
    } catch (error) {
      console.warn(
        'Section 09 status lookup failed:',
        error
      )
    }
  }
  return [...ids]
}
// ==========================================
// PDF SECTIONS
// ==========================================
const COMPANY_PDF_SECTIONS =
  REPORT_SECTIONS.map(section => section.id)
const POLICE_PDF_SECTIONS =
  COMPANY_PDF_SECTIONS.filter(id => id !== 6)
const IMPLEMENTED_PDF_SECTIONS =
  new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
// ==========================================
// MONTHLY REPORT
// ==========================================
function MonthlyReport({ profile }) {
  const now = new Date()
  const previousMonthDate = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  )
  const [collapseSectionList, setCollapseSectionList] =
    useState(false)
  const [currentReport, setCurrentReport] =
    useState(null)
  const section01ExportRef = useRef(null)
  const section02ExportRef = useRef(null)
  const section03ExportRef = useRef(null)
  const section04ExportRef = useRef(null)
  const section05ExportRef = useRef(null)
  const section06ExportRef = useRef(null)
  const section07ExportRef = useRef(null)
  const section08ExportRef = useRef(null)
  const section09ExportRef = useRef(null)
  const section10ExportRef = useRef(null)
  const section11ExportRef = useRef(null)
  const section12ExportRef = useRef(null)
  const [section03ExportVersion, setSection03ExportVersion] =
    useState(0)
  const [section04ExportVersion, setSection04ExportVersion] =
    useState(0)
  const [section05ExportVersion, setSection05ExportVersion] =
    useState(0)
  const [section06ExportVersion, setSection06ExportVersion] =
    useState(0)
  const [section07ExportVersion, setSection07ExportVersion] =
    useState(0)
  const [section08ExportVersion, setSection08ExportVersion] =
    useState(0)
  const [section09ExportVersion, setSection09ExportVersion] =
    useState(0)
  const [section10ExportVersion, setSection10ExportVersion] = useState(0)
  const [section11ExportVersion, setSection11ExportVersion] =
    useState(0)
  const [section12ExportVersion, setSection12ExportVersion] =
    useState(0)
  const [exportingPdf, setExportingPdf] =
    useState(false)
  const [editorOpen, setEditorOpen] =
    useState(false)
  const [editMode, setEditMode] =
    useState(false)
  const [reportHasContent, setReportHasContent] =
    useState(false)
  const [savedSectionsStatus, setSavedSectionsStatus] =
    useState({
      reportId: null,
      ids: [],
    })
  const [pdfDialogOpen, setPdfDialogOpen] =
    useState(false)
  const [pdfPreset, setPdfPreset] =
    useState('company')
  const [pdfSelectedSections, setPdfSelectedSections] =
    useState(COMPANY_PDF_SECTIONS)
  const [reportLoading, setReportLoading] =
    useState(false)
  const [reportMessage, setReportMessage] =
    useState('')
  const [reportMessageType, setReportMessageType] =
    useState('')
  const [centers, setCenters] =
    useState([])
  const [sctEntries, setSctEntries] = useState([])
  // SCT_TRUE_AGGREGATION_V4 — one read-only merged data source for preview and PDF.
  const [sctMergedData, setSctMergedData] = useState(null)
  const [sctMergedLoading, setSctMergedLoading] = useState(false)
  const [sctMergedError, setSctMergedError] = useState('')
  const [sctLoading, setSctLoading] = useState(false)
  const [sctError, setSctError] = useState('')
  const [sctRefresh, setSctRefresh] = useState(0)
  const [sctExpandedId, setSctExpandedId] = useState(null)
  const [sctDetailCenterId, setSctDetailCenterId] = useState(null)
  const [pdfExportCenterId, setPdfExportCenterId] = useState(null)
  const [selectedCenterId, setSelectedCenterId] =
    useState('')
  const [month, setMonth] = useState(
    previousMonthDate.getMonth() + 1
  )
  const [year, setYear] = useState(
    previousMonthDate.getFullYear() + 543
  )
  const [selectedSection, setSelectedSection] =
    useState(1)
  const [loadingCenters, setLoadingCenters] =
    useState(true)
  const role = profile?.role
  const isAdmin = role === 'admin'
  const isSupervisor = role === 'supervisor'
  const isOperator = role === 'operator'
  const isCenter = role === 'center'
  const isSctMode = Number(selectedCenterId) === SCT_CENTER_ID ||
    isSctCenter(centers.find(center => String(center.id) === String(selectedCenterId)))
  // ========================================
  // EFFECTS
  // ========================================
  useEffect(() => {
    loadCenters()
  }, [profile?.id, profile?.center_id])
  useEffect(() => {
    setSctDetailCenterId(null)
    setEditorOpen(false)
    setEditMode(false)
    setReportHasContent(false)
    setSavedSectionsStatus({
      reportId: null,
      ids: [],
    })
    setPdfDialogOpen(false)
    if (!selectedCenterId) {
      setCurrentReport(null)
      return
    }
    if (isSctMode) setEditorOpen(true)
    loadMonthlyReport()
  }, [selectedCenterId, month, year])

  // The consolidated report is computed from the six source-center reports.
  // Never insert or modify their source rows when viewing as ศชต.
  useEffect(() => {
    let active = true
    if (!selectedCenterId) {
      setSctEntries([])
      setSctError('')
      setSctLoading(false)
      return () => { active = false }
    }
    const fetchSct = async () => {
      setSctLoading(true)
      setSctError('')
      setSctEntries([])
      const reportingCenters = SCT_STATUS_CENTERS.map(source =>
        centers.find(center => Number(center.id) === source.id) || source
      )
      try {
        const { data: reports, error } = await supabase
          .from('monthly_reports')
          .select('id,center_id,report_month,report_year,status')
          .in('center_id', reportingCenters.map(c => c.id))
          .eq('report_month', Number(month))
          .eq('report_year', Number(year))
        if (error) throw error
        const reportsByCenter = new Map((reports || []).map(r => [Number(r.center_id), r]))
        const entries = await Promise.all(reportingCenters.map(async center => {
          const report = reportsByCenter.get(Number(center.id)) || null
          if (!report) return { center, report: null, savedIds: [], error: '' }
          try {
            const { data: flags, error: flagError } = await supabase.rpc(
              'monthly_report_get_section_flags', { p_report_id: report.id }
            )
            if (flagError) throw flagError
            const savedIds = await getSavedMonthlySectionIds(report, flags || [])
            return { center, report, savedIds, error: '' }
          } catch (error) {
            return { center, report, savedIds: [], error: error.message || 'ตรวจสอบหัวข้อไม่ได้' }
          }
        }))
        if (active) setSctEntries(entries)
      } catch (error) {
        if (active) {
          setSctEntries([])
          setSctError(error.message || 'ไม่สามารถตรวจสอบรายงานรวมของศชต.ได้')
        }
      } finally {
        if (active) setSctLoading(false)
      }
    }
    fetchSct()
    return () => { active = false }
  }, [selectedCenterId, centers, month, year, sctRefresh])
  // Build a single report dataset from six source centers.
  // No changes are persisted into ศชต. or source-center rows.
  useEffect(() => {
    let live = true
    setSctMergedData(null)
    setSctMergedError('')
    if (!isSctMode || sctLoading || sctEntries.length !== SCT_STATUS_CENTERS.length) {
      setSctMergedLoading(false)
      return () => { live = false }
    }
    setSctMergedLoading(true)
    loadSctMergedData(sctEntries, month, year)
      .then(data => { if (live) setSctMergedData(data) })
      .catch(err => { if (live) setSctMergedError(err.message || 'ไม่สามารถรวมข้อมูลได้') })
      .finally(() => { if (live) setSctMergedLoading(false) })
    return () => { live = false }
  }, [isSctMode, sctLoading, sctEntries, month, year])

  // ========================================
  // LOAD CENTERS
  // ========================================
  const loadCenters = async () => {
    setLoadingCenters(true)
    let query = supabase
      .from('centers')
      .select('id, name, code, active')
      .eq('active', true)
      .order('name')
    if (isCenter && profile?.center_id && Number(profile.center_id) !== SCT_CENTER_ID) {
      query = query.eq('id', profile.center_id)
    }
    const { data, error } = await query
    if (error) {
      console.error('Load centers error:', error)
      setCenters([])
      setLoadingCenters(false)
      return
    }
    const rows = data || []
    setCenters(rows)
    if (isCenter && profile?.center_id) {
      setSelectedCenterId(String(profile.center_id))
    } else if (
      isOperator &&
      profile?.center_id &&
      rows.some(
        center =>
          Number(center.id) ===
          Number(profile.center_id)
      )
    ) {
      setSelectedCenterId(String(profile.center_id))
    } else if (rows.length > 0) {
      setSelectedCenterId(String(rows[0].id))
    }
    setLoadingCenters(false)
  }
  // ========================================
  // LOAD MONTHLY REPORT
  // ========================================
  const loadMonthlyReport = async () => {
    if (!selectedCenterId) return
    setReportLoading(true)
    setReportMessage('')
    setReportMessageType('')
    const { data, error } = await supabase
      .from('monthly_reports')
      .select('*')
      .eq('center_id', Number(selectedCenterId))
      .eq('report_month', month)
      .eq('report_year', year)
      .maybeSingle()
    if (error) {
      console.error(
        'Load monthly report error:',
        error
      )
      setCurrentReport(null)
      setEditorOpen(false)
      setEditMode(false)
      setReportHasContent(false)
      setReportMessage(
        'ไม่สามารถโหลดข้อมูลรายงานได้'
      )
      setReportMessageType('error')
      setReportLoading(false)
      return
    }
    if (!data) {
      setCurrentReport(null)
      setEditorOpen(isSctMode)
      setEditMode(false)
      setReportHasContent(false)
      setReportLoading(false)
      return
    }
    
    
    const {
      data: sectionFlags,
      error: sectionError,
    } = await supabase.rpc(
      'monthly_report_get_section_flags',
      { p_report_id: data.id }
    )

    if (sectionError) {
      console.error(
        'Load report section flags error:',
        sectionError
      )

      setReportMessage(
        'ไม่สามารถโหลดสถานะหัวข้อรายงานได้'
      )
      setReportMessageType('error')
    }

    const hasContent = (sectionFlags || []).some(
      row => row.has_any_content === true
    )

    const savedIds = sectionError
      ? []
      : await getSavedMonthlySectionIds(
          data,
          sectionFlags
        )


    setSavedSectionsStatus({
      reportId: data.id,
      ids: savedIds,
    })
    setCurrentReport(data)
    setReportHasContent(hasContent)
    setEditorOpen(true)
    setEditMode(false)
    setReportLoading(false)
  }
  // ========================================
  // UPDATE SECTION STATUS
  // ========================================
  
  
  const handleSectionDataChange = async () => {
    if (!currentReport?.id) return

    const { data: sectionFlags, error } =
      await supabase.rpc(
        'monthly_report_get_section_flags',
        { p_report_id: currentReport.id }
      )

    if (error) {
      console.error(
        'Refresh report section flags error:',
        error
      )
      return
    }

    const hasContent = (sectionFlags || []).some(
      row => row.has_any_content === true
    )

    setReportHasContent(hasContent)

    const ids = await getSavedMonthlySectionIds(
      currentReport,
      sectionFlags
    )

    setSavedSectionsStatus({
      reportId: currentReport.id,
      ids,
    })
    setSctRefresh(previous => previous + 1)
  }


  // ========================================
  // CREATE REPORT
  // ========================================
  const handleCreateReport = async () => {
    if (!canEdit) {
      setReportMessage(
        'บัญชีนี้ไม่มีสิทธิ์แก้ไขรายงานของศูนย์นี้'
      )
      setReportMessageType('error')
      return
    }
    if (!selectedCenterId) {
      setReportMessage('กรุณาเลือกศูนย์')
      setReportMessageType('error')
      return
    }
    if (currentReport) {
      setReportMessage(
        'มีรายงานของศูนย์และเดือนนี้อยู่แล้ว'
      )
      setReportMessageType('warning')
      return
    }
    setReportLoading(true)
    setReportMessage('')
    setReportMessageType('')
    const { data, error } = await supabase
      .from('monthly_reports')
      .insert({
        center_id: Number(selectedCenterId),
        report_month: month,
        report_year: year,
        status: 'draft',
        created_by: profile?.id,
      })
      .select()
      .single()
    if (error) {
      console.error(
        'Create monthly report error:',
        error
      )
      if (error.code === '23505') {
        await loadMonthlyReport()
        setReportMessage(
          'รายงานนี้ถูกสร้างไว้แล้ว'
        )
        setReportMessageType('warning')
        setReportLoading(false)
        return
      }
      setReportMessage(
        error.message ||
        'ไม่สามารถสร้างรายงานได้'
      )
      setReportMessageType('error')
      setReportLoading(false)
      return
    }
    setCurrentReport(data)
    setReportHasContent(false)
    setSavedSectionsStatus({
      reportId: data.id,
      ids: [],
    })
    setEditorOpen(true)
    setEditMode(true)
    setReportMessage(
      'สร้างรายงานประจำเดือนเรียบร้อยแล้ว'
    )
    setReportMessageType('success')
    setReportLoading(false)
  }
  // ========================================
  // ROLES & STATE
  // ========================================
  const selectedCenter = centers.find(
    center =>
      String(center.id) === String(selectedCenterId)
  )
  const isOwnCenter =
    selectedCenterId &&
    profile?.center_id &&
    Number(selectedCenterId) ===
      Number(profile.center_id)
  const canEdit =
    isAdmin ||
    isSupervisor ||
    (isOperator && isOwnCenter) ||
    (isCenter && isOwnCenter)
  const canChooseCenter =
    isAdmin ||
    isSupervisor ||
    isOperator
  const activeSection =
    REPORT_SECTIONS.find(
      section => section.id === selectedSection
    ) || REPORT_SECTIONS[0]
  const savedSectionIds =
    currentReport?.id === savedSectionsStatus.reportId
      ? savedSectionsStatus.ids
      : []
  const savedSectionIdSet =
    new Set(savedSectionIds)
  if (currentReport?.id != null) {
    savedSectionIdSet.add(1)
    savedSectionIdSet.add(8)
  }
  if (isSctMode) {
    for (const item of SCT_REQUIRED_SECTIONS) {
      if (sctEntries.some(entry => sctHasSection(entry, item.id))) {
        savedSectionIdSet.add(item.id)
      }
    }
  }
  const sctDetailEntry = sctEntries.find(entry =>
    String(entry.center.id) === String(sctDetailCenterId)
  )
  const combinedView = isSctMode && selectedSection !== 1 && !sctDetailCenterId
  const virtualSctReport = currentReport || {
    id: `sct-virtual-${year}-${month}`,
    center_id: SCT_CENTER_ID,
    report_month: Number(month),
    report_year: Number(year),
    status: 'draft',
  }
  const displayReport = combinedView ? virtualSctReport
    : isSctMode && selectedSection !== 1 ? sctDetailEntry?.report || null : currentReport
  const displayCenter = combinedView ? (selectedCenter || {id: SCT_CENTER_ID, name: 'ศูนย์ศชต.', code: 'SCT'})
    : isSctMode && selectedSection !== 1 ? sctDetailEntry?.center || null : selectedCenter
  const canEditSection = canEdit && (!isSctMode || selectedSection === 1)
  const exportEntry = sctEntries.find(entry =>
    String(entry.center.id) === String(pdfExportCenterId)
  )
  const exportReport = isSctMode && pdfExportCenterId !== null
    ? exportEntry?.report || null : currentReport
  const exportCenter = isSctMode && pdfExportCenterId !== null
    ? exportEntry?.center || null : selectedCenter
  const sctCompletedCount = sctEntries.filter(entry =>
    !entry.error && entry.report &&
    SCT_REQUIRED_SECTIONS.every(item => sctHasSection(entry, item.id))
  ).length
  // SCT_STATUS_ALL_CENTERS_V2: show a compact 6/6 progress pill.
  // Never treat loading or permission errors as zero-completeness.
  const sctSectionProgress = sectionId => {
    const total = SCT_STATUS_CENTERS.length
    if (sctLoading) {
      return { label: `…/${total}`, state: 'pending', title: 'กำลังตรวจสอบ' }
    }
    if (sctError || sctEntries.some(entry => entry.error)) {
      return { label: `?/${total}`, state: 'unknown', title: 'ไม่สามารถตรวจสอบบางศูนย์ได้' }
    }
    if (sctEntries.length !== total) {
      return { label: `…/${total}`, state: 'pending', title: 'กำลังเตรียมข้อมูล' }
    }
    const count = sctEntries.filter(entry => sctHasSection(entry, sectionId)).length
    return {
      label: `${count}/${total}`,
      state: count === total ? 'complete' : 'missing',
      title: count === total ? 'ครบทุกศูนย์' : `ยังขาด ${total - count} ศูนย์`,
    }
  }
  // ========================================
  // PDF PRESETS
  // ========================================
  const openPdfSelectionDialog = () => {
    if (!currentReport || exportingPdf) return
    setPdfPreset('company')
    setPdfSelectedSections([
      ...COMPANY_PDF_SECTIONS,
    ])
    setReportMessage('')
    setReportMessageType('')
    setPdfDialogOpen(true)
  }
  const applyPdfPreset = preset => {
    setPdfPreset(preset)
    setPdfSelectedSections(
      preset === 'police'
        ? [...POLICE_PDF_SECTIONS]
        : [...COMPANY_PDF_SECTIONS]
    )
  }
  const togglePdfSection = (id, checked) => {
    setPdfPreset('custom')
    setPdfSelectedSections(previous => {
      const next = new Set(previous)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return COMPANY_PDF_SECTIONS.filter(
        item => next.has(item)
      )
    })
  }
  useEffect(() => {
    if (!pdfDialogOpen) return undefined
    const onEscape = event => {
      if (
        event.key === 'Escape' &&
        !exportingPdf
      ) {
        setPdfDialogOpen(false)
      }
    }
    document.addEventListener(
      'keydown',
      onEscape
    )
    return () =>
      document.removeEventListener(
        'keydown',
        onEscape
      )
  }, [pdfDialogOpen, exportingPdf])
  // ========================================
  // EXPORT FULL PDF
  // ========================================
  const handleExportFullPdf = async (
    sectionIds = COMPANY_PDF_SECTIONS
  ) => {
    if (!currentReport) {
      setReportMessage(
        'ยังไม่มีรายงานสำหรับสร้าง PDF'
      )
      setReportMessageType('warning')
      return
    }
    if (exportingPdf) return
    if (!sectionIds.length) {
      setReportMessage(
        'กรุณาเลือกหัวข้อที่จะส่งออกอย่างน้อย 1 หัวข้อ'
      )
      setReportMessageType('warning')
      return
    }
    const requestedSections = new Set(sectionIds)
    setExportingPdf(true)
    setReportMessage('กำลังรวบรวมหน้ารายงาน...')
    setReportMessageType('')
    try {
      const allPages = []
      const sectionExporters = [
        {
          sectionNo: 1,
          exporter: section01ExportRef,
        },
        {
          sectionNo: 2,
          exporter: section02ExportRef,
        },
        {
          sectionNo: 3,
          exporter: section03ExportRef,
        },
        {
          sectionNo: 4,
          exporter: section04ExportRef,
        },
        {
          sectionNo: 5,
          exporter: section05ExportRef,
        },
        {
          sectionNo: 6,
          exporter: section06ExportRef,
        },
        {
          sectionNo: 7,
          exporter: section07ExportRef,
        },
        {
          sectionNo: 8,
          exporter: section08ExportRef,
        },
        {
          sectionNo: 9,
          exporter: section09ExportRef,
        },
        {
          sectionNo: 10,
          exporter: section10ExportRef,
        },
        {
          sectionNo: 11,
          exporter: section11ExportRef,
        },
        {
          sectionNo: 12,
          exporter: section12ExportRef,
        },
      ]
      sectionExporters.sort(
        (a, b) => a.sectionNo - b.sectionNo
      )
      const waitForExporter = async item => {
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const instance = item.exporter.current
          if (instance?.isReady?.()) return instance
          await new Promise(resolve => setTimeout(resolve, 160))
        }
        throw new Error(`หัวข้อ ${sctSectionLabel(item.sectionNo)} โหลดข้อมูลไม่สำเร็จหรือใช้เวลานานเกินไป`)
      }
      if (isSctMode && (sctMergedLoading || sctMergedError || !sctMergedData)) {
        throw new Error(sctMergedError || 'กำลังโหลดข้อมูลรวมของ 6 ศูนย์ กรุณารอสักครู่แล้วลองอีกครั้ง')
      }
      for (const item of sectionExporters) {
        if (!requestedSections.has(item.sectionNo)) continue
        const exporter = isSctMode ? await waitForExporter(item) : item.exporter.current
        if (!exporter) continue
        if (!exporter.isReady()) {
          throw new Error(`หัวข้อ ${sctSectionLabel(item.sectionNo)} กำลังโหลดข้อมูล`)
        }
        if (!exporter.hasData()) continue
        allPages.push(...await exporter.exportPdfPages())
      }
      if (allPages.length === 0) {
        setReportMessage(
          'ยังไม่มีหน้ารายงานที่มีข้อมูลสำหรับสร้าง PDF'
        )
        setReportMessageType('warning')
        return
      }
      const firstPage = allPages[0]
      const pdf = new jsPDF({
        orientation: firstPage.orientation,
        unit: 'mm',
        format: 'a4',
        compress: true,
      })
      allPages.forEach((page, index) => {
        if (index > 0) {
          pdf.addPage(
            'a4',
            page.orientation
          )
        }
        const isPortrait =
          page.orientation === 'portrait'
        const pageWidth =
          isPortrait ? 210 : 297
        const pageHeight =
          isPortrait ? 297 : 210
        const PDF_MARGIN = 8
        const availableWidth =
          pageWidth - PDF_MARGIN * 2
        const availableHeight =
          pageHeight - PDF_MARGIN * 2
        const scale = Math.min(
          availableWidth / pageWidth,
          availableHeight / pageHeight
        )
        const imageWidth =
          pageWidth * scale
        const imageHeight =
          pageHeight * scale
        const imageX =
          (pageWidth - imageWidth) / 2
        const imageY =
          (pageHeight - imageHeight) / 2
        pdf.addImage(
          page.dataUrl,
          page.dataUrl.startsWith('data:image/jpeg')
            ? 'JPEG'
            : 'PNG',
          imageX,
          imageY,
          imageWidth,
          imageHeight,
          undefined,
          'FAST'
        )
      })
      // ======================================
      // PDF FILE NAME
      // ======================================
      const centerName =
        selectedCenter?.code ||
        selectedCenter?.name ||
        'CENTER'
      const safeCenterName =
        String(centerName).replace(
          /[\\/:*?"<>|]/g,
          '_'
        )
      const christianYear =
        Number(year) >= 2400
          ? Number(year) - 543
          : Number(year)
      const fileMonth =
        String(month).padStart(2, '0')
      const filePeriod =
        `${christianYear}-${fileMonth}`
      const thaiMonthName =
        MONTHS.find(
          item =>
            Number(item.value) === Number(month)
        )?.label || ''
      const centerSearchText =
        `${selectedCenter?.name || ''} ${selectedCenter?.code || ''}`
          .toLowerCase()
      const stationMappings = [
        {
          keywords: ['ตากใบ', 'tkb'],
          station: 'สภ.ตากใบ',
        },
        {
          keywords: [
            'สุไหงโกลก',
            'โกลก',
            'sgk',
          ],
          station: 'สภ.สุไหงโกลก',
        },
        {
          keywords: ['ปัตตานี', 'ptn'],
          station: 'สภ.เมืองปัตตานี',
        },
        {
          keywords: ['หาดใหญ่', 'hdy'],
          station: 'สภ.หาดใหญ่',
        },
        {
          keywords: ['เบตง', 'btg'],
          station: 'สภ.เบตง',
        },
        {
          keywords: ['นราธิวาส', 'nrw'],
          station: 'สภ.เมืองนราธิวาส',
        },
      ]
      const stationName =
        stationMappings.find(item =>
          item.keywords.some(keyword =>
            centerSearchText.includes(keyword)
          )
        )?.station ||
        selectedCenter?.name ||
        'ไม่ระบุหน่วยงาน'
      let pdfFileName =
        `Monthly_Report_${safeCenterName}_${month}_${year}.pdf`
      if (pdfPreset === 'company') {
        pdfFileName =
          `${filePeriod} ${stationName} รายงานVSS.pdf`
      } else if (pdfPreset === 'police') {
        pdfFileName =
          `${filePeriod} ${stationName} รายงานประจำเดือน${thaiMonthName}.pdf`
      }
      const safePdfFileName =
        pdfFileName.replace(
          /[\\/:*?"<>|]/g,
          '_'
        )
      pdf.save(safePdfFileName)
      setReportMessage(
        `สร้าง PDF เรียบร้อยแล้ว ${allPages.length} หน้า` +
        (isSctMode ? ` (รวมข้อมูลจาก ${sctMergedData.centerCount}/6 ศูนย์)` : '')
      )
      setReportMessageType('success')
      setPdfDialogOpen(false)
    } catch (error) {
      console.error(
        'Full PDF export error:',
        error
      )
      setReportMessage(
        error.message ||
        'ไม่สามารถสร้าง PDF ได้'
      )
      setReportMessageType('error')
    } finally {
      setPdfExportCenterId(null)
      setExportingPdf(false)
    }
  }
  // ========================================
  // RENDER
  // ========================================
  return (
    <div className="monthly-report-page">
      <div className="monthly-report-header">
        <div>
          <span className="monthly-report-eyebrow">
            MONTHLY REPORT
          </span>
          <h2>รายงานประจำเดือน</h2>
          <p>
            จัดทำ ตรวจสอบ และรวบรวมรายงานประจำเดือน
            {isSctMode ? 'ศชต.รวบรวมข้อมูลจาก 6 ศูนย์บนรายงานเดิม' : 'แยกตามศูนย์'}
          </p>
        </div>
        <div className="monthly-report-header-actions">
          <button
            type="button"
            className="monthly-pdf-button"
            onClick={openPdfSelectionDialog}
            disabled={
              !currentReport ||
              exportingPdf
            }
          >
            {exportingPdf
              ? 'กำลังสร้าง PDF...'
              : '↓ ดาวน์โหลด PDF ทั้งเล่ม'}
          </button>
          <div
            className={
              canEdit
                ? 'monthly-permission-badge edit'
                : 'monthly-permission-badge view'
            }
          >
            {canEdit
              ? (isSctMode ? 'แก้ไขหน้าปกศชต.ได้' : 'สามารถแก้ไขรายงานนี้')
              : 'ดูรายงานอย่างเดียว'}
          </div>
        </div>
      </div>
      {/* ====================================
          PDF SELECTION DIALOG
         ==================================== */}
      {pdfDialogOpen && (
        <div
          className="monthly-pdf-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!exportingPdf) {
              setPdfDialogOpen(false)
            }
          }}
        >
          <div
            className="monthly-pdf-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="monthly-pdf-modal-title"
            onClick={event =>
              event.stopPropagation()
            }
          >
            <div className="monthly-pdf-modal-header">
              <div>
                <span>PDF EXPORT SETTINGS</span>
                <h3 id="monthly-pdf-modal-title">
                  เลือกหัวข้อสำหรับส่งออก PDF
                </h3>
                <p>
                  {selectedCenter?.name || 'ศูนย์'}
                  {' · '}
                  {MONTHS.find(
                    item => item.value === month
                  )?.label}
                  {' '}
                  {year}
                </p>
              </div>
              <button
                className="monthly-pdf-modal-close"
                type="button"
                aria-label="ปิดหน้าต่าง"
                disabled={exportingPdf}
                onClick={() =>
                  setPdfDialogOpen(false)
                }
              >
                ×
              </button>
            </div>
            <div className="monthly-pdf-modal-content">
              <div className="monthly-pdf-presets">
                <button
                  type="button"
                  className={
                    pdfPreset === 'company'
                      ? 'active'
                      : ''
                  }
                  disabled={exportingPdf}
                  onClick={() =>
                    applyPdfPreset('company')
                  }
                >
                  <strong>สำหรับส่งบริษัท</strong>
                  <small>
                    เลือกครบทุกหัวข้อ 01–12
                  </small>
                </button>
                <button
                  type="button"
                  className={
                    pdfPreset === 'police'
                      ? 'active'
                      : ''
                  }
                  disabled={exportingPdf}
                  onClick={() =>
                    applyPdfPreset('police')
                  }
                >
                  <strong>สำหรับส่งตำรวจ</strong>
                  <small>
                    เลือกทุกหัวข้อ ยกเว้น 06
                  </small>
                </button>
              </div>
              <div className="monthly-pdf-selection-heading">
                <strong>หัวข้อรายงาน</strong>
                <div className="monthly-pdf-selection-tools">
                  <span>
                    เลือก {pdfSelectedSections.length}
                    {' '}
                    จาก {REPORT_SECTIONS.length}
                    {' '}
                    หัวข้อ
                  </span>
                  <button
                    type="button"
                    className="monthly-pdf-clear-button"
                    disabled={
                      exportingPdf ||
                      pdfSelectedSections.length === 0
                    }
                    onClick={() => {
                      setPdfPreset('custom')
                      setPdfSelectedSections([])
                    }}
                  >
                    ✕ ล้างทั้งหมด
                  </button>
                </div>
              </div>
              <div className="monthly-pdf-section-options">
                {REPORT_SECTIONS.map(section => (
                  <label
                    key={section.id}
                    className={
                      `monthly-pdf-section-option ${
                        pdfSelectedSections.includes(
                          section.id
                        )
                          ? 'checked'
                          : ''
                      }`
                    }
                  >
                    <input
                      type="checkbox"
                      checked={
                        pdfSelectedSections.includes(
                          section.id
                        )
                      }
                      disabled={exportingPdf}
                      onChange={event =>
                        togglePdfSection(
                          section.id,
                          event.target.checked
                        )
                      }
                    />
                    <span className="monthly-pdf-section-index">
                      {String(section.id).padStart(
                        2,
                        '0'
                      )}
                    </span>
                    <span className="monthly-pdf-section-name">
                      {section.title}
                    </span>
                    <span
                      className={
                        `monthly-pdf-section-status ${
                          !IMPLEMENTED_PDF_SECTIONS.has(
                            section.id
                          )
                            ? 'unavailable'
                            : savedSectionIdSet.has(
                              section.id
                            )
                              ? 'ready'
                              : ''
                        }`
                      }
                    >
                      {!IMPLEMENTED_PDF_SECTIONS.has(
                        section.id
                      )
                        ? 'รอพัฒนา'
                        : isSctMode && section.id !== 1
                          ? `${sctSectionProgress(section.id).label} ศูนย์`
                          : savedSectionIdSet.has(section.id)
                            ? 'มีข้อมูล'
                            : 'ยังไม่มีข้อมูล'}
                    </span>
                  </label>
                ))}
              </div>
              <p className="monthly-pdf-modal-hint">
                ระบบจะส่งออกเฉพาะหัวข้อที่เลือก
                และมีข้อมูลพร้อมส่งออกเท่านั้น
                ระบบจะไม่บันทึกข้อมูลทับศูนย์ต้นทาง
              </p>
              {['error', 'warning'].includes(
                reportMessageType
              ) && reportMessage && (
                <p
                  className="monthly-pdf-modal-error"
                  role="alert"
                >
                  {reportMessage}
                </p>
              )}
            </div>
            <div className="monthly-pdf-modal-actions">
              <button
                type="button"
                className="monthly-pdf-modal-cancel"
                disabled={exportingPdf}
                onClick={() =>
                  setPdfDialogOpen(false)
                }
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="monthly-pdf-modal-confirm"
                disabled={
                  exportingPdf ||
                  pdfSelectedSections.length === 0
                }
                onClick={() =>
                  handleExportFullPdf(
                    pdfSelectedSections
                  )
                }
              >
                {exportingPdf
                  ? 'กำลังสร้าง PDF...'
                  : 'ยืนยันและดาวน์โหลด PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ====================================
          REPORT FILTER
         ==================================== */}
      <div className="monthly-report-filter">
        <div className="monthly-filter-item">
          <label>ศูนย์</label>
          {canChooseCenter ? (
            <select
              value={selectedCenterId}
              onChange={e =>
                setSelectedCenterId(
                  e.target.value
                )
              }
              disabled={loadingCenters}
            >
              {centers.map(center => (
                <option
                  key={center.id}
                  value={center.id}
                >
                  {center.name}
                  {center.code
                    ? ` (${center.code})`
                    : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="monthly-fixed-value">
              {selectedCenter?.name ||
                profile?.agency ||
                'ศูนย์ของคุณ'}
            </div>
          )}
        </div>
        <div className="monthly-filter-item">
          <label>เดือน</label>
          <select
            value={month}
            onChange={e =>
              setMonth(Number(e.target.value))
            }
          >
            {MONTHS.map(item => (
              <option
                key={item.value}
                value={item.value}
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="monthly-filter-item">
          <label>ปี พ.ศ.</label>
          <select
            value={year}
            onChange={e =>
              setYear(Number(e.target.value))
            }
          >
            {[0, 1, 2, 3, 4].map(offset => {
              const reportYear =
                now.getFullYear() +
                543 -
                offset
              return (
                <option
                  key={reportYear}
                  value={reportYear}
                >
                  {reportYear}
                </option>
              )
            })}
          </select>
        </div>
      </div>
      {!canEdit && isOperator && (
        <div className="monthly-readonly-notice">
          ศูนย์นี้ไม่ได้ผูกกับบัญชีของคุณ
          จึงสามารถเปิดดูรายงานได้อย่างเดียว
        </div>
      )}
      {selectedCenterId && (
        <section className="sct-status-board">
          <div className="sct-status-head">
            <div>
              <span>ตรวจสอบความครบถ้วน · รายงานทั้ง 6 ศูนย์</span>
              <h3>
                {sctLoading
                  ? 'กำลังตรวจสอบข้อมูล...'
                  : sctError || sctEntries.some(entry => entry.error)
                    ? 'มีบางศูนย์ที่ตรวจสอบสถานะไม่ได้'
                    : sctEntries.length !== SCT_STATUS_CENTERS.length
                      ? 'กำลังเตรียมข้อมูลรายศูนย์'
                      : <>
                        <span className={`sct-overall-progress ${sctCompletedCount === SCT_STATUS_CENTERS.length ? 'complete' : 'missing'}`}>
                          {sctCompletedCount}<em>/{SCT_STATUS_CENTERS.length}</em>
                        </span>
                        ศูนย์ครบทุกหัวข้อ
                      </>}
              </h3>
              <p>ตรวจหัวข้อ 02–12 · หัวข้อ 08 เป็นหน้าคั่นอัตโนมัติ · เปิดเนื้อหารายงานได้ตามสิทธิ์ของบัญชี</p>
            </div>
            <button type="button" className="secondary-button" disabled={sctLoading}
              onClick={() => setSctRefresh(v => v + 1)}>
              {sctLoading ? 'กำลังตรวจสอบ...' : '↻ ตรวจสอบใหม่'}
            </button>
          </div>
          {sctError && <p className="sct-status-error" role="alert">{sctError}</p>}
          <div className="sct-center-grid">
            {sctEntries.map(entry => {
              const count = SCT_REQUIRED_SECTIONS.filter(item => sctHasSection(entry, item.id)).length
              const complete = !entry.error && count === SCT_REQUIRED_SECTIONS.length
              const expanded = String(sctExpandedId) === String(entry.center.id)
              return <div className="sct-center-status" key={entry.center.id}>
                <button type="button" className="sct-center-toggle"
                  aria-expanded={expanded}
                  onClick={() => setSctExpandedId(expanded ? null : entry.center.id)}>
                  <strong>{entry.center.name}</strong>
                  <span className={entry.error ? 'unknown' : complete ? 'complete' : 'missing'}>
                    {entry.error ? 'ตรวจสอบไม่ได้' : !entry.report ? 'ยังไม่มีรายงาน'
                      : complete ? 'ครบทุกหัวข้อ' : `ขาด ${SCT_REQUIRED_SECTIONS.length - count} หัวข้อ`}
                  </span>
                  <small>{expanded ? 'ซ่อนรายละเอียด ▲' : 'ดูรายละเอียด ▼'}</small>
                </button>
                {expanded && <div className="sct-center-details">
                  {entry.error && <p role="alert">{entry.error}</p>}
                  {SCT_REQUIRED_SECTIONS.map(section => <button type="button"
                    key={section.id}
                    disabled={!entry.report || !(isSctMode || canChooseCenter || Number(selectedCenterId) === Number(entry.center.id))}
                    title={!isSctMode && !canChooseCenter && Number(selectedCenterId) !== Number(entry.center.id)
                      ? 'ดูสถานะได้ แต่ไม่สามารถเปิดข้อมูลของศูนย์อื่น' : ''}
                    className={sctHasSection(entry, section.id) ? 'ready' : 'missing'}
                    onClick={() => {
                      setSelectedSection(section.id)
                      if (isSctMode) {
                        setSctDetailCenterId(entry.center.id)
                      } else {
                        setSctDetailCenterId(null)
                        if (Number(selectedCenterId) !== Number(entry.center.id)) {
                          // Admin / supervisor / operator: follows existing center-selection permissions.
                          setSelectedCenterId(String(entry.center.id))
                        }
                      }
                      setEditorOpen(true)
                      setEditMode(false)
                    }}>
                    <span>{sctSectionLabel(section.id)} {section.title}</span>
                    <b>{sctHasSection(entry, section.id) ? 'มีข้อมูล' : 'ยังไม่ครบ'}</b>
                  </button>)}
                </div>}
              </div>
            })}
          </div>
        </section>
      )}
      {/* ====================================
          SECTION LIST
         ==================================== */}
      <div
        className={
          collapseSectionList
            ? 'monthly-report-layout collapsed-left'
            : 'monthly-report-layout'
        }
      >
        <div className="monthly-section-list">
          <div className="monthly-section-list-head">
            <div>
              <strong>หัวข้อรายงาน</strong>
              <span>12 หมวดหลัก</span>
            </div>
            <button
              type="button"
              className="collapse-toggle-button"
              onClick={() =>
                setCollapseSectionList(
                  !collapseSectionList
                )
              }
            >
              {collapseSectionList ? '›' : '‹'}
            </button>
          </div>
          {REPORT_SECTIONS.map(section => (
            <button
              type="button"
              key={section.id}
              className={[
                'monthly-section-item',
                selectedSection === section.id
                  ? 'active'
                  : '',
                savedSectionIdSet.has(section.id)
                  ? 'has-data'
                  : '',
                // SCT_MONTHLY_SIDEBAR_SCT_ONLY_V3 — sidebar badge only in ศชต. mode
                isSctMode && section.id !== 1
                  ? 'sct-progress-item'
                  : '',
              ].filter(Boolean).join(' ')}
              onClick={() => {
                setSelectedSection(section.id)
                setSctDetailCenterId(null)
                setEditMode(false)
                if (currentReport || isSctMode) {
                  setEditorOpen(true)
                }
              }}
            >
              <span className="monthly-section-number">
                {String(section.id).padStart(2, '0')}
              </span>
              {!collapseSectionList && (
                <>
                  <div>
                    <strong>
                      {section.title}
                    </strong>
                    <small>
                      {section.detail}
                    </small>
                  </div>
                  <span
                    className={isSctMode && section.id !== 1
                      ? `monthly-section-arrow sct-section-progress ${sctSectionProgress(section.id).state}`
                      : 'monthly-section-arrow'}
                    title={isSctMode && section.id !== 1
                      ? sctSectionProgress(section.id).title : ''}>
                    {isSctMode && section.id !== 1
                      ? sctSectionProgress(section.id).label
                      : '›'}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        {/* ====================================
            HIDDEN PDF EXPORT EDITORS
           ==================================== */}
        
          {currentReport && (pdfDialogOpen || exportingPdf) &&
            (!isSctMode || (sctMergedData && !sctMergedLoading)) && (
            <div
              key={`sct-export-${exportReport?.id || 'none'}-${isSctMode ? 'merged' : 'single'}`}
              className="monthly-pdf-export-host"
              aria-hidden="true"
            >

            <Section01Editor
              ref={section01ExportRef}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section02Editor
              ref={section02ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section03Editor
              key={
                `section03-export-${currentReport.id}-${section03ExportVersion}`
              }
              ref={section03ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section04Editor
              key={
                `section04-export-${currentReport.id}-${section04ExportVersion}`
              }
              ref={section04ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section05Editor
              key={
                `section05-export-${currentReport.id}-${section05ExportVersion}`
              }
              ref={section05ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section06Editor
              key={
                `section06-export-${currentReport.id}-${section06ExportVersion}`
              }
              ref={section06ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section07Editor
              key={
                `section07-export-${currentReport.id}-${section07ExportVersion}`
              }
              ref={section07ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section08Editor
              key={
                `section08-export-${currentReport.id}-${section08ExportVersion}`
              }
              ref={section08ExportRef}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section09Editor
              key={
                `section09-export-${currentReport.id}-${section09ExportVersion}`
              }
              ref={section09ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section10Editor
              key={`section10-export-${currentReport.id}-${section10ExportVersion}`}
              ref={section10ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section11Editor
              key={
                `section11-export-${currentReport.id}-${section11ExportVersion}`
              }
              ref={section11ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section12Editor
              key={
                `section12-export-${currentReport.id}-${section12ExportVersion}`
              }
              ref={section12ExportRef}
              sctAggregate={isSctMode ? sctMergedData : undefined}
              report={exportReport}
              center={exportCenter}
              month={month}
              year={year}
              canEdit={false}
            />
          </div>
        )}
        {/* ====================================
            WORKSPACE
           ==================================== */}
        <div className="monthly-report-workspace">
          <div className="monthly-workspace-head">
            <div>
              <span>
                หัวข้อที่{' '}
                {String(activeSection.id).padStart(
                  2,
                  '0'
                )}
              </span>
              <h3>{activeSection.title}</h3>
              <p>{activeSection.detail}</p>
            </div>
            <div className="monthly-workspace-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={
                  (!currentReport && !isSctMode) ||
                  reportLoading
                }
                onClick={() => {
                  if (!currentReport && !isSctMode) return
                  setEditorOpen(true)
                  setEditMode(false)
                }}
              >
                ดูตัวอย่าง
              </button>
              {canEditSection && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={async () => {
                    if (currentReport) {
                      setEditorOpen(true)
                      setEditMode(true)
                      return
                    }
                    await handleCreateReport()
                  }}
                  disabled={reportLoading}
                >
                  {reportLoading
                    ? 'กำลังโหลด...'
                    : currentReport
                      ? 'แก้ไขรายงาน'
                      : 'สร้างรายงาน'}
                </button>
              )}
            </div>
          </div>
          {reportMessage && (
            <div
              className={
                `monthly-report-message ${reportMessageType}`
              }
            >
              {reportMessage}
            </div>
          )}
          {currentReport && (
            <div className="monthly-report-status">
              <div>
                <span>สถานะรายงาน</span>
                <strong>
                  {currentReport.status === 'complete'
                    ? 'เสร็จสมบูรณ์'
                    : reportHasContent
                      ? 'กำลังจัดทำ'
                      : 'ฉบับร่าง'}
                </strong>
              </div>
              <div>
                <span>Report ID</span>
                <strong>
                  #{currentReport.id}
                </strong>
              </div>
            </div>
          )}
          {/* ====================================
              ACTIVE EDITOR
             ==================================== */}
          {editorOpen && (currentReport || isSctMode) ? (
            <div className="monthly-editor">
              <div className="monthly-editor-toolbar">
                <div>
                  <span>
                    {editMode
                      ? 'กำลังแก้ไข'
                      : 'ดูตัวอย่าง'}
                  </span>
                  <strong>
                    {activeSection.title}
                    {isSctMode && sctDetailCenterId && selectedSection !== 1
                      ? ` — ${displayCenter?.name || ''}` : ''}
                  </strong>
                </div>
                {isSctMode && sctDetailCenterId && selectedSection !== 1 && (
                  <button type="button" className="secondary-button"
                    onClick={() => { setSctDetailCenterId(null); setEditMode(false) }}>
                    ← กลับสู่ข้อมูลรวม
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setEditorOpen(false)
                  }
                >
                  กลับ
                </button>
              </div>
              <div className="monthly-editor-body">
                {combinedView ? (
                  sctMergedError ? (
                    <div className="monthly-editor-placeholder">
                      <h3>ไม่สามารถรวมข้อมูลรายงานได้</h3><p>{sctMergedError}</p>
                    </div>
                  ) : sctMergedLoading || !sctMergedData ? (
                    <div className="monthly-editor-placeholder">
                      <h3>กำลังประมวลผลรายงานรวม 6 ศูนย์...</h3>
                      <p>ตรวจสอบและอ่านข้อมูลจากศูนย์ต้นทางโดยไม่แก้ข้อมูลเดิม</p>
                    </div>
                  ) : selectedSection === 8 ? (
                    <Section08Editor report={displayReport} center={displayCenter}
                      month={month} year={year} canEdit={false} />
                  ) : (
                  selectedSection === 2 ? <Section02Editor
                    key={`sct-merged-2-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 3 ? <Section03Editor
                    key={`sct-merged-3-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 4 ? <Section04Editor
                    key={`sct-merged-4-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 5 ? <Section05Editor
                    key={`sct-merged-5-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 6 ? <Section06Editor
                    key={`sct-merged-6-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 7 ? <Section07Editor
                    key={`sct-merged-7-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 9 ? <Section09Editor
                    key={`sct-merged-9-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 10 ? <Section10Editor
                    key={`sct-merged-10-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 11 ? <Section11Editor
                    key={`sct-merged-11-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                  selectedSection === 12 ? <Section12Editor
                    key={`sct-merged-12-${month}-${year}`}
                    report={displayReport} center={displayCenter}
                    month={month} year={year} canEdit={false}
                    sctAggregate={sctMergedData}
                  /> :
                    <div className="monthly-editor-placeholder">ไม่พบหัวข้อรายงาน</div>
                  )
                ) : !displayReport ? (
                  <div className="monthly-editor-placeholder">
                    <h3>ยังไม่มีรายงานจากศูนย์นี้</h3>
                    <p>เลือก “กลับสู่ข้อมูลรวม” เพื่อตรวจสอบศูนย์อื่นได้</p>
                  </div>
                ) : activeSection.id === 1 ? (
                  <Section01Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={
                      handleSectionDataChange
                    }
                  />
                ) : activeSection.id === 2 ? (
                  <Section02Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={
                      handleSectionDataChange
                    }
                  />
                ) : activeSection.id === 3 ? (
                  <Section03Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection03ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 4 ? (
                  <Section04Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection04ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 5 ? (
                  <Section05Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection05ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 6 ? (
                  <Section06Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection06ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 7 ? (
                  <Section07Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection07ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 8 ? (
                  <Section08Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection08ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 9 ? (
                  <Section09Editor
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setReportHasContent(true)
                      setSection09ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 10 ? (
                  <Section10Editor
                    key={`section10-${displayReport.id}`}
                    isAdmin={isAdmin}
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection10ExportVersion(v => v + 1)
                    }}
                  />
                ) : activeSection.id === 12 ? (
                  <Section12Editor
                    key={`section12-${displayReport.id}`}
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection12ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 11 ? (
                  <Section11Editor
                    key={`section11-${displayReport.id}`}
                    report={displayReport}
                    center={displayCenter}
                    month={month}
                    year={year}
                    canEdit={canEditSection && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection11ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : (
                  <div className="monthly-editor-placeholder">
                    <span>
                      หัวข้อที่{' '}
                      {String(
                        activeSection.id
                      ).padStart(2, '0')}
                    </span>
                    <h3>
                      {activeSection.title}
                    </h3>
                    <p>
                      Editor ของหัวข้อนี้
                      จะถูกสร้างในขั้นต่อไป
                    </p>
                    <small>
                      Report ID #{currentReport.id}
                    </small>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="monthly-workspace-empty">
              <div className="monthly-empty-icon">
                📄
              </div>
              <h4>{activeSection.title}</h4>
              <p>
                พื้นที่นี้จะเป็น Editor
                สำหรับสร้างและจัดการหน้ารายงาน
                ในขั้นต่อไป
              </p>
              <div className="monthly-empty-tags">
                <span>หลายหน้าได้</span>
                <span>แนวตั้ง / แนวนอน</span>
                <span>บันทึกเป็นภาพ</span>
                <span>รวม PDF ทั้งเล่ม</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default MonthlyReport
