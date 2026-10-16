
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

GlobalWorkerOptions.workerSrc = pdfWorkerUrl
import { supabase } from '../../lib/supabase'
import './Section07Editor.css'


/* ==========================================
   SECTION 07 — SHARED MEMORY CACHE
   ลดการโหลดภาพซ้ำระหว่าง Preview และ PDF
========================================== */

const section07LoadCache = new Map()
const SECTION07_CACHE_TTL = 5 * 60 * 1000

async function loadSection07Cached(reportId) {
  const { data: { session } } =
    await supabase.auth.getSession()

  const key = `${session?.user?.id || 'guest'}:${reportId}`
  const cached = section07LoadCache.get(key)

  if (cached && Date.now() < cached.expiresAt) {
    return cached.promise
  }

  const promise = supabase
    .from('monthly_report_sections')
    .select('content')
    .eq('report_id', reportId)
    .eq('section_no', 7)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw error
      return data
    })

  section07LoadCache.set(key, {
    promise,
    expiresAt: Date.now() + SECTION07_CACHE_TTL,
  })

  // เก็บไม่เกิน 2 รายงานในหน่วยความจำ
  while (section07LoadCache.size > 2) {
    const oldestKey =
      section07LoadCache.keys().next().value

    section07LoadCache.delete(oldestKey)
  }

  try {
    return await promise
  } catch (error) {
    const current = section07LoadCache.get(key)

    if (current?.promise === promise) {
      section07LoadCache.delete(key)
    }

    throw error
  }
}


const PAPER_W = 1120
const PAPER_H = 792

