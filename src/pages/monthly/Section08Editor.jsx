
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
import './Section08Editor.css'

const PAPER_WIDTH = 1120
const PAPER_HEIGHT = 792

const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

// =========================================
// ชื่อสถานีตำรวจตามศูนย์
// =========================================

const getStationName = (center) => {
  const name = String(center?.name || '').trim()

  if (name.includes('สุไหงโกลก')) return 'สภ.สุไหงโกลก'
  if (name.includes('ตากใบ')) return 'สภ.ตากใบ'
  if (name.includes('นราธิวาส')) return 'สภ.เมืองนราธิวาส'
  if (name.includes('ปัตตานี')) return 'สภ.เมืองปัตตานี'
  if (name.includes('หาดใหญ่')) return 'สภ.หาดใหญ่'
  if (name.includes('เบตง')) return 'สภ.เบตง'

  const cleanName = name
    .replace(/^ศูนย์(?:กล้องวงจรปิด)?\s*/, '')
    .trim()

  return cleanName
    ? `สภ.${cleanName}`
    : 'สภ.ตามศูนย์ที่เลือก'
}

// =========================================
// ข้อความเริ่มต้น
// =========================================

const getDefaultLines = (center, month, year) => {
  const yearValue = Number(year)

  const buddhistYear = Number.isFinite(yearValue)
    ? (yearValue < 2400 ? yearValue + 543 : yearValue)
    : year

  const monthName = MONTHS_TH[Number(month) - 1] || ''

  return {
    line1: 'ภาคผนวก',
    line2: `ใบคำร้องขอดูภาพและภาพประกอบ ${getStationName(center)}`,
    line3: `ประจำเดือน ${monthName} ${buddhistYear}`,
  }
}

// =========================================
// SECTION 08 EDITOR
// =========================================

