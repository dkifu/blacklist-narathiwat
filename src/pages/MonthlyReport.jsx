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

function MonthlyReport({ profile }) {
  const now = new Date()
  const previousMonthDate = new Date(
  now.getFullYear(),
  now.getMonth() - 1,
  1
)

  const [collapseSectionList, setCollapseSectionList] = useState(false)

  const [currentReport, setCurrentReport] = useState(null)

  const section01ExportRef = useRef(null)
  const section02ExportRef = useRef(null)
  const [exportingPdf, setExportingPdf] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)

  const [editMode, setEditMode] =
    useState(false)

  const [reportHasContent, setReportHasContent] =
    useState(false)

  const [reportLoading, setReportLoading] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  const [reportMessageType, setReportMessageType] =
    useState('')

  const [centers, setCenters] = useState([])
  const [selectedCenterId, setSelectedCenterId] = useState('')

  const [month, setMonth] = useState(
    previousMonthDate.getMonth() + 1
    )

  const [year, setYear] = useState(
    previousMonthDate.getFullYear() + 543
    )

  const [selectedSection, setSelectedSection] = useState(1)
  const [loadingCenters, setLoadingCenters] = useState(true)

  const role = profile?.role

  const isAdmin = role === 'admin'
  const isSupervisor = role === 'supervisor'
  const isOperator = role === 'operator'
  const isCenter = role === 'center'

  useEffect(() => {
        loadCenters()
    }, [profile?.id, profile?.center_id])

    useEffect(() => {

    setEditorOpen(false)
    setEditMode(false)
    setReportHasContent(false)

    if (!selectedCenterId) {
        setCurrentReport(null)
        return
    }

    

    loadMonthlyReport()
  }, [selectedCenterId, month, year])

  const loadCenters = async () => {
    setLoadingCenters(true)

    let query = supabase
      .from('centers')
      .select('id, name, code, active')
      .eq('active', true)
      .order('name')

    // User ศูนย์ เห็นเฉพาะศูนย์ตัวเอง
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
        (center) =>
          Number(center.id) === Number(profile.center_id)
      )
    ) {
      // Oper เปิดมาครั้งแรกให้เจอศูนย์ตัวเองก่อน
      setSelectedCenterId(String(profile.center_id))
    } else if (rows.length > 0) {
      setSelectedCenterId(String(rows[0].id))
    }

    setLoadingCenters(false)
  }

  const loadMonthlyReport = async () => {
    if (!selectedCenterId) return

    setReportLoading(true)

    setReportMessage('')
    setReportMessageType('')

    const { data, error } =
        await supabase
        .from('monthly_reports')
        .select('*')
        .eq(
            'center_id',
            Number(selectedCenterId)
        )
        .eq(
            'report_month',
            month
        )
        .eq(
            'report_year',
            year
        )
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


    // =========================
    // ยังไม่มี Report
    // =========================

    if (!data) {

        setCurrentReport(null)

        setEditorOpen(false)
        setEditMode(false)
        setReportHasContent(false)

        setReportLoading(false)

        return
    }


    // =========================
    // ตรวจว่ารายงานมีข้อมูล
    // ในหัวข้อใดแล้วหรือยัง
    // =========================

    const {
        data: sectionRows,
        error: sectionError,
    } =
        await supabase
        .from('monthly_report_sections')
        .select(
            'section_no, content'
        )
        .eq(
            'report_id',
            data.id
        )


    let hasContent = false


    if (sectionError) {

        console.error(
        'Load report sections error:',
        sectionError
        )

    } else {

        hasContent =
        (sectionRows || []).some(
            (section) => {

            const content =
                section?.content

            if (
                !content ||
                typeof content !== 'object'
            ) {
                return false
            }


            // =========================
            // ข้อมูลแบบรายการ
            // =========================

            if (
                Array.isArray(
                content.rows
                )
            ) {
                return (
                content.rows.length > 0
                )
            }


            if (
                Array.isArray(
                content.items
                )
            ) {
                return (
                content.items.length > 0
                )
            }


            if (
                Array.isArray(
                content.pages
                )
            ) {
                return (
                content.pages.length > 0
                )
            }


            // =========================
            // รองรับ Section อื่น
            // ในอนาคต
            // =========================

            return Object.entries(
                content
            ).some(
                ([key, value]) => {

                // ค่า config อย่างเดียว
                // ไม่นับเป็นข้อมูลรายงาน
                if (
                    key ===
                    'rowsPerPage'
                ) {
                    return false
                }


                if (
                    Array.isArray(
                    value
                    )
                ) {
                    return (
                    value.length > 0
                    )
                }


                if (
                    typeof value ===
                    'string'
                ) {
                    return (
                    value.trim() !== ''
                    )
                }


                if (
                    typeof value ===
                    'number'
                    ) {
                    return true
                }


                if (
                    typeof value ===
                    'boolean'
                ) {
                    return value
                }


                if (
                    value &&
                    typeof value ===
                    'object'
                ) {
                    return (
                    Object.keys(
                        value
                    ).length > 0
                    )
                }


                return false
                }
            )
            }
        )
    }


    // =========================
    // พบ Report เดิม
    // เปิด Preview ให้อัตโนมัติ
    // =========================

    setCurrentReport(data)

    setReportHasContent(
        hasContent
    )

    // พบ Report แล้ว
    // เปิดหน้า Preview ให้อัตโนมัติ
    setEditorOpen(true)

    // เปิดมาครั้งแรกเป็นโหมดดู
    setEditMode(false)

    setReportLoading(false)

    
    }

    const handleSectionDataChange = async () => {

        if (!currentReport?.id) {
            return
        }

        const {
            data,
            error,
        } =
            await supabase
            .from('monthly_report_sections')
            .select(
                'section_no, content'
            )
            .eq(
                'report_id',
                currentReport.id
            )


        if (error) {
            console.error(
            'Refresh report content state error:',
            error
            )

            return
        }


        const hasContent =
            (data || []).some(
            (section) => {

                const content =
                section?.content

                if (
                !content ||
                typeof content !== 'object'
                ) {
                return false
                }


                if (
                Array.isArray(
                    content.rows
                )
                ) {
                return (
                    content.rows.length > 0
                )
                }


                if (
                Array.isArray(
                    content.items
                )
                ) {
                return (
                    content.items.length > 0
                )
                }


                if (
                Array.isArray(
                    content.pages
                )
                ) {
                return (
                    content.pages.length > 0
                )
                }


                return Object.entries(
                content
                ).some(
                ([key, value]) => {

                    if (
                    key === 'rowsPerPage'
                    ) {
                    return false
                    }


                    if (
                    Array.isArray(value)
                    ) {
                    return value.length > 0
                    }


                    if (
                    typeof value === 'string'
                    ) {
                    return (
                        value.trim() !== ''
                    )
                    }


                    if (
                    typeof value === 'number'
                    ) {
                    return true
                    }


                    if (
                    typeof value === 'boolean'
                    ) {
                    return value
                    }


                    if (
                    value &&
                    typeof value === 'object'
                    ) {
                    return (
                        Object.keys(value)
                        .length > 0
                    )
                    }


                    return false
                }
                )
            }
            )


        setReportHasContent(
            hasContent
        )
        }

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

        // มีรายงานถูกสร้างไว้แล้ว
        if (error.code === '23505') {
            await loadMonthlyReport()

            setReportMessage(
            'รายงานนี้ถูกสร้างไว้แล้ว'
            )

            setReportMessageType('warning')

            setReportLoading(false)
            return
        }

        // Error อื่น ๆ
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

    setEditorOpen(true)

    setEditMode(true)

    setReportMessage(
    'สร้างรายงานประจำเดือนเรียบร้อยแล้ว'
    )

    setReportMessageType('success')

    setReportLoading(false)
  }

  const selectedCenter = centers.find(
    (center) =>
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
      (section) => section.id === selectedSection
    ) || REPORT_SECTIONS[0]

    // =========================
    // EXPORT FULL REPORT PDF
    // =========================

    const handleExportFullPdf =
    async () => {

        if (!currentReport) {
        setReportMessage(
            'ยังไม่มีรายงานสำหรับสร้าง PDF'
        )

        setReportMessageType('warning')
        return
        }

        if (exportingPdf) return

        setExportingPdf(true)

        setReportMessage(
        'กำลังรวบรวมหน้ารายงาน...'
        )

        setReportMessageType('')

        try {
        const allPages = []

        // =================================
        // เรียงตามหัวข้อ 01 → 12
        // ตอนนี้มี Exporter จริงเฉพาะ 02
        // =================================

        const sectionExporters = [
        {
            sectionNo: 1,
            exporter:
            section01ExportRef.current,
        },
        {
            sectionNo: 2,
            exporter:
            section02ExportRef.current,
        },
        ]

        sectionExporters.sort(
            (a, b) =>
            a.sectionNo - b.sectionNo
        )

        for (
            const item
            of sectionExporters
        ) {
            const exporter =
            item.exporter

            // ไม่มี Editor
            // หรือหัวข้อนั้นไม่มีข้อมูล
            // = ข้าม
            if (!exporter) {
            continue
            }

            if (!exporter.isReady()) {
            throw new Error(
                `หัวข้อ ${String(
                item.sectionNo
                ).padStart(
                2,
                '0'
                )} กำลังโหลดข้อมูล`
            )
            }

            if (!exporter.hasData()) {
            continue
            }

            const pages =
            await exporter
                .exportPdfPages()

            allPages.push(
            ...pages
            )
        }

        if (allPages.length === 0) {
            setReportMessage(
            'ยังไม่มีหน้ารายงานที่มีข้อมูลสำหรับสร้าง PDF'
            )

            setReportMessageType(
            'warning'
            )

            return
        }

        const firstPage =
            allPages[0]

        const pdf =
            new jsPDF({
            orientation:
                firstPage.orientation,
            unit: 'mm',
            format: 'a4',
            compress: true,
            })

        allPages.forEach(
            (page, index) => {

            if (index > 0) {
                pdf.addPage(
                'a4',
                page.orientation
                )
            }

            const isPortrait =
                page.orientation ===
                'portrait'

            const pageWidth =
                isPortrait
                ? 210
                : 297

            const pageHeight =
                isPortrait
                ? 297
                : 210

            // =================================
            // PDF SAFE MARGIN
            // ใช้มาตรฐานเดียวกันทุกหน้ารายงาน
            // =================================

            const PDF_MARGIN = 8

            const availableWidth =
            pageWidth - PDF_MARGIN * 2

            const availableHeight =
            pageHeight - PDF_MARGIN * 2

            // รักษาสัดส่วนหน้าเดิม ไม่บีบ/ยืดภาพ
            const scale = Math.min(
            availableWidth / pageWidth,
            availableHeight / pageHeight
            )

            const imageWidth =
            pageWidth * scale

            const imageHeight =
            pageHeight * scale

            // จัดให้อยู่กึ่งกลางหน้ากระดาษ
            const imageX =
            (pageWidth - imageWidth) / 2

            const imageY =
            (pageHeight - imageHeight) / 2

            pdf.addImage(
            page.dataUrl,
            'PNG',
            imageX,
            imageY,
            imageWidth,
            imageHeight,
            undefined,
            'FAST'
            )
            }
        )

        const centerName =
            selectedCenter?.code ||
            selectedCenter?.name ||
            'CENTER'

        const safeCenterName =
            String(centerName).replace(
            /[\\/:*?"<>|]/g,
            '_'
            )

        pdf.save(
            `Monthly_Report_${safeCenterName}_${month}_${year}.pdf`
        )

        setReportMessage(
            `สร้าง PDF เรียบร้อยแล้ว ${allPages.length} หน้า`
        )

        setReportMessageType(
            'success'
        )

        } catch (error) {
        console.error(
            'Full PDF export error:',
            error
        )

        setReportMessage(
            error.message ||
            'ไม่สามารถสร้าง PDF ได้'
        )

        setReportMessageType(
            'error'
        )

        } finally {
        setExportingPdf(false)
        }
    }

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
                onClick={
                handleExportFullPdf
                }
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


      <div className="monthly-report-filter">

        <div className="monthly-filter-item">
          <label>ศูนย์</label>

          {canChooseCenter ? (
            <select
              value={selectedCenterId}
              onChange={(e) =>
                setSelectedCenterId(e.target.value)
              }
              disabled={loadingCenters}
            >
              {centers.map((center) => (
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
            onChange={(e) =>
              setMonth(Number(e.target.value))
            }
          >
            {MONTHS.map((item) => (
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
            onChange={(e) =>
              setYear(Number(e.target.value))
            }
          >
            {[0, 1, 2, 3, 4].map((offset) => {
              const reportYear =
                now.getFullYear() + 543 - offset

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
                setCollapseSectionList(!collapseSectionList)
                }
            >
                {collapseSectionList ? '›' : '‹'}
            </button>
          </div>

          {REPORT_SECTIONS.map((section) => (
            <button
                type="button"
                key={section.id}
                className={
                selectedSection === section.id
                    ? 'monthly-section-item active'
                    : 'monthly-section-item'
                }
                onClick={() => {

                    setSelectedSection(
                        section.id
                    )

                    // เปลี่ยนหัวข้อ
                    // กลับสู่โหมด Preview ก่อนเสมอ
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
                    <strong>{section.title}</strong>
                    <small>{section.detail}</small>
                    </div>

                    <span className="monthly-section-arrow">›</span>
                </>
                )}
            </button>
          ))}

          

        </div>

        {currentReport && (
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

            </div>
            )}


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

                    if (!currentReport) {
                    return
                    }

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

                    // =========================
                    // มี Report อยู่แล้ว
                    // = เข้า Edit Mode
                    // =========================

                    if (currentReport) {

                        setEditorOpen(true)

                        setEditMode(true)

                        return
                    }


                    // =========================
                    // ยังไม่มี Report
                    // = สร้างก่อน
                    // =========================

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
                className={`monthly-report-message ${reportMessageType}`}
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


          {editorOpen && currentReport ? (

            <div className="monthly-editor">

                <div className="monthly-editor-toolbar">

                <div>
                    <span>
                        {editMode
                            ? 'กำลังแก้ไข'
                            : 'ดูตัวอย่าง'}
                    </span>
                    <strong>{activeSection.title}</strong>
                </div>

                <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setEditorOpen(false)}
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

                            canEdit={
                                canEdit &&
                                editMode
                            }

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

                                canEdit={
                                    canEdit &&
                                    editMode
                                }

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

                                canEdit={
                                    canEdit &&
                                    editMode
                                }

                                onDataChange={
                                    handleSectionDataChange
                                }
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
                พื้นที่นี้จะเป็น Editor สำหรับสร้าง
                และจัดการหน้ารายงานในขั้นต่อไป
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