// ตรวจขอบขาวซ้าย-ขวาที่ติดมากับภาพ PDF
// ตัดไม่เกิน 6% ต่อด้าน และตัดเฉพาะแถบที่เป็นสีขาวจริง
function detectWhiteSideCrop(image) {
  const width = Math.min(640, image.naturalWidth)
  const height = Math.max(
    1,
    Math.round(
      width * image.naturalHeight / image.naturalWidth
    )
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  })

  if (!ctx) {
    return { left: 0, right: 0 }
  }

  ctx.drawImage(image, 0, 0, width, height)

  const pixels = ctx.getImageData(
    0, 0, width, height
  ).data

  const yStart = Math.floor(height * 0.12)
  const yEnd = Math.ceil(height * 0.88)
  const maxScan = Math.floor(width * 0.06)

  const isWhiteColumn = x => {
    let white = 0
    let count = 0

    for (let y = yStart; y < yEnd; y += 3) {
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

    return count > 0 && white / count >= 0.985
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
const MAX_SLIDES = 30
const MAX_PDF_BYTES = 40 * 1024 * 1024
const MAX_CONTENT_CHARS = 15_000_000

const SECTION07_MONTHS = [
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


const makeId = () =>
  crypto.randomUUID()

function canvasToPng(canvas) {
  return canvas.toDataURL('image/png')
}

// แปลงภาพที่ใช้แทนสไลด์เป็น PNG
async function imageFileToPng(file) {
  const accepted = [
    'image/png',
    'image/jpeg',
    'image/webp',
  ]

  if (!accepted.includes(file.type)) {
    throw new Error('รองรับเฉพาะภาพ PNG, JPG และ WEBP')
  }

  const bitmap = await createImageBitmap(file)

  try {
    const ratio = Math.min(
      1,
      1400 / bitmap.width,
      1000 / bitmap.height
    )

    const canvas = document.createElement('canvas')

    canvas.width = Math.max(
      1,
      Math.round(bitmap.width * ratio)
    )

    canvas.height = Math.max(
      1,
      Math.round(bitmap.height * ratio)
    )

    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.drawImage(
      bitmap,
      0,
      0,
      canvas.width,
      canvas.height
    )

    return canvasToPng(canvas)
  } finally {
    bitmap.close()
  }
}

// จัดภาพสไลด์ลงกระดาษ A4 แนวนอน
// รักษาสัดส่วนเดิม ไม่ยืดและไม่ตัดภาพ

async function makePdfPage(
  imageUrl,
  {
    showHeader = false,
    headerText = '',
    subtitleText = '',
  } = {}
) {
  const image = new Image()
  image.src = imageUrl
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = PAPER_W * 2
  canvas.height = PAPER_H * 2

  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.scale(2, 2)

  
const pagePaddingX = 34
const pagePaddingTop = 30
const pagePaddingBottom = 28

let contentTop = pagePaddingTop

if (showHeader && headerText) {
  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  // หัวเรื่องเหมือนหัวข้อ 06
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#831329'
  ctx.font = "900 26px 'Noto Sans Thai', sans-serif"

  ctx.fillText(
    headerText,
    pagePaddingX,
    contentTop
  )

  // ชื่อศูนย์และเดือนรายงาน
  ctx.fillStyle = '#667085'
  ctx.font = "12px 'Noto Sans Thai', sans-serif"

  ctx.fillText(
    subtitleText,
    pagePaddingX,
    contentTop + 36
  )

  // ความสูงหัวข้อ 54px + ช่องว่าง 12px
  contentTop += 66
}


  // ลดขนาดสไลด์ลงเพื่อให้มีพื้นที่รอบ ๆ และดูไม่อึดอัด
  const frameX = pagePaddingX
    const frameY = contentTop
    const frameW = PAPER_W - pagePaddingX * 2
    const frameH =
    PAPER_H - frameY - pagePaddingBottom

    const radius = 18

  const crop = detectWhiteSideCrop(image)

    const sourceX = Math.round(
    image.naturalWidth * crop.left
    )

    const sourceRight = Math.round(
    image.naturalWidth * crop.right
    )

    const sourceWidth = Math.max(
    1,
    image.naturalWidth - sourceX - sourceRight
    )

    const ratio = Math.min(
    frameW / sourceWidth,
    frameH / image.naturalHeight
    )

    const drawW = sourceWidth * ratio
    const drawH = image.naturalHeight * ratio

  const drawX = frameX + (frameW - drawW) / 2
  const drawY = frameY + (frameH - drawH) / 2

  // เงา
  ctx.save()
  ctx.beginPath()
  roundedRect(
    ctx,
    drawX,
    drawY,
    drawW,
    drawH,
    radius
  )
  ctx.closePath()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.16)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 8
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()

  // clip มุมโค้ง
  ctx.save()
  ctx.beginPath()
  roundedRect(
    ctx,
    drawX,
    drawY,
    drawW,
    drawH,
    radius
  )
  ctx.closePath()
  ctx.clip()

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(drawX, drawY, drawW, drawH)

  ctx.drawImage(
  image,
  sourceX,
  0,
  sourceWidth,
  image.naturalHeight,
  drawX,
  drawY,
  drawW,
  drawH
)
  ctx.restore()

  // เส้นขอบบาง ๆ
  ctx.save()
  ctx.beginPath()
  roundedRect(
    ctx,
    drawX,
    drawY,
    drawW,
    drawH,
    radius
  )
  ctx.closePath()
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.restore()

  return canvas.toDataURL('image/png')
}

function roundedRect(
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

  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + r
  )
  ctx.lineTo(x + width, y + height - r)
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
  ctx.quadraticCurveTo(x, y, x + r, y)
}


/* ==========================================
   SECTION 07 — TWO-MONTH RETENTION
   เก็บเฉพาะ 2 เดือนรายงานล่าสุดที่มีสไลด์
   แยกตามศูนย์
========================================== */

const section07MonthKey = row =>
  Number(row.report_year) * 12 +
  Number(row.report_month)

// อ่านเฉพาะเดือนที่มีการบันทึกหัวข้อ 07
async function listSection07SavedMonths(centerId) {
  const { data: reports, error: reportError } =
    await supabase
      .from('monthly_reports')
      .select('id, report_year, report_month')
      .eq('center_id', centerId)

  if (reportError) throw reportError

  if (!reports?.length) return []

  const reportIds = reports.map(item => item.id)

  // อ่านเฉพาะเวลาบันทึก ไม่ดึงภาพ PNG
  const { data: sections, error: sectionError } =
    await supabase
      .from('monthly_report_sections')
      .select('report_id, saved_at:content->>savedAt')
      .eq('section_no', 7)
      .in('report_id', reportIds)

  if (sectionError) throw sectionError

  const savedAtMap = new Map(
    (sections || []).map(item => [
      String(item.report_id),
      item.saved_at || null,
    ])
  )

  return reports
    .filter(item =>
      savedAtMap.has(String(item.id))
    )
    .map(item => ({
      ...item,
      savedAt: savedAtMap.get(String(item.id)),
    }))
    .sort((a, b) => {
      const timeA = Date.parse(a.savedAt || '') || 0
      const timeB = Date.parse(b.savedAt || '') || 0

      if (timeA !== timeB) {
        return timeB - timeA
      }

      // ข้อมูลเดิมที่ไม่มี savedAt
      return (
        section07MonthKey(b) -
        section07MonthKey(a)
      )
    })
}
// ลบเฉพาะข้อมูลหัวข้อ 07 ที่เกินสองเดือน
async function cleanupSection07OldMonths(centerId) {
  const savedMonths =
    await listSection07SavedMonths(centerId)

  const oldMonths = savedMonths.slice(2)

  if (!oldMonths.length) return 0

  const oldReportIds = oldMonths.map(
    item => item.id
  )

  const { data: deletedRows, error } =
    await supabase
      .from('monthly_report_sections')
      .delete()
      .eq('section_no', 7)
      .in('report_id', oldReportIds)
      .select('report_id')

  if (error) throw error

  // ตรวจว่าลบสำเร็จจริง ไม่ใช่ถูก RLS ปฏิเสธเงียบ ๆ
  const deletedIds = new Set(
    (deletedRows || []).map(item =>
      String(item.report_id)
    )
  )

  if (
    oldReportIds.some(
      id => !deletedIds.has(String(id))
    )
  ) {
    throw new Error(
      'ลบข้อมูลเดือนเก่าบางรายการไม่สำเร็จ กรุณาตรวจสิทธิ์ Supabase'
    )
  }

  return oldReportIds.length
}


// ==========================================
// SECTION 07
// ==========================================

export default forwardRef(function Section07Editor({
  report,
  center,
  month,
  year,
  canEdit = false,
  onDataChange,
}, ref) {
  const previewRef = useRef(null)
  const pdfInputRef = useRef(null)
  const imageInputRef = useRef(null)

  const [scale, setScale] = useState(1)
  const [slideDimensions, setSlideDimensions] = useState({
    width: 4,
    height: 3,
    })

  const [slideCrop, setSlideCrop] = useState({
    left: 0,
    right: 0,
    })  

  const [slides, setSlides] = useState([])
  const [activePage, setActivePage] = useState(0)
  const [sourceName, setSourceName] = useState('')

  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [rowExists, setRowExists] = useState(false)
  const [hasStoredData, setHasStoredData] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] =
    useState(false)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')

  const validReport =
    !!report?.id &&
    String(report.center_id) === String(center?.id) &&
    Number(report.report_month) === Number(month) &&
    Number(report.report_year) === Number(year)

  const busy = loading || processing || saving

  const currentSlide = slides[activePage] || null

  // ขนาดพื้นที่แสดงสไลด์ในกระดาษ A4 แนวนอน
    const slideMaxWidth = 1052
    const slideMaxHeight = activePage === 0 ? 668 : 734

    // ปรับขนาดตามสัดส่วนภาพจริง ไม่ยืด ไม่ตัด
    const visibleRatio =
    1 - slideCrop.left - slideCrop.right

    const visibleWidth =
    slideDimensions.width * visibleRatio

    const slideFit = Math.min(
    slideMaxWidth / visibleWidth,
    slideMaxHeight / slideDimensions.height
    )

    const slideWidth = Math.round(
    visibleWidth * slideFit
    )

    const slideHeight = Math.round(
    slideDimensions.height * slideFit
    )

  const reportTitle = 'เหตุการณ์สำคัญที่เกิดขึ้นประจำเดือน'

    const reportSubtitle = [
    center?.name || 'ศูนย์กล้องวงจรปิด',
    `${SECTION07_MONTHS[Number(month) - 1] || '-'} ${year}`,
    ].join(' · ')

  // ========================================
  // LOAD
  // ========================================

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setLoadError('')
      setSlides([])
      setActivePage(0)
      setSourceName('')
      setRowExists(false)
      setHasStoredData(false)
      setHasUnsavedChanges(false)
      setMessage('')

      if (!report?.id) {
        setLoading(false)
        return
      }

      try {
        
        const row = await loadSection07Cached(report.id)

        if (!active) return


        setRowExists(!!row)

        const content = row?.content

        if (
          content?.version === 1 &&
          Array.isArray(content.slides)
        ) {
          const loadedSlides = content.slides
            .filter(item =>
              typeof item.image === 'string' &&
              item.image.startsWith('data:image/')
            )
            .map(item => ({
              id: item.id || makeId(),
              image: item.image,
            }))

          setSlides(loadedSlides)
          setSourceName(content.sourceName || '')
          setHasStoredData(loadedSlides.length > 0)
        }
      } catch (error) {
        if (!active) return

        console.error('Section 07 load:', error)
        setLoadError(
          error.message ||
          'โหลดข้อมูลหัวข้อ 07 ไม่สำเร็จ'
        )
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [report?.id])

  // ========================================
  // RESPONSIVE PREVIEW
  // ========================================

  useEffect(() => {
    const node = previewRef.current
    if (!node) return

    const resize = () => {
      setScale(
        Math.min(
          1,
          Math.max(
            0.1,
            (node.clientWidth - 40) / PAPER_W
          )
        )
      )
    }

    const observer = new ResizeObserver(resize)
    observer.observe(node)
    resize()

    return () => observer.disconnect()
  }, [canEdit])

  
  // ========================================
  // IMPORT PDF → PNG PER PAGE
  // ========================================

  const handleImportPdf = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || busy || !canEdit) return

    // ตรวจสอบนามสกุลและชนิดไฟล์
    if (
      !/\.pdf$/i.test(file.name) ||
      (file.type && file.type !== 'application/pdf')
    ) {
      setMessageType('error')
      setMessage('กรุณาอัปโหลดไฟล์ PDF เท่านั้น')
      return
    }

    if (file.size > MAX_PDF_BYTES) {
      setMessageType('error')
      setMessage('ไฟล์ PDF ต้องไม่เกิน 40 MB')
      return
    }

    // ป้องกันแทนที่ข้อมูลเดิมโดยไม่ตั้งใจ
    if (
      slides.length > 0 &&
      !window.confirm(
        'นำเข้า PDF ใหม่จะแทนที่สไลด์เดิมทั้งหมด ต้องการดำเนินการต่อหรือไม่?'
      )
    ) {
      return
    }

    setProcessing(true)
    setMessageType('')
    setMessage('กำลังอ่านไฟล์ PDF...')

    let pdfDocument = null
    let loadingTask = null

    try {
      // อ่านไฟล์ PDF ในเครื่องผู้ใช้
      const buffer = await file.arrayBuffer()

      loadingTask = getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
      })

      pdfDocument = await loadingTask.promise

      const pageCount = pdfDocument.numPages

      if (pageCount === 0) {
        throw new Error('ไม่พบหน้าเอกสารในไฟล์ PDF')
      }

      if (pageCount > MAX_SLIDES) {
        throw new Error(
          `รองรับสูงสุด ${MAX_SLIDES} หน้าต่อรายงาน`
        )
      }

      const convertedSlides = []

      // แปลง PDF ทีละหน้าเป็นภาพ PNG
      for (
        let pageNumber = 1;
        pageNumber <= pageCount;
        pageNumber++
      ) {
        setMessage(
          `กำลังแปลง PDF หน้า ${pageNumber} / ${pageCount}...`
        )

        const page = await pdfDocument.getPage(
          pageNumber
        )

        // อ่านขนาดหน้าต้นฉบับ
        const originalViewport =
          page.getViewport({ scale: 1 })

        // กำหนดความละเอียดสำหรับรายงาน
        // โดยรักษาสัดส่วนของต้นฉบับ
        const renderScale = Math.min(
          2,
          1600 / originalViewport.width,
          1100 / originalViewport.height
        )

        const viewport = page.getViewport({
          scale: renderScale,
        })

        const canvas =
          document.createElement('canvas')

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        const ctx = canvas.getContext(
          '2d',
          { alpha: false }
        )

        if (!ctx) {
          throw new Error(
            'ไม่สามารถสร้าง Canvas สำหรับแปลง PDF ได้'
          )
        }

        // พื้นหลังสีขาว
        ctx.fillStyle = '#ffffff'

        ctx.fillRect(
          0,
          0,
          canvas.width,
          canvas.height
        )

        // วาดหน้า PDF ลงบน Canvas
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          background: '#ffffff',
        }).promise

        // แปลงหน้า PDF เป็น PNG
        const imageDataUrl =
          canvas.toDataURL('image/png')

        convertedSlides.push({
          id: makeId(),
          image: imageDataUrl,
        })

        // คืนหน่วยความจำหลังแปลงแต่ละหน้า
        page.cleanup()

        canvas.width = 0
        canvas.height = 0
      }

      // ตรวจขนาดก่อนเก็บใน Supabase
      const content = {
        version: 1,
        sourceName: file.name,
        slides: convertedSlides,
      }

      const contentSize =
        JSON.stringify(content).length

      if (contentSize > MAX_CONTENT_CHARS) {
        throw new Error(
          'ภาพหลังแปลงมีขนาดใหญ่เกินกำหนด กรุณาลดขนาด PDF หรือลดจำนวนหน้า'
        )
      }

      // เปลี่ยนข้อมูลเมื่อแปลงครบทุกหน้าแล้วเท่านั้น
      setSlides(convertedSlides)
      setSourceName(file.name)
      setActivePage(0)

      setHasUnsavedChanges(true)

      setMessageType('success')

      setMessage(
        `แปลง PDF สำเร็จ ${pageCount} หน้า กรุณาตรวจพรีวิวและกดบันทึก`
      )

    } catch (error) {
      console.error(
        'Section 07 PDF Import:',
        error
      )

      setMessageType('error')

      if (error?.name === 'PasswordException') {
        setMessage(
          'ไฟล์ PDF มีรหัสผ่าน กรุณาปลดรหัสก่อนนำเข้า'
        )
      } else {
        setMessage(
          error.message ||
          'ไม่สามารถแปลงไฟล์ PDF ได้'
        )
      }

    } finally {
      // ปิด PDF.js และคืนหน่วยความจำ
      try {
        if (pdfDocument) {
          await pdfDocument.destroy()
        } else if (loadingTask) {
          await loadingTask.destroy()
        }
      } catch (cleanupError) {
        console.warn(
          'PDF cleanup:',
          cleanupError
        )
      }

      setProcessing(false)
    }
  }



  // ========================================
  // REPLACE ONE SLIDE WITH IMAGE
  // ========================================

  const handleReplaceImage = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || busy || !canEdit || !currentSlide) return

    setProcessing(true)
    setMessage('กำลังเปลี่ยนภาพสไลด์...')

    try {
      const png = await imageFileToPng(file)

      setSlides(previous =>
        previous.map((item, index) =>
          index === activePage
            ? { ...item, image: png }
            : item
        )
      )

      setHasUnsavedChanges(true)
      setMessageType('success')
      setMessage(
        `เปลี่ยนภาพสไลด์หน้า ${activePage + 1} แล้ว กรุณากดบันทึก`
      )
    } catch (error) {
      setMessageType('error')
      setMessage(
        error.message || 'เปลี่ยนภาพไม่สำเร็จ'
      )
    } finally {
      setProcessing(false)
    }
  }

  // ========================================
  // REMOVE ONE SLIDE
  // ========================================

  const removePage = () => {
    if (!canEdit || busy || !currentSlide) return

    if (
      !window.confirm(
        `ต้องการลบสไลด์หน้า ${activePage + 1} ใช่หรือไม่?`
      )
    ) return

    setSlides(previous =>
      previous.filter((_, index) => index !== activePage)
    )

    setActivePage(previous =>
      Math.max(0, previous - 1)
    )

    setHasUnsavedChanges(true)
    setMessageType('')
    setMessage('ลบสไลด์แล้ว กรุณากดบันทึก')
  }

  // ========================================
  // SAVE
  // ========================================

  const save = async () => {
    if (!canEdit || !validReport || busy || loadError) {
      return
    }

    if (!slides.length) {
      setMessageType('error')
      setMessage('ยังไม่มีสไลด์สำหรับบันทึก')
      return
    }

    const content = {
      version: 1,

      savedAt: new Date().toISOString(),

      sourceName,

      slides: slides.map(item => ({
        id: item.id,
        image: item.image,
      })),
    }

    if (
      JSON.stringify(content).length > MAX_CONTENT_CHARS
    ) {
      setMessageType('error')
      setMessage(
        'ข้อมูลภาพสไลด์ใหญ่เกินกำหนด กรุณาลดจำนวนหรือขนาดภาพก่อนบันทึก'
      )
      return
    }

    
    setSaving(true)
    setMessage('กำลังตรวจสอบเดือนรายงาน...')

    try {
    // อนุญาตให้บันทึกทุกเดือน
    // เก็บ 2 เดือนตาม savedAt

    setMessage('กำลังบันทึกข้อมูล...')

    let error


      if (rowExists) {
        ({ error } = await supabase
          .from('monthly_report_sections')
          .update({ content })
          .eq('report_id', report.id)
          .eq('section_no', 7))
      } else {
        ({ error } = await supabase
          .from('monthly_report_sections')
          .insert({
            report_id: report.id,
            section_no: 7,
            content,
          }))
      }

      
        
      if (error) throw error

      // บันทึกสำเร็จ ล้าง Cache เพื่อให้โหลดข้อมูลล่าสุด
      section07LoadCache.clear()

      setRowExists(true)
      setHasStoredData(true)
      setHasUnsavedChanges(false)


        // ลบข้อมูลเก่าหลังจากบันทึกเดือนใหม่สำเร็จ
        let removedMonths = 0
        let cleanupError = null

        try {
        removedMonths =
            await cleanupSection07OldMonths(center.id)
        } catch (error) {
        cleanupError = error

        console.error(
            'Section 07 retention cleanup error:',
            error
        )
        }

        if (cleanupError) {
        setMessageType('error')
        setMessage(
            `บันทึก ${slides.length} สไลด์สำเร็จแล้ว ` +
            `แต่ลบข้อมูลเดือนเก่าไม่สำเร็จ: ` +
            `${cleanupError.message}`
        )
        } else {
        setMessageType('success')
        setMessage(
            `บันทึก ${slides.length} สไลด์สำเร็จแล้ว` +
            (
            removedMonths > 0
                ? ` · ลบข้อมูลหัวข้อ 07 ของเดือนเก่า ${removedMonths} เดือน`
                : ' · ข้อมูลอยู่ภายในเงื่อนไขเก็บ 2 เดือน'
            )
        )
        }

        onDataChange?.()

    } catch (error) {
      console.error('Section 07 save:', error)

      setMessageType('error')
      setMessage(
        error.message || 'บันทึกข้อมูลไม่สำเร็จ'
      )
    } finally {
      setSaving(false)
    }
  }

  // ========================================
  // EXPORT TO CENTRAL PDF
  // ========================================

  useImperativeHandle(ref, () => ({
    isReady: () =>
      !loading && !processing && !loadError,

    hasData: () =>
      !loading &&
      !loadError &&
      validReport &&
      hasStoredData &&
      slides.length > 0,

    exportPdfPages: async () => {
      if (
        loading ||
        processing ||
        loadError ||
        !slides.length
      ) {
        throw new Error(
          'รายงานหัวข้อ 07 ยังไม่พร้อมส่งออก'
        )
      }

      const pages = []

      for (let index = 0; index < slides.length; index++) {
        const item = slides[index]

        pages.push({
            orientation: 'landscape',
            dataUrl: await makePdfPage(item.image, {
                showHeader: index === 0,
                headerText: reportTitle,
                subtitleText: reportSubtitle,
            }),
        })
        }

      return pages
    },
  }))

  // ========================================
  // UI
  // ========================================

  return (
    <div
      className={`section07-editor ${
        canEdit ? 'section07-editing' : ''
      }`}
    >
      {canEdit && (
        <aside className="section07-panel">
          <div className="section07-panel-head">
            <span>หัวข้อ 07</span>
            <h3>เหตุการณ์สำคัญประจำเดือน</h3>
            <p>
            นำเข้า PDF และเปลี่ยนภาพ
            เฉพาะสไลด์ได้
            </p>

            <div className="section07-page-nav">
              <button
                type="button"
                disabled={!slides.length || activePage === 0}
                onClick={() =>
                  setActivePage(page => page - 1)
                }
              >
                ‹
              </button>

              <select
                value={slides.length ? activePage : ''}
                disabled={!slides.length}
                onChange={event =>
                  setActivePage(Number(event.target.value))
                }
              >
                {!slides.length && (
                  <option value="">ไม่มีสไลด์</option>
                )}

                {slides.map((item, index) => (
                  <option
                    value={index}
                    key={item.id}
                  >
                    หน้า {index + 1} / {slides.length}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={
                  !slides.length ||
                  activePage >= slides.length - 1
                }
                onClick={() =>
                  setActivePage(page => page + 1)
                }
              >
                ›
              </button>
            </div>
          </div>

          <div className="section07-panel-body">
            
            <h4>นำเข้า PDF</h4>

            <p className="section07-help">
            รองรับไฟล์ PDF ที่ส่งออกจาก PowerPoint
            สูงสุด 30 หน้า ระบบจะแปลงแต่ละหน้า
            เป็นภาพ PNG ให้อัตโนมัติ
            </p>

            <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            onChange={handleImportPdf}
            />

            <button
            className="section07-import"
            type="button"
            disabled={busy || !validReport}
            onClick={() => pdfInputRef.current?.click()}
            >
            {processing
                ? 'กำลังแปลง PDF...'
                : slides.length
                ? 'อัปโหลด PDF ใหม่'
                : 'อัปโหลดไฟล์ PDF'}
            </button>


            {sourceName && (
              <p className="section07-file-name">
                {sourceName}
              </p>
            )}

            <div className="section07-separator" />

            <h4>แก้ไขสไลด์ที่เลือก</h4>

            <p className="section07-help">
              เลือกหน้าจากด้านบน แล้วอัปโหลด
              รูปภาพใหม่เพื่อแทนที่เฉพาะหน้านั้น
            </p>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={handleReplaceImage}
            />

            <button
              className="section07-replace"
              type="button"
              disabled={busy || !currentSlide}
              onClick={() => imageInputRef.current?.click()}
            >
              เปลี่ยนภาพเฉพาะหน้า {activePage + 1}
            </button>

            <button
              className="section07-delete"
              type="button"
              disabled={busy || !currentSlide}
              onClick={removePage}
            >
              ลบสไลด์หน้านี้
            </button>

            <div
              className={`section07-save-state ${
                hasUnsavedChanges
                  ? 'unsaved'
                  : hasStoredData
                    ? 'saved'
                    : ''
              }`}
            >
              {hasUnsavedChanges
                ? '● มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก'
                : hasStoredData
                  ? '✓ บันทึกข้อมูลแล้ว'
                  : 'ยังไม่ได้บันทึกข้อมูล'}
            </div>

            <button
              className="section07-save"
              type="button"
              disabled={
                busy ||
                !!loadError ||
                !validReport ||
                !slides.length
              }
              onClick={save}
            >
              {saving
                ? 'กำลังบันทึก...'
                : 'บันทึกสไลด์ทั้งหมด'}
            </button>

            <p className="section07-help">
            ภาพทุกหน้าจะส่งเข้า PDF รวมเล่มอัตโนมัติ
            โดยไม่มีปุ่มดาวน์โหลด PNG แยก
            </p>

            <p className="section07-help">
            ระบบเก็บข้อมูลหัวข้อ 07 เฉพาะ 2 เดือน
            ที่กดบันทึกล่าสุด แยกตามศูนย์
            สามารถย้อนกลับไปบันทึกเดือนเก่าได้
            โดยระบบจะลบเดือนที่ไม่ได้บันทึก
            มานานที่สุดโดยอัตโนมัติ
          </p>

            {message && (
              <p
                className={`section07-message ${messageType}`}
                role="status"
              >
                {message}
              </p>
            )}

            {loadError && (
              <p className="section07-message error">
                {loadError}
              </p>
            )}
          </div>
        </aside>
      )}

      <div
        className="section07-preview"
        ref={previewRef}
      >
        {!canEdit && slides.length > 0 && (
          <div className="section07-view-nav">
            <button
              type="button"
              disabled={activePage === 0}
              onClick={() =>
                setActivePage(page => page - 1)
              }
            >
              ‹ ก่อนหน้า
            </button>

            <span>
              หน้า {activePage + 1} / {slides.length}
            </span>

            <button
              type="button"
              disabled={activePage >= slides.length - 1}
              onClick={() =>
                setActivePage(page => page + 1)
              }
            >
              ถัดไป ›
            </button>
          </div>
        )}

        <div
          className="section07-stage"
          style={{
            width: PAPER_W * scale,
            height: PAPER_H * scale,
          }}
        >
          <article
            className="section07-paper"
            style={{
                transform: `scale(${scale})`,
            }}
            >
            {currentSlide ? (
                <div
                className={`section07-page-body ${
                    activePage === 0
                    ? 'has-report-title'
                    : ''
                }`}
                >
                {activePage === 0 && (
                    <header className="section07-report-heading">
                        <h2>{reportTitle}</h2>
                        <p>{reportSubtitle}</p>
                    </header>
                    )}

                
                    <div className="section07-slide-wrap">
                    <div
                        className="section07-slide-shell"
                        style={{
                        width: slideWidth,
                        height: slideHeight,
                        }}
                    >
                        <img
                            key={currentSlide.id}
                            src={currentSlide.image}
                            alt={`สไลด์หน้า ${activePage + 1}`}
                            style={{
                                width: `${100 / visibleRatio}%`,
                                height: '100%',
                                maxWidth: 'none',
                                marginLeft:
                                `-${100 * slideCrop.left / visibleRatio}%`,
                                objectFit: 'fill',
                            }}
                            onLoad={event => {
                                const image = event.currentTarget

                                const width = image.naturalWidth
                                const height = image.naturalHeight

                                if (width > 0 && height > 0) {
                                setSlideDimensions(previous =>
                                    previous.width === width &&
                                    previous.height === height
                                    ? previous
                                    : { width, height }
                                )

                                const crop = detectWhiteSideCrop(image)

                                setSlideCrop(previous =>
                                    previous.left === crop.left &&
                                    previous.right === crop.right
                                    ? previous
                                    : crop
                                )
                                }
                            }}
                            />
                    </div>
                    </div>

                </div>
            ) : (
                <div className="section07-empty">
                <strong>
                    ยังไม่มีสไลด์รายงาน
                </strong>

                <p>
                    อัปโหลดไฟล์ PDF
                    เพื่อสร้างรายงานหัวข้อ 07
                </p>
                </div>
            )}
            </article>
        </div>

        <div className="section07-preview-caption">
          {slides.length
            ? `พรีวิวสไลด์ ${activePage + 1} จาก ${slides.length} หน้า`
            : 'หัวข้อ 07 · ยังไม่มีข้อมูล'}
        </div>
      </div>
    </div>
  )
})
