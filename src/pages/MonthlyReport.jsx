import {
  useEffect,
  useRef,
  useState,
} from 'react'
import { jsPDF } from 'jspdf'
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
import Section11Editor from './monthly/Section11Editor'
import Section12Editor from './monthly/Section12Editor'
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
    title: 'สรุปการแจ้งเตือนการตรวจจับใบหน้าตามหมายจับ',
    detail: 'สรุป Face Detection และการแจ้งเตือนตามหมายจับ',
  },
]
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
  // ========================================
  // EFFECTS
  // ========================================
  useEffect(() => {
    loadCenters()
  }, [profile?.id, profile?.center_id])
  useEffect(() => {
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
    loadMonthlyReport()
  }, [selectedCenterId, month, year])
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
    if (isCenter && profile?.center_id) {
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
      setEditorOpen(false)
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
    savedSectionIdSet.add(8)
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
          exporter: section01ExportRef.current,
        },
        {
          sectionNo: 2,
          exporter: section02ExportRef.current,
        },
        {
          sectionNo: 3,
          exporter: section03ExportRef.current,
        },
        {
          sectionNo: 4,
          exporter: section04ExportRef.current,
        },
        {
          sectionNo: 5,
          exporter: section05ExportRef.current,
        },
        {
          sectionNo: 6,
          exporter: section06ExportRef.current,
        },
        {
          sectionNo: 7,
          exporter: section07ExportRef.current,
        },
        {
          sectionNo: 8,
          exporter: section08ExportRef.current,
        },
        {
          sectionNo: 9,
          exporter: section09ExportRef.current,
        },
        {
          sectionNo: 10,
          exporter: section10ExportRef.current,
        },
        {
          sectionNo: 11,
          exporter: section11ExportRef.current,
        },
        {
          sectionNo: 12,
          exporter: section12ExportRef.current,
        },
      ]
      sectionExporters.sort(
        (a, b) => a.sectionNo - b.sectionNo
      )
      for (const item of sectionExporters) {
        if (
          !requestedSections.has(item.sectionNo)
        ) continue
        const exporter = item.exporter
        if (!exporter) continue
        if (!exporter.isReady()) {
          throw new Error(
            `หัวข้อ ${String(item.sectionNo).padStart(2, '0')} กำลังโหลดข้อมูล`
          )
        }
        if (!exporter.hasData()) continue
        const pages =
          await exporter.exportPdfPages()
        allPages.push(...pages)
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
        `สร้าง PDF เรียบร้อยแล้ว ${allPages.length} หน้า`
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
            แยกตามศูนย์
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
              ? 'สามารถแก้ไขรายงานนี้'
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
                หัวข้อ 10 ยังไม่มีตัวสร้าง PDF
                ในระบบปัจจุบัน
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
              ].filter(Boolean).join(' ')}
              onClick={() => {
                setSelectedSection(section.id)
                setEditMode(false)
                if (currentReport) {
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
                  <span className="monthly-section-arrow">
                    ›
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        {/* ====================================
            HIDDEN PDF EXPORT EDITORS
           ==================================== */}
        
          {currentReport && (pdfDialogOpen || exportingPdf) && (
            <div
              className="monthly-pdf-export-host"
              aria-hidden="true"
            >

            <Section01Editor
              ref={section01ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section02Editor
              ref={section02ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section03Editor
              key={
                `section03-export-${currentReport.id}-${section03ExportVersion}`
              }
              ref={section03ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section04Editor
              key={
                `section04-export-${currentReport.id}-${section04ExportVersion}`
              }
              ref={section04ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section05Editor
              key={
                `section05-export-${currentReport.id}-${section05ExportVersion}`
              }
              ref={section05ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section06Editor
              key={
                `section06-export-${currentReport.id}-${section06ExportVersion}`
              }
              ref={section06ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section07Editor
              key={
                `section07-export-${currentReport.id}-${section07ExportVersion}`
              }
              ref={section07ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section08Editor
              key={
                `section08-export-${currentReport.id}-${section08ExportVersion}`
              }
              ref={section08ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section09Editor
              key={
                `section09-export-${currentReport.id}-${section09ExportVersion}`
              }
              ref={section09ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section10Editor
              key={`section10-export-${currentReport.id}-${section10ExportVersion}`}
              ref={section10ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section11Editor
              key={
                `section11-export-${currentReport.id}-${section11ExportVersion}`
              }
              ref={section11ExportRef}
              report={currentReport}
              center={selectedCenter}
              month={month}
              year={year}
              canEdit={false}
            />
            <Section12Editor
              key={
                `section12-export-${currentReport.id}-${section12ExportVersion}`
              }
              ref={section12ExportRef}
              report={currentReport}
              center={selectedCenter}
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
                  !currentReport ||
                  reportLoading
                }
                onClick={() => {
                  if (!currentReport) return
                  setEditorOpen(true)
                  setEditMode(false)
                }}
              >
                ดูตัวอย่าง
              </button>
              {canEdit && (
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
          {editorOpen && currentReport ? (
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
                  </strong>
                </div>
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
                {activeSection.id === 1 ? (
                  <Section01Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={
                      handleSectionDataChange
                    }
                  />
                ) : activeSection.id === 2 ? (
                  <Section02Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={
                      handleSectionDataChange
                    }
                  />
                ) : activeSection.id === 3 ? (
                  <Section03Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection03ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 4 ? (
                  <Section04Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection04ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 5 ? (
                  <Section05Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection05ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 6 ? (
                  <Section06Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection06ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 7 ? (
                  <Section07Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection07ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 8 ? (
                  <Section08Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection08ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 9 ? (
                  <Section09Editor
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
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
                    key={`section10-${currentReport.id}`}
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection10ExportVersion(v => v + 1)
                    }}
                  />
                ) : activeSection.id === 12 ? (
                  <Section12Editor
                    key={`section12-${currentReport.id}`}
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
                    onDataChange={() => {
                      handleSectionDataChange()
                      setSection12ExportVersion(
                        previous => previous + 1
                      )
                    }}
                  />
                ) : activeSection.id === 11 ? (
                  <Section11Editor
                    key={`section11-${currentReport.id}`}
                    report={currentReport}
                    center={selectedCenter}
                    month={month}
                    year={year}
                    canEdit={canEdit && editMode}
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