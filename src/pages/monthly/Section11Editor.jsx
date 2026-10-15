
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import {
  getDocument,
  GlobalWorkerOptions,
} from 'pdfjs-dist'

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import html2canvas from 'html2canvas'

import {
  
  FileText,
  ShieldCheck,
} from 'lucide-react'

import { supabase } from '../../lib/supabase'

import './Section11Editor.css'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/* ==========================================
   SECTION 11 — CONFIG
========================================== */

const PAPER_W = 1120
const PAPER_H = 792

const MAX_PAGES = 30
const MAX_PDF_BYTES = 40 * 1024 * 1024
const MAX_CONTENT_CHARS = 15_000_000

const DEFAULT_NO_EVENT =
  'ไม่พบเหตุการณ์สำคัญจากระบบ LPR และ Face ID'

const MONTHS = [
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

const STATIONS = {
  'ศูนย์นราธิวาส': 'สภ.เมืองนราธิวาส',
  'ศูนย์ตากใบ': 'สภ.ตากใบ',
  'ศูนย์สุไหงโกลก': 'สภ.สุไหงโกลก',
  'ศูนย์ปัตตานี': 'สภ.เมืองปัตตานี',
  'ศูนย์หาดใหญ่': 'สภ.หาดใหญ่',
  'ศูนย์เบตง': 'สภ.เบตง',
}

const makeId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`

const thaiYear = value => {
  const number = Number(value)

  return number >= 1900 && number < 2400
    ? number + 543
    : value
}

/* ==========================================
   CANVAS HELPERS
========================================== */

function roundedPath(
  ctx,
  x,
  y,
  width,
  height,
  radius
) {
  const r = Math.min(
    radius,
    width / 2,
    height / 2
  )

  ctx.beginPath()

  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)

  ctx.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + r
  )

  ctx.lineTo(
    x + width,
    y + height - r
  )

  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - r,
    y + height
  )

  ctx.lineTo(x + r, y + height)

  ctx.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - r
  )

  ctx.lineTo(x, y + r)

  ctx.quadraticCurveTo(
    x,
    y,
    x + r,
    y
  )

  ctx.closePath()
}

/* ==========================================
   CROP WHITE SIDES
   เหมือนหัวข้อ 07
========================================== */

function detectWhiteSideCrop(image) {
  const width = Math.min(
    640,
    image.naturalWidth
  )

  const height = Math.max(
    1,
    Math.round(
      width *
      image.naturalHeight /
      image.naturalWidth
    )
  )

  const canvas =
    document.createElement('canvas')

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext(
    '2d',
    { willReadFrequently: true }
  )

  if (!ctx) {
    return {
      left: 0,
      right: 0,
    }
  }

  ctx.drawImage(
    image,
    0,
    0,
    width,
    height
  )

  const pixels = ctx.getImageData(
    0,
    0,
    width,
    height
  ).data

  const fromY = Math.floor(
    height * 0.12
  )

  const toY = Math.ceil(
    height * 0.88
  )

  const maxScan = Math.floor(
    width * 0.06
  )

  const isWhiteColumn = x => {
    let white = 0
    let count = 0

    for (
      let y = fromY;
      y < toY;
      y += 3
    ) {
      const p = (y * width + x) * 4

      if (
        pixels[p] >= 248 &&
        pixels[p + 1] >= 248 &&
        pixels[p + 2] >= 248
      ) {
        white++
      }

      count++
    }

    return (
      count > 0 &&
      white / count >= 0.985
    )
  }

  let left = 0
  let right = 0

  while (
    left < maxScan &&
    isWhiteColumn(left)
  ) {
    left++
  }

  while (
    right < maxScan &&
    isWhiteColumn(width - 1 - right)
  ) {
    right++
  }

  return {
    left: left / width,
    right: right / width,
  }
}

/* ==========================================
   PDF PAGE EXPORT
   ใช้หัวเรื่องเฉพาะหน้าแรก
========================================== */

async function renderImportedPage(
  imageUrl,
  index,
  heading,
  subtitle
) {
  const image = new Image()
  image.src = imageUrl

  await image.decode()

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  const canvas =
    document.createElement('canvas')

  canvas.width = PAPER_W * 2
  canvas.height = PAPER_H * 2

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error(
      'ไม่สามารถสร้างหน้ารายงานได้'
    )
  }

  ctx.scale(2, 2)

  ctx.fillStyle = '#ffffff'

  ctx.fillRect(
    0,
    0,
    PAPER_W,
    PAPER_H
  )

  let contentTop = 30

  if (index === 0) {
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'

    ctx.fillStyle = '#831329'

    ctx.font =
      "900 26px 'Noto Sans Thai', sans-serif"

    ctx.fillText(
      heading,
      34,
      30
    )

    ctx.fillStyle = '#667085'

    ctx.font =
      "12px 'Noto Sans Thai', sans-serif"

    ctx.fillText(
      subtitle,
      34,
      66
    )

    contentTop = 96
  }

  const crop = detectWhiteSideCrop(
    image
  )

  const sx = Math.round(
    image.naturalWidth * crop.left
  )

  const croppedRight = Math.round(
    image.naturalWidth * crop.right
  )

  const sw = Math.max(
    1,
    image.naturalWidth -
    sx -
    croppedRight
  )

  const availableWidth =
    PAPER_W - 68

  const availableHeight =
    PAPER_H -
    contentTop -
    28

  const ratio = Math.min(
    availableWidth / sw,
    availableHeight / image.naturalHeight
  )

  const drawW = sw * ratio

  const drawH =
    image.naturalHeight * ratio

  const x =
    34 +
    (availableWidth - drawW) / 2

  const y =
    contentTop +
    (availableHeight - drawH) / 2

  // Shadow

  ctx.save()

  roundedPath(
    ctx,
    x,
    y,
    drawW,
    drawH,
    18
  )

  ctx.shadowColor =
    'rgba(15,23,42,.16)'

  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 8
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  ctx.restore()

  // Clip image

  ctx.save()

  roundedPath(
    ctx,
    x,
    y,
    drawW,
    drawH,
    18
  )

  ctx.clip()

  ctx.drawImage(
    image,
    sx,
    0,
    sw,
    image.naturalHeight,
    x,
    y,
    drawW,
    drawH
  )

  ctx.restore()

  // Thin border

  ctx.save()

  roundedPath(
    ctx,
    x,
    y,
    drawW,
    drawH,
    18
  )

  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.restore()

  return canvas.toDataURL(
    'image/png'
  )
}

/* ==========================================
   EXPORT NO-EVENT PAGE
========================================== */

async function captureNoEventPaper(
  node
) {
  if (!node) {
    throw new Error(
      'ไม่พบหน้าพรีวิวสำหรับส่งออก'
    )
  }

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  const originalTransform =
    node.style.transform

  const originalOrigin =
    node.style.transformOrigin

  try {
    node.style.transform = 'none'

    node.style.transformOrigin =
      'top left'

    await new Promise(resolve =>
      requestAnimationFrame(() =>
        requestAnimationFrame(resolve)
      )
    )

    const canvas =
      await html2canvas(node, {
        width: PAPER_W,
        height: PAPER_H,
        scale: 2,

        backgroundColor: '#ffffff',

        useCORS: true,
        allowTaint: false,
        logging: false,

        scrollX: 0,
        scrollY: 0,

        windowWidth: PAPER_W,
        windowHeight: PAPER_H,
      })

    return canvas.toDataURL(
      'image/png'
    )
  } finally {
    node.style.transform =
      originalTransform

    node.style.transformOrigin =
      originalOrigin
  }
}

/* ==========================================
   SECTION 11 EDITOR
========================================== */

export default forwardRef(
  function Section11Editor({
    report,
    center,
    month,
    year,
    canEdit = false,
    onDataChange,
  }, ref) {

    const previewRef = useRef(null)
    const paperRef = useRef(null)
    const pdfInputRef = useRef(null)

    const [scale, setScale] =
      useState(1)

    // none = ไม่มีเหตุ
    // pdf  = มีไฟล์ PDF

    const [mode, setMode] =
      useState('none')

    const [slides, setSlides] =
      useState([])

    const [activePage, setActivePage] =
      useState(0)

    const [sourceName, setSourceName] =
      useState('')

    const [noEventText, setNoEventText] =
      useState(DEFAULT_NO_EVENT)

    const [imageSize, setImageSize] =
      useState({
        width: 4,
        height: 3,
      })

    const [imageCrop, setImageCrop] =
      useState({
        left: 0,
        right: 0,
      })

    const [loading, setLoading] =
      useState(true)

    const [processing, setProcessing] =
      useState(false)

    const [saving, setSaving] =
      useState(false)

    const [rowExists, setRowExists] =
      useState(false)

    const [hasStoredData, setHasStoredData] =
      useState(false)

    const [dirty, setDirty] =
      useState(false)

    const [loadError, setLoadError] =
      useState('')

    const [message, setMessage] =
      useState('')

    const [messageType, setMessageType] =
      useState('')

    /* ======================================
       REPORT VALIDATION
    ====================================== */

    const validReport =
      !!report?.id &&
      String(report.center_id) ===
        String(center?.id) &&
      Number(report.report_month) ===
        Number(month) &&
      Number(report.report_year) ===
        Number(year)

    const busy =
      loading ||
      processing ||
      saving

    const monthName =
      MONTHS[Number(month) - 1] || '-'

    const displayYear =
      thaiYear(year)

    const stationName =
      STATIONS[center?.name] ||
      center?.name ||
      'ศูนย์กล้องวงจรปิด'

    const title =
      'รายงานผลการปฏิบัติเหตุสำคัญประจำเดือน'

    const subtitle =
      `${center?.name || 'ศูนย์กล้องวงจรปิด'} · ${monthName} ${displayYear}`

    const currentSlide =
      mode === 'pdf'
        ? slides[activePage]
        : null

    /* ======================================
       IMAGE SIZE / CROP
    ====================================== */

    const visibleRatio = Math.max(
      0.1,
      1 -
      imageCrop.left -
      imageCrop.right
    )

    const availableImageH =
      activePage === 0
        ? 668
        : 734

    const fitRatio = Math.min(
      1052 /
        (imageSize.width * visibleRatio),

      availableImageH /
        imageSize.height
    )

    const shownWidth = Math.round(
      imageSize.width *
      visibleRatio *
      fitRatio
    )

    const shownHeight = Math.round(
      imageSize.height * fitRatio
    )

    /* ======================================
       LOAD SECTION 11
    ====================================== */

    useEffect(() => {
      let active = true

      const load = async () => {
        setLoading(true)
        setLoadError('')

        setMode('none')
        setSlides([])
        setActivePage(0)

        setNoEventText(
          DEFAULT_NO_EVENT
        )

        setSourceName('')
        setHasStoredData(false)
        setRowExists(false)
        setDirty(false)
        setMessage('')

        if (!report?.id) {
          setLoading(false)
          return
        }

        try {
          const { data, error } =
            await supabase
              .from('monthly_report_sections')
              .select('content')
              .eq('report_id', report.id)
              .eq('section_no', 11)
              .maybeSingle()

          if (error) {
            throw error
          }

          if (!active) return

          setRowExists(!!data)

          const content =
            data?.content

          if (content?.version === 1) {

            const savedSlides =
              Array.isArray(content.slides)
                ? content.slides
                    .filter(item =>
                      typeof item.image ===
                        'string' &&
                      /^data:image\/(png|jpeg|webp);base64,/i
                        .test(item.image)
                    )
                    .map(item => ({
                      id: item.id || makeId(),
                      image: item.image,
                    }))
                : []

            const savedMode =
              content.mode === 'pdf' &&
              savedSlides.length
                ? 'pdf'
                : 'none'

            setMode(savedMode)

            setSlides(
              savedMode === 'pdf'
                ? savedSlides
                : []
            )

            setSourceName(
              content.sourceName || ''
            )

            setNoEventText(
              content.noEventText ||
              DEFAULT_NO_EVENT
            )

            setHasStoredData(
              savedMode === 'none' ||
              savedSlides.length > 0
            )
          }

        } catch (error) {
          if (!active) return

          console.error(
            'Section 11 load:',
            error
          )

          setLoadError(
            error.message ||
            'โหลดข้อมูลหัวข้อ 11 ไม่สำเร็จ'
          )

        } finally {
          if (active) {
            setLoading(false)
          }
        }
      }

      load()

      return () => {
        active = false
      }
    }, [report?.id])

    /* ======================================
       RESPONSIVE PREVIEW
    ====================================== */

    useEffect(() => {
      const node =
        previewRef.current

      if (!node) return

      const resize = () => {
        setScale(
          Math.min(
            1,
            Math.max(
              0.1,
              (node.clientWidth - 40) /
                PAPER_W
            )
          )
        )
      }

      const observer =
        new ResizeObserver(resize)

      observer.observe(node)

      resize()

      return () =>
        observer.disconnect()

    }, [canEdit])

    /* ======================================
       IMPORT PDF
    ====================================== */

    const handleImportPdf = async event => {
      const file =
        event.target.files?.[0]

      event.target.value = ''

      if (
        !file ||
        busy ||
        !canEdit ||
        !validReport
      ) {
        return
      }

      if (
        !/\.pdf$/i.test(file.name) ||
        (
          file.type &&
          file.type !==
            'application/pdf'
        )
      ) {
        setMessageType('error')

        setMessage(
          'กรุณาอัปโหลดไฟล์ PDF เท่านั้น'
        )

        return
      }

      if (file.size > MAX_PDF_BYTES) {
        setMessageType('error')

        setMessage(
          'ไฟล์ PDF ต้องไม่เกิน 40 MB'
        )

        return
      }

      if (
        mode === 'pdf' &&
        slides.length &&
        !window.confirm(
          'นำเข้า PDF ใหม่จะแทนที่รายงานเดิมทั้งหมด ต้องการดำเนินการต่อหรือไม่?'
        )
      ) {
        return
      }

      setProcessing(true)
      setMessageType('')
      setMessage('กำลังอ่านไฟล์ PDF...')

      let pdfDocument = null
      let task = null

      try {
        task = getDocument({
          data: new Uint8Array(
            await file.arrayBuffer()
          ),
          useSystemFonts: true,
        })

        pdfDocument =
          await task.promise

        if (
          !pdfDocument.numPages ||
          pdfDocument.numPages > MAX_PAGES
        ) {
          throw new Error(
            `ต้องมี 1–${MAX_PAGES} หน้าในไฟล์ PDF`
          )
        }

        const converted = []

        for (
          let n = 1;
          n <= pdfDocument.numPages;
          n++
        ) {
          setMessage(
            `กำลังแปลง PDF หน้า ${n} / ${pdfDocument.numPages}...`
          )

          const page =
            await pdfDocument.getPage(n)

          const original =
            page.getViewport({
              scale: 1,
            })

          const renderScale = Math.min(
            2,

            1600 / original.width,

            1100 / original.height
          )

          const viewport =
            page.getViewport({
              scale: renderScale,
            })

          const canvas =
            document.createElement(
              'canvas'
            )

          canvas.width =
            Math.ceil(viewport.width)

          canvas.height =
            Math.ceil(viewport.height)

          const ctx =
            canvas.getContext(
              '2d',
              { alpha: false }
            )

          if (!ctx) {
            throw new Error(
              'ไม่สามารถแปลงหน้า PDF ได้'
            )
          }

          ctx.fillStyle =
            '#ffffff'

          ctx.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
          )

          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            background: '#ffffff',
          }).promise

          // ลดขนาดข้อมูลสำหรับเก็บใน DB
          // เก็บภาพแทนไฟล์ PDF ต้นฉบับ

          converted.push({
            id: makeId(),

            image:
              canvas.toDataURL(
                'image/jpeg',
                0.88
              ),
          })

          page.cleanup()

          canvas.width = 0
          canvas.height = 0
        }

        const candidate = {
          version: 1,

          mode: 'pdf',

          sourceName: file.name,

          slides: converted,
        }

        if (
          JSON.stringify(candidate).length >
          MAX_CONTENT_CHARS
        ) {
          throw new Error(
            'ไฟล์มีภาพมากเกินไป กรุณาลดจำนวนหน้าหรือขนาดภาพใน PDF'
          )
        }

        // เปลี่ยนข้อมูลเมื่อแปลงสำเร็จครบ

        setSlides(converted)

        setSourceName(
          file.name
        )

        setMode('pdf')

        setActivePage(0)

        setDirty(true)

        setMessageType('success')

        setMessage(
          `แปลง PDF ${converted.length} หน้าเรียบร้อย กรุณาตรวจพรีวิวและบันทึก`
        )

      } catch (error) {
        console.error(
          'Section 11 import:',
          error
        )

        setMessageType('error')

        setMessage(
          error?.name ===
            'PasswordException'
              ? 'PDF มีรหัสผ่าน กรุณาปลดรหัสก่อนนำเข้า'
              : error.message ||
                'นำเข้า PDF ไม่สำเร็จ'
        )

      } finally {
        try {
          if (pdfDocument) {
            await pdfDocument.destroy()
          } else if (task) {
            await task.destroy()
          }
        } catch (error) {
          console.warn(
            'Section 11 PDF cleanup:',
            error
          )
        }

        setProcessing(false)
      }
    }

    /* ======================================
       SELECT NO-EVENT REPORT
    ====================================== */

    const chooseNoEvent = () => {
      if (
        busy ||
        !canEdit
      ) {
        return
      }

      if (
        mode === 'pdf' &&
        slides.length &&
        !window.confirm(
          'เปลี่ยนเป็น “ไม่มีเหตุสำคัญ” จะลบสไลด์ PDF ของเดือนนี้เมื่อกดบันทึก ยืนยันหรือไม่?'
        )
      ) {
        return
      }

      if (mode === 'none') {
        return
      }

      setMode('none')
      setSlides([])
      setSourceName('')
      setActivePage(0)

      setDirty(true)

      setMessageType('')

      setMessage(
        'เลือกหน้ารายงานไม่มีเหตุสำคัญแล้ว กรุณากดบันทึก'
      )
    }

    /* ======================================
       SAVE SECTION 11
    ====================================== */

    const save = async () => {
      if (
        !canEdit ||
        !validReport ||
        busy ||
        loadError
      ) {
        return
      }

      if (
        mode === 'pdf' &&
        !slides.length
      ) {
        setMessageType('error')

        setMessage(
          'ยังไม่มีหน้า PDF สำหรับบันทึก'
        )

        return
      }

      if (
        mode === 'none' &&
        !noEventText.trim()
      ) {
        setMessageType('error')

        setMessage(
          'กรุณากรอกข้อความสำหรับเดือนที่ไม่มีเหตุ'
        )

        return
      }

      const content = {
        version: 1,

        mode,

        sourceName:
          mode === 'pdf'
            ? sourceName
            : '',

        noEventText:
          noEventText.trim(),

        slides:
          mode === 'pdf'
            ? slides
            : [],
      }

      if (
        JSON.stringify(content).length >
        MAX_CONTENT_CHARS
      ) {
        setMessageType('error')

        setMessage(
          'ข้อมูลภาพมีขนาดใหญ่เกินกำหนด'
        )

        return
      }

      setSaving(true)

      setMessage(
        'กำลังบันทึกข้อมูล...'
      )

      setMessageType('')

      try {
        let result

        if (rowExists) {
          result =
            await supabase
              .from('monthly_report_sections')
              .update({ content })
              .eq('report_id', report.id)
              .eq('section_no', 11)
              .select('report_id')

        } else {
          result =
            await supabase
              .from('monthly_report_sections')
              .insert({
                report_id: report.id,

                section_no: 11,

                content,
              })
              .select('report_id')
        }

        if (result.error) {
          throw result.error
        }

        if (!result.data?.length) {
          throw new Error(
            'บันทึกไม่ได้ กรุณาตรวจสิทธิ์ Supabase'
          )
        }

        setRowExists(true)

        setHasStoredData(true)

        setDirty(false)

        setMessageType('success')

        setMessage(
          mode === 'none'
            ? 'บันทึกรายงานเดือนที่ไม่มีเหตุสำคัญเรียบร้อยแล้ว'
            : `บันทึก PDF ${slides.length} หน้าเรียบร้อยแล้ว`
        )

        onDataChange?.()

      } catch (error) {
        console.error(
          'Section 11 save:',
          error
        )

        setMessageType('error')

        setMessage(
          error.message ||
          'บันทึกไม่สำเร็จ'
        )

      } finally {
        setSaving(false)
      }
    }

    /* ======================================
       CENTRAL PDF EXPORT
    ====================================== */

    useImperativeHandle(ref, () => ({
      isReady: () =>
        !busy &&
        !loadError &&
        !!report?.id,

      hasData: () =>
        !busy &&
        !loadError &&
        validReport &&
        hasStoredData &&
        !dirty &&
        (
          mode === 'none' ||
          slides.length > 0
        ),

      exportPdfPages: async () => {
        if (
          busy ||
          loadError ||
          !validReport ||
          !hasStoredData ||
          dirty
        ) {
          throw new Error(
            'หัวข้อ 11 ยังไม่ได้บันทึกหรือยังไม่พร้อมส่งออก'
          )
        }

        // ไม่มีเหตุ = ส่งออก 1 หน้า

        if (mode === 'none') {
          return [{
            orientation: 'landscape',

            dataUrl:
              await captureNoEventPaper(
                paperRef.current
              ),
          }]
        }

        // มี PDF = ส่งทุกหน้า

        const pages = []

        for (
          let i = 0;
          i < slides.length;
          i++
        ) {
          pages.push({
            orientation: 'landscape',

            dataUrl:
              await renderImportedPage(
                slides[i].image,
                i,
                title,
                subtitle
              ),
          })
        }

        return pages
      },
    }))

    /* ======================================
       UI
    ====================================== */

    return (
      <div
        className={`section11-editor ${
          canEdit
            ? 'section11-editing'
            : ''
        }`}
      >

        {/* EDIT SIDEBAR */}

        {canEdit && (
          <aside className="section11-panel">

            <div className="section11-panel-head">

              <span>หัวข้อ 11</span>

              <h3>
                รายงานผลการปฏิบัติเหตุสำคัญ
              </h3>

              <p>
                นำเข้า PDF หรือสร้างหน้ารายงาน
                สำหรับเดือนที่ไม่มีเหตุ
              </p>

              {mode === 'pdf' &&
                slides.length > 0 && (

                <div className="section11-page-nav">

                  <button
                    type="button"
                    disabled={
                      activePage === 0 ||
                      busy
                    }
                    onClick={() =>
                      setActivePage(
                        n => n - 1
                      )
                    }
                  >
                    ‹
                  </button>

                  <select
                    value={activePage}
                    disabled={busy}
                    onChange={e =>
                      setActivePage(
                        Number(e.target.value)
                      )
                    }
                  >
                    {slides.map(
                      (slide, i) => (

                        <option
                          key={slide.id}
                          value={i}
                        >
                          หน้า {i + 1} / {slides.length}
                        </option>

                      )
                    )}
                  </select>

                  <button
                    type="button"
                    disabled={
                      activePage >=
                        slides.length - 1 ||
                      busy
                    }
                    onClick={() =>
                      setActivePage(
                        n => n + 1
                      )
                    }
                  >
                    ›
                  </button>

                </div>
              )}

            </div>

            <div className="section11-panel-body">

              <h4>เลือกรูปแบบรายงาน</h4>

              <div className="section11-mode-list">

                <div
                  className={`section11-mode ${
                    mode === 'pdf'
                      ? 'active'
                      : ''
                  }`}
                >
                  <FileText size={19} />

                  <div>
                    <strong>
                      รายงานเหตุสำคัญ (PDF)
                    </strong>

                    <small>
                      นำเข้ารายงานที่จัดทำไว้แล้ว
                    </small>
                  </div>
                </div>

                <button
                  type="button"
                  className={`section11-mode ${
                    mode === 'none'
                      ? 'active'
                      : ''
                  }`}
                  disabled={
                    busy ||
                    !validReport
                  }
                  onClick={chooseNoEvent}
                >
                  <ShieldCheck size={19} />

                  <div>
                    <strong>
                      ไม่มีเหตุสำคัญในเดือนนี้
                    </strong>

                    <small>
                      ระบบสร้างรายงานหนึ่งหน้าให้
                    </small>
                  </div>

                </button>

              </div>

              <div className="section11-separator" />

              <h4>อัปโหลด PDF</h4>

              <p className="section11-help">
                รองรับ PDF สูงสุด 30 หน้า
                ขนาดไม่เกิน 40 MB
                ระบบแปลงแต่ละหน้าเป็นภาพ
                เพื่อลงรายงาน
              </p>

              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={handleImportPdf}
              />

              <button
                type="button"
                className="section11-import"
                disabled={
                  busy ||
                  !validReport
                }
                onClick={() =>
                  pdfInputRef.current?.click()
                }
              >
                {processing
                  ? 'กำลังแปลง PDF...'
                  : mode === 'pdf' &&
                    slides.length
                    ? 'อัปโหลด PDF ใหม่'
                    : 'อัปโหลดไฟล์ PDF'}
              </button>

              {mode === 'pdf' &&
                sourceName && (

                <p className="section11-filename">
                  {sourceName}
                </p>
              )}

              {/* NO-EVENT TEXT EDITOR */}

              {mode === 'none' && (
                <>
                  <div className="section11-separator" />

                  <h4>
                    ข้อความสำหรับเดือนที่ไม่มีเหตุ
                  </h4>

                  <textarea
                    rows={3}
                    value={noEventText}
                    disabled={busy}
                    maxLength={220}
                    onChange={e => {
                      setNoEventText(
                        e.target.value
                      )

                      setDirty(true)
                    }}
                  />

                  <p className="section11-help">
                    ชื่อศูนย์และเดือนรายงาน
                    เปลี่ยนตามข้อมูลที่เลือก
                    โดยอัตโนมัติ
                  </p>
                </>
              )}

              <div className="section11-separator" />

              <div
                className={`section11-save-state ${
                  dirty
                    ? 'unsaved'
                    : hasStoredData
                      ? 'saved'
                      : ''
                }`}
              >
                {dirty
                  ? '● มีการแก้ไขที่ยังไม่ได้บันทึก'
                  : hasStoredData
                    ? '✓ บันทึกข้อมูลแล้ว'
                    : 'ยังไม่ได้บันทึกข้อมูล'}
              </div>

              <button
                type="button"
                className="section11-save"
                disabled={
                  busy ||
                  !validReport ||
                  !!loadError
                }
                onClick={save}
              >
                {saving
                  ? 'กำลังบันทึก...'
                  : 'บันทึกรายงานหัวข้อ 11'}
              </button>

              <p className="section11-help">
                ไม่มีปุ่ม PNG แยก
                หน้านี้จะถูกใช้ในระบบ
                รวม PDF ทั้งเล่ม
                เมื่อบันทึกแล้ว
              </p>

              {message && (
                <p
                  className={`section11-message ${messageType}`}
                  role="status"
                >
                  {message}
                </p>
              )}

              {loadError && (
                <p className="section11-message error">
                  {loadError}
                </p>
              )}

            </div>
          </aside>
        )}

        {/* A4 PREVIEW */}

        <div
          className="section11-preview"
          ref={previewRef}
        >

          {!canEdit &&
            mode === 'pdf' &&
            slides.length > 0 && (

            <div className="section11-view-nav">

              <button
                type="button"
                disabled={activePage === 0}
                onClick={() =>
                  setActivePage(
                    n => n - 1
                  )
                }
              >
                ‹ ก่อนหน้า
              </button>

              <span>
                หน้า {activePage + 1} / {slides.length}
              </span>

              <button
                type="button"
                disabled={
                  activePage >=
                  slides.length - 1
                }
                onClick={() =>
                  setActivePage(
                    n => n + 1
                  )
                }
              >
                ถัดไป ›
              </button>

            </div>
          )}

          <div
            className="section11-stage"
            style={{
              width:
                PAPER_W * scale,

              height:
                PAPER_H * scale,
            }}
          >

            <article
              className="section11-paper"
              ref={paperRef}
              style={{
                transform:
                  `scale(${scale})`,
              }}
            >

              <div className="section11-page-body">

                {/* REPORT HEADING */}

                {(
                  mode === 'none' ||
                  activePage === 0
                ) && (

                  <header className="section11-report-heading">

                    <h2>{title}</h2>

                    <p>{subtitle}</p>

                  </header>
                )}

                <div className="section11-content">

                  {/* IMPORTED PDF */}

                  {mode === 'pdf' &&
                    currentSlide ? (

                    <div
                      className="section11-slide-shell"
                      style={{
                        width: shownWidth,
                        height: shownHeight,
                      }}
                    >

                      <img
                        key={currentSlide.id}
                        src={currentSlide.image}
                        alt={`รายงานเหตุสำคัญ หน้า ${activePage + 1}`}
                        style={{
                          width:
                            `${100 / visibleRatio}%`,

                          height: '100%',

                          maxWidth: 'none',

                          marginLeft:
                            `-${100 * imageCrop.left / visibleRatio}%`,

                          objectFit: 'fill',
                        }}
                        onLoad={event => {
                          const image =
                            event.currentTarget

                          if (
                            !image.naturalWidth ||
                            !image.naturalHeight
                          ) {
                            return
                          }

                          setImageSize(old =>
                            old.width ===
                              image.naturalWidth &&
                            old.height ===
                              image.naturalHeight
                              ? old
                              : {
                                  width:
                                    image.naturalWidth,

                                  height:
                                    image.naturalHeight,
                                }
                          )

                          const crop =
                            detectWhiteSideCrop(
                              image
                            )

                          setImageCrop(old =>
                            old.left === crop.left &&
                            old.right === crop.right
                              ? old
                              : crop
                          )
                        }}
                      />

                    </div>

                  ) : mode === 'none' ? (

                    /* NO EVENT TEMPLATE */

                    <div className="section11-noevent">

                      <div className="section11-pattern pattern-a" />

                      <div className="section11-pattern pattern-b" />

                      <div className="section11-pattern pattern-c" />

                      <span className="section11-bubble bubble-a" />

                      <span className="section11-bubble bubble-b" />

                      <span className="section11-bubble bubble-c" />

                      <div className="section11-noevent-banner">
                        รายงานเหตุสำคัญ {stationName}
                      </div>

                      <div className="section11-noevent-center">

                        <strong>
                          รายงานเหตุสำคัญประจำเดือน {monthName} {displayYear}
                        </strong>

                        <p>
                          {noEventText ||
                            'ไม่มีเหตุการณ์สำคัญประจำเดือน'}
                        </p>

                      </div>

                      

                      <div className="section11-brand">
                        CCTV

                        <small>
                          MONTHLY REPORT
                        </small>
                      </div>

                    </div>

                  ) : (

                    <div className="section11-empty">

                      <strong>
                        ยังไม่มีไฟล์ PDF
                      </strong>

                      <p>
                        อัปโหลด PDF
                        หรือเลือกไม่มีเหตุสำคัญ
                      </p>

                    </div>
                  )}

                </div>

              </div>

            </article>

          </div>

          <p className="section11-preview-caption">

            {mode === 'none'
              ? 'หัวข้อ 11 · รายงานเดือนที่ไม่มีเหตุสำคัญ (1 หน้า)'
              : `หัวข้อ 11 · หน้า ${activePage + 1} / ${slides.length}`}

          </p>

        </div>

      </div>
    )
  }
)