export default forwardRef(function Section08Editor({
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

  const [lines, setLines] = useState(
    () => getDefaultLines(center, month, year)
  )

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [saving, setSaving] = useState(false)
  const [exportingPng, setExportingPng] = useState(false)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')

  // =========================================
  // โหลดข้อมูลที่เคยบันทึก
  // =========================================

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setLoadError('')
      setMessage('')
      setMessageType('')

      setLines(getDefaultLines(center, month, year))

      if (!report?.id) {
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('monthly_report_sections')
          .select('content')
          .eq('report_id', report.id)
          .eq('section_no', 8)
          .maybeSingle()

        if (error) throw error
        if (!active) return

        if (data?.content) {
          const defaults = getDefaultLines(
            center, month, year
          )

          setLines({
            line1: typeof data.content.line1 === 'string'
              ? data.content.line1
              : defaults.line1,

            line2: typeof data.content.line2 === 'string'
              ? data.content.line2
              : defaults.line2,

            line3: typeof data.content.line3 === 'string'
              ? data.content.line3
              : defaults.line3,
          })
        }

      } catch (err) {
        if (!active) return

        console.error('Load Section 08 error:', err)

        setLoadError(
          err.message || 'ไม่สามารถโหลดข้อมูลได้'
        )

      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }

  }, [
    report?.id,
    center?.id,
    center?.name,
    month,
    year,
  ])

  // =========================================
  // RESPONSIVE PREVIEW
  // =========================================

  useEffect(() => {
    const element = previewRef.current

    if (!element) return

    const updateScale = () => {
      const availableWidth = element.clientWidth - 40

      if (availableWidth > 100) {
        setPreviewScale(
          Math.min(1, availableWidth / PAPER_WIDTH)
        )
      }
    }

    updateScale()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateScale)

    observer.observe(element)

    return () => observer.disconnect()

  }, [canEdit])

  // =========================================
  // SAVE DATA
  // =========================================

  const saveData = async () => {
    if (
      !canEdit ||
      !report?.id ||
      loading ||
      loadError ||
      saving
    ) return

    setSaving(true)
    setMessage('')
    setMessageType('')

    try {
      const { data: existing, error: lookupError } =
        await supabase
          .from('monthly_report_sections')
          .select('section_no')
          .eq('report_id', report.id)
          .eq('section_no', 8)
          .maybeSingle()

      if (lookupError) throw lookupError

      const content = {
        version: 1,
        ...lines,
      }

      const query = existing
        ? supabase
            .from('monthly_report_sections')
            .update({ content })
            .eq('report_id', report.id)
            .eq('section_no', 8)

        : supabase
            .from('monthly_report_sections')
            .insert({
              report_id: report.id,
              section_no: 8,
              content,
            })

      const { error } = await query

      if (error) throw error

      setMessageType('success')
      setMessage('บันทึกข้อมูลหัวข้อ 08 เรียบร้อยแล้ว')

      onDataChange?.()

    } catch (err) {
      console.error('Save Section 08 error:', err)

      setMessageType('error')
      setMessage(
        err.message || 'ไม่สามารถบันทึกข้อมูลได้'
      )

    } finally {
      setSaving(false)
    }
  }

  // =========================================
  // CAPTURE PAPER
  // =========================================

  const captureSection08 = async () => {
    const node = paperRef.current

    if (!node || loading || loadError) {
      throw new Error('หน้ารายงานหัวข้อ 08 ยังไม่พร้อม')
    }

    if (document.fonts?.ready) {
      await document.fonts.ready
    }

    const originalTransform = node.style.transform
    const originalOrigin = node.style.transformOrigin

    try {
      node.style.transform = 'none'
      node.style.transformOrigin = 'top left'

      await new Promise(resolve => {
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
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

  // =========================================
  // DOWNLOAD PNG
  // =========================================

  const downloadPng = async () => {
    if (exportingPng || saving || loading) return

    setExportingPng(true)
    setMessage('')
    setMessageType('')

    try {
      const dataUrl = await captureSection08()

      const centerName =
        center?.code ||
        center?.name ||
        'CENTER'

      const safeCenterName = String(centerName)
        .replace(/[^a-zA-Z0-9ก-๙_-]/g, '_')

      const link = document.createElement('a')

      link.href = dataUrl

      link.download =
        `Monthly_Report_${safeCenterName}_${month}_${year}_Section08.png`

      document.body.appendChild(link)
      link.click()
      link.remove()

      setMessageType('success')
      setMessage('ดาวน์โหลด PNG หัวข้อ 08 เรียบร้อยแล้ว')

    } catch (err) {
      console.error('Section 08 PNG error:', err)

      setMessageType('error')
      setMessage(
        err.message || 'ไม่สามารถดาวน์โหลด PNG ได้'
      )

    } finally {
      setExportingPng(false)
    }
  }

  // =========================================
  // PDF EXPORT INTERFACE
  // =========================================

  useImperativeHandle(ref, () => ({

    isReady: () =>
      !loading &&
      !loadError &&
      !!report?.id,

    // หน้าคั่นแสดงใน PDF เสมอ
    // แม้ยังไม่เคยบันทึกข้อความ
    hasData: () => !!report?.id,

    exportPdfPages: async () => ([
      {
        orientation: 'landscape',
        dataUrl: await captureSection08(),
      },
    ]),

  }))

  // =========================================
  // EDIT FIELDS
  // =========================================

  const editFields = [
    {
      key: 'line1',
      label: 'บรรทัดที่ 1 — หัวข้อ',
      color: '#be1e48',
    },
    {
      key: 'line2',
      label: 'บรรทัดที่ 2 — ชื่อเอกสารและ สภ.',
      color: '#2563eb',
    },
    {
      key: 'line3',
      label: 'บรรทัดที่ 3 — เดือนและปี',
      color: '#16a34a',
    },
  ]

  // =========================================
  // RENDER
  // =========================================

  return (
    <div className={`section04-editor ${canEdit ? 'section04-editing' : ''}`}>

      {/* EDIT PANEL */}

      {canEdit && (
        <aside className="section04-panel">

          <div className="section04-panel-head">
            <span>หัวข้อ 08</span>
            <h3>แก้ไขหน้าคั่นภาคผนวก</h3>
            <p>แก้ไขข้อความได้ทั้ง 3 บรรทัด</p>
          </div>

          <div className="section04-panel-body">

            <div className="section04-edit-fields">

              {editFields.map(field => (
                <label
                  className="section04-edit-field"
                  key={field.key}
                >
                  <span>
                    <i style={{
                      background: field.color,
                    }} />
                    {field.label}
                  </span>

                  <input
                    type="text"
                    autoComplete="off"
                    value={lines[field.key]}
                    disabled={
                      loading ||
                      !!loadError ||
                      saving
                    }
                    onChange={e => {
                      const value = e.target.value

                      setLines(previous => ({
                        ...previous,
                        [field.key]: value,
                      }))

                      setMessage('')
                    }}
                  />
                </label>
              ))}

            </div>

            {/* SAVE BUTTON */}

            <div className="section04-save-actions">
              <button
                type="button"
                className="section04-save-button"
                onClick={saveData}
                disabled={
                  loading ||
                  !!loadError ||
                  saving ||
                  !report?.id
                }
              >
                {saving
                  ? 'กำลังบันทึก...'
                  : 'บันทึกข้อมูล'}
              </button>
            </div>

            {/* PNG EXPORT */}

            <div className="section04-export-block">
              <h4>ส่งออกรายงาน</h4>

              <button
                type="button"
                className="section04-png-button"
                onClick={downloadPng}
                disabled={
                  loading ||
                  !!loadError ||
                  saving ||
                  exportingPng
                }
              >
                {exportingPng
                  ? 'กำลังสร้าง PNG...'
                  : '↓ บันทึกหน้า 08 เป็น PNG'}
              </button>

              <small>
                ดาวน์โหลดเฉพาะหัวข้อ 08
                เป็นภาพ A4 แนวนอน
              </small>
            </div>

            {/* STATUS */}

            {message && (
              <p
                role="status"
                className={`section04-save-message ${messageType}`}
              >
                {message}
              </p>
            )}

            <p className="section04-panel-notice">
              {loading
                ? 'กำลังโหลดข้อมูล...'
                : loadError
                  ? `โหลดข้อมูลไม่สำเร็จ: ${loadError}`
                  : 'ข้อความในพรีวิวเปลี่ยนทันที • กดบันทึกเพื่อให้ PDF ทั้งเล่มใช้ข้อความล่าสุด'}
            </p>

          </div>
        </aside>
      )}

      {/* PREVIEW */}

      <div
        className="section04-preview"
        ref={previewRef}
      >
        <div
          className="section04-paper-stage"
          style={{
            width: PAPER_WIDTH * previewScale,
            height: PAPER_HEIGHT * previewScale,
          }}
        >
          <div
            className="section08-paper"
            ref={paperRef}
            style={{
              transform: `scale(${previewScale})`,
            }}
          >
            <div className="section08-title-frame">

              <h2 className="section08-line1">
                {lines.line1}
              </h2>

              <p className="section08-line2">
                {lines.line2}
              </p>

              <p className="section08-line3">
                {lines.line3}
              </p>

            </div>
          </div>
        </div>
      </div>

    </div>
  )
})
