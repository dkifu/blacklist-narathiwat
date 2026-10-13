import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BrainCircuit, Building2, Camera, CheckCircle2, Copy,
  Download, FileImage, FileText, Images, Loader2,
  RefreshCw, ShieldCheck, Upload,
} from 'lucide-react'
import { toPng, toJpeg } from 'html-to-image'
import { jsPDF } from 'jspdf'
import { supabase } from '../../lib/supabase'
import './CctvAiReport.css'

// CCTV AI V13 — AI severity only, no keyword matching

const GRID_OPTIONS = {
  4: [2, 2],
  6: [3, 2],
  9: [3, 3],
  12: [4, 3],
  16: [4, 4],
}

const STATIONS = {
  'ศูนย์นราธิวาส': 'สภ.เมืองนราธิวาส',
  'ศูนย์ตากใบ': 'สภ.ตากใบ',
  'ศูนย์สุไหงโกลก': 'สภ.สุไหงโกลก',
  'ศูนย์ปัตตานี': 'สภ.เมืองปัตตานี',
  'ศูนย์หาดใหญ่': 'สภ.หาดใหญ่',
  'ศูนย์เบตง': 'สภ.เบตง',
}

const AI_URL =
  import.meta.env.VITE_CCTV_AI_URL ||
  'https://cctv-ai-analysis.dkifu-vss.workers.dev'

const LEVELS = [
  'green',
  'yellow',
  'orange',
  'red',
  'neutral',
]

const LEVEL_NAMES = {
  green: 'ปกติ',
  yellow: 'เฝ้าระวัง',
  orange: 'ผิดปกติ',
  red: 'ฉุกเฉิน',
  neutral: 'ไม่สามารถประเมินได้',
}

const RANK = {
  red: 4,
  orange: 3,
  yellow: 2,
  green: 1,
  neutral: 0,
}

const SUMMARY = [
  { key: 'safety', label: 'ความเรียบร้อย' },
  { key: 'traffic', label: 'การจราจร' },
  { key: 'abnormal', label: 'เหตุผิดปกติ' },
  { key: 'visibility', label: 'สภาพอากาศ/ทัศนวิสัย' },
]

const LIST_FIELDS = [
  {
    key: 'findings',
    title: '2. ผลการตรวจสอบที่สำคัญ',
    max: 5,
  },
  {
    key: 'trafficFindings',
    title: '3. วิเคราะห์สภาพการจราจร',
    max: 3,
  },
  {
    key: 'highlights',
    title: '4. เหตุการณ์น่าสนใจ',
    max: 3,
  },
]

const validLevel = (value) =>
  LEVELS.includes(value) ? value : 'neutral'

const pad = (n) =>
  String(n).padStart(2, '0')

const today = () => {
  const d = new Date()

  return (
    `${d.getFullYear()}-` +
    `${pad(d.getMonth() + 1)}-` +
    `${pad(d.getDate())}`
  )
}

const thaiDate = (value) => {
  if (!value) return '-'

  const d = new Date(`${value}T12:00:00`)

  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat('th-TH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(d)
}

const stationFromCenter = (name) =>
  STATIONS[name] ||
  name?.replace(/^ศูนย์/, 'สภ.') ||
  ''

const safeName = (value) =>
  String(value || 'REPORT')
    .replace(/[^\w\u0E00-\u0E7F-]/g, '_')
    .slice(0, 70)

const fixedList = (
  items,
  count,
  maxLength = 160
) =>
  Array.from(
    { length: count },
    (_, i) =>
      typeof items?.[i] === 'string'
        ? items[i].slice(0, maxLength)
        : ''
  )

const fixedLevels = (levels, count) =>
  Array.from(
    { length: count },
    (_, i) => validLevel(levels?.[i])
  )

/* =====================================
   BLANK REPORT
===================================== */

function blankReport(
  station = '',
  centerName = ''
) {
  return {
    station,
    centerName,

    location:
      'บริเวณสถานที่สำคัญในพื้นที่รับผิดชอบ',

    reportDate: today(),

    overall: 'รอการวิเคราะห์',

    safety: 'ยังไม่ประเมิน',
    traffic: 'ยังไม่ประเมิน',
    abnormal: 'ยังไม่ประเมิน',
    visibility: 'ยังไม่ประเมิน',

    summarySeverity: Object.fromEntries(
      SUMMARY.map(x => [x.key, 'neutral'])
    ),

    findings: Array(5).fill(''),
    trafficFindings: Array(3).fill(''),
    highlights: Array(3).fill(''),

    itemSeverities: {
      findings: Array(5).fill('neutral'),
      trafficFindings: Array(3).fill('neutral'),
      highlights: Array(3).fill('neutral'),
    },

    conclusion: '',
    centerLogo: '',
  }
}

/* =====================================
   VISIBLE ITEMS AND SEVERITY SORT
===================================== */

function getVisibleReportItems(
  items,
  levels,
  max
) {
  return (items || [])
    .slice(0, max)
    .map((text, index) => ({
      text: String(text || '').trim(),
      level: validLevel(levels?.[index]),
      index,
    }))
    .filter(
      x =>
        x.text &&
        !['-', '—', '–'].includes(x.text)
    )
    .sort(
      (a, b) =>
        RANK[b.level] - RANK[a.level] ||
        a.index - b.index
    )
}

function getListIcon(level) {
  return {
    red: '✕',
    orange: '▲',
    yellow: '!',
    green: '✓',
    neutral: '•',
  }[level] || '•'
}

/* =====================================
   IMAGE UTILITIES
===================================== */

async function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(
        new Error('ไม่สามารถอ่านภาพได้')
      )
    }

    img.src = url
  })
}

const validImage = (file) =>
  [
    'image/jpeg',
    'image/png',
    'image/webp',
  ].includes(file.type) &&
  file.size <= 15 * 1024 * 1024

async function compressImage(file) {
  const image = await loadImage(file)

  const scale = Math.min(
    1,
    1600 / image.naturalWidth,
    1000 / image.naturalHeight
  )

  const canvas =
    document.createElement('canvas')

  canvas.width = Math.max(
    1,
    Math.round(
      image.naturalWidth * scale
    )
  )

  canvas.height = Math.max(
    1,
    Math.round(
      image.naturalHeight * scale
    )
  )

  canvas.getContext('2d').drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  )

  return canvas.toDataURL(
    'image/jpeg',
    0.85
  )
}

async function splitCollage(
  file,
  count
) {
  const [columns, rows] =
    GRID_OPTIONS[count]

  const image = await loadImage(file)

  const w =
    image.naturalWidth / columns

  const h =
    image.naturalHeight / rows

  const result = []

  for (let row = 0; row < rows; row++) {
    for (
      let col = 0;
      col < columns;
      col++
    ) {
      const canvas =
        document.createElement('canvas')

      canvas.width = Math.round(w)
      canvas.height = Math.round(h)

      canvas.getContext('2d').drawImage(
        image,
        col * w,
        row * h,
        w,
        h,
        0,
        0,
        canvas.width,
        canvas.height
      )

      result.push({
        name:
          `กล้อง ${result.length + 1}`,

        src: canvas.toDataURL(
          'image/jpeg',
          0.88
        ),
      })
    }
  }

  return result
}

/* =====================================
   CCTV OVERVIEW IMAGE BUILDER

   KEEP V6 IMAGE FORMAT
===================================== */

async function buildCctvOverview(
  images,
  count
) {
  const [columns, rows] =
    GRID_OPTIONS[count] || []

  if (
    !columns ||
    images.length !== count
  ) {
    throw new Error(
      'จำนวนภาพไม่ตรงกับจำนวนกล้อง'
    )
  }

  const tileW = 400
  const tileH = 245
  const headerH = 25
  const gap = 4

  const canvas =
    document.createElement('canvas')

  canvas.width = columns * tileW
  canvas.height = rows * tileH

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error(
      'เบราว์เซอร์ไม่รองรับ Canvas'
    )
  }

  ctx.fillStyle = '#071a30'
  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  )

  const decoded = await Promise.all(
    images.map(
      item =>
        new Promise((resolve, reject) => {
          const img = new Image()

          img.onload = () => resolve(img)

          img.onerror = () =>
            reject(
              new Error(
                'อ่านภาพกล้องไม่สำเร็จ'
              )
            )

          img.src = item.src
        })
    )
  )

  for (
    let i = 0;
    i < decoded.length;
    i++
  ) {
    const x =
      (i % columns) * tileW

    const y =
      Math.floor(i / columns) * tileH

    const img = decoded[i]

    const availableW =
      tileW - gap * 2

    const availableH =
      tileH - headerH - gap * 2

    const scale = Math.min(
      availableW / img.width,
      availableH / img.height
    )

    const drawW =
      Math.round(img.width * scale)

    const drawH =
      Math.round(img.height * scale)

    const drawX =
      x + Math.round(
        (tileW - drawW) / 2
      )

    const drawY =
      y +
      headerH +
      Math.round(
        (availableH - drawH) / 2
      )

    ctx.fillStyle = '#0f2439'

    ctx.fillRect(
      x + gap,
      y + gap,
      availableW,
      tileH - gap * 2
    )

    ctx.drawImage(
      img,
      drawX,
      drawY,
      drawW,
      drawH
    )

    ctx.fillStyle = '#0a2c4e'

    ctx.fillRect(
      x + gap,
      y + gap,
      availableW,
      headerH
    )

    ctx.fillStyle = '#fff'
    ctx.font = 'bold 16px sans-serif'

    ctx.fillText(
      `Camera ${i + 1}`,
      x + 13,
      y + 23
    )
  }

  let jpeg = canvas.toDataURL(
    'image/jpeg',
    0.82
  )

  for (
    const quality of [0.70, 0.58, 0.46]
  ) {
    if (jpeg.length <= 3600000) {
      break
    }

    jpeg = canvas.toDataURL(
      'image/jpeg',
      quality
    )
  }

  if (jpeg.length > 3600000) {
    throw new Error(
      'ภาพรวมใหญ่เกินไป กรุณาลดความละเอียด'
    )
  }

  return jpeg
}

/* =====================================
   AUTO FIT TEXT
===================================== */

function AutoFitText({
  children,
  minSize = 13,
  maxSize = 21,
  className = '',
}) {
  const frameRef = useRef(null)
  const contentRef = useRef(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const content = contentRef.current

    if (!frame || !content) return

    let active = true

    const fits = size => {
      content.style.fontSize = `${size}px`

      return (
        content.scrollHeight <=
          frame.clientHeight + 1 &&
        content.scrollWidth <=
          frame.clientWidth + 1
      )
    }

    const fit = () => {
      if (
        !frame.clientHeight ||
        !frame.clientWidth
      ) return

      if (fits(maxSize)) return

      if (!fits(minSize)) return

      let lo = minSize
      let hi = maxSize

      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2

        if (fits(mid)) {
          lo = mid
        } else {
          hi = mid
        }
      }

      content.style.fontSize =
        `${Math.floor(lo * 4) / 4}px`
    }

    const observer =
      new ResizeObserver(fit)

    observer.observe(frame)
    fit()

    document.fonts?.ready?.then(() => {
      if (active) fit()
    })

    return () => {
      active = false
      observer.disconnect()
    }
  }, [
    children,
    minSize,
    maxSize,
  ])

  return (
    <div
      ref={frameRef}
      className={`ai-auto-fit ${className}`}
    >
      <div
        ref={contentRef}
        className="ai-auto-fit-content"
      >
        {children}
      </div>
    </div>
  )
}

/* =====================================
   REPORT SHEET 1600 × 900
===================================== */

function ReportSheet({
  report,
  images,
  count,
}) {
  const [columns, rows] =
    GRID_OPTIONS[count]

  const overallClass = {
    'ปกติ': 'normal',
    'เฝ้าระวัง': 'watch',
    'ผิดปกติ': 'abnormal',
    'ฉุกเฉิน': 'emergency',
  }[report.overall] || 'pending'

  const renderLines = (
    key,
    max,
    numbered = false
  ) => {
    const items = getVisibleReportItems(
      report[key],
      report.itemSeverities[key],
      max
    )

    return items.map(
      (item, index) => (
        <div
          className={
            `ai-sheet-line ai-sheet-line--${item.level}`
          }
          key={`${key}-${item.index}`}
        >
          <span
            className={
              `ai-sheet-line-number ai-sheet-line-number--${item.level}`
            }
          >
            {numbered
              ? index + 1
              : getListIcon(item.level)}
          </span>

          <span
            className={
              `ai-sheet-line-text ai-sheet-line-text--${item.level}`
            }
          >
            {item.text}
          </span>
        </div>
      )
    )
  }

  return (
    <article className="ai-sheet">

      <header className="ai-sheet-header">
        <div className="ai-sheet-emblem">
          {report.centerLogo ? (
            <img
              className="ai-sheet-emblem-image"
              src={report.centerLogo}
              alt="โลโก้หน่วยงาน"
            />
          ) : (
            <ShieldCheck
              size={54}
              strokeWidth={1.5}
              className="ai-sheet-emblem-fallback"
            />
          )}

          <span className="ai-sheet-emblem-text">
            {report.centerName ||
              'ศูนย์กล้องวงจรปิด'}
          </span>
        </div>

        <div className="ai-sheet-title">
          <h1>
            รายงานผลการวิเคราะห์ภาพกล้องวงจรปิด
          </h1>

          <div className="ai-sheet-subtitle">
            {report.location} {report.station}
          </div>

          <p>
            วิเคราะห์เบื้องต้นจากภาพตรวจการณ์
            ณ วันที่ {thaiDate(report.reportDate)}
          </p>
        </div>

        <div className="ai-sheet-header-mark">
          AI CCTV
          <strong>ANALYSIS</strong>
        </div>
      </header>

      <main className="ai-sheet-main">

        <section className="ai-sheet-panel ai-sheet-cameras">
          <div className="ai-sheet-bar">
            <Camera size={26} />

            <strong>
              ภาพจากกล้องวงจรปิด ({count} มุมมอง)
            </strong>
          </div>

          <div
            className="ai-sheet-camera-grid"
            style={{
              gridTemplateColumns:
                `repeat(${columns}, minmax(0, 1fr))`,

              gridTemplateRows:
                `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {Array.from(
              { length: count },
              (_, index) => (
                <div
                  className="ai-sheet-camera"
                  key={index}
                >
                  {images[index] ? (
                    <img
                      src={images[index].src}
                      alt={`มุมมองที่ ${index + 1}`}
                    />
                  ) : (
                    <div className="ai-sheet-no-image">
                      <Camera size={24} />
                      <span>ไม่มีภาพ</span>
                    </div>
                  )}

                  <span className="ai-sheet-camera-caption">
                    มุมมองที่ {index + 1}
                  </span>
                </div>
              )
            )}
          </div>
        </section>

        <div className="ai-sheet-right">

          <section className="ai-sheet-panel">
            <div className="ai-sheet-bar">
              <span className="ai-sheet-index">
                1
              </span>

              <strong>
                สรุปผลการประเมิน
              </strong>

              <span
                className={
                  `ai-sheet-overall ${overallClass}`
                }
              >
                {report.overall}
              </span>
            </div>

            <div className="ai-sheet-status-grid">
              {SUMMARY.map(x => (
                <div
                  className={
                    `ai-sheet-status ai-sheet-status--${validLevel(report.summarySeverity[x.key])}`
                  }
                  key={x.key}
                >
                  <small>{x.label}</small>

                  <AutoFitText
                    className="ai-auto-fit--summary"
                    minSize={11}
                    maxSize={20}
                  >
                    <strong
                      data-line-cap
                      title={report[x.key]}
                    >
                      {report[x.key]}
                    </strong>
                  </AutoFitText>
                </div>
              ))}
            </div>
          </section>

          <section className="ai-sheet-panel">
            <div className="ai-sheet-bar">
              <span className="ai-sheet-index">
                2
              </span>

              <strong>
                ผลการตรวจสอบที่สำคัญ
              </strong>
            </div>

            <AutoFitText
              className="ai-auto-fit--list"
              minSize={13}
              maxSize={21}
            >
              <div className="ai-sheet-lines">
                {renderLines(
                  'findings',
                  5,
                  true
                )}
              </div>
            </AutoFitText>
          </section>

        </div>
      </main>

      <section className="ai-sheet-bottom">

        <div className="ai-sheet-panel">
          <div className="ai-sheet-bar">
            <span className="ai-sheet-index">
              3
            </span>

            <strong>
              วิเคราะห์สภาพการจราจร
            </strong>
          </div>

          <AutoFitText
            className="ai-auto-fit--list"
            minSize={13}
            maxSize={20}
          >
            <div className="ai-sheet-lines">
              {renderLines(
                'trafficFindings',
                3
              )}
            </div>
          </AutoFitText>
        </div>

        <div className="ai-sheet-panel">
          <div className="ai-sheet-bar">
            <span className="ai-sheet-index">
              4
            </span>

            <strong>
              เหตุการณ์น่าสนใจ
            </strong>
          </div>

          <AutoFitText
            className="ai-auto-fit--list"
            minSize={13}
            maxSize={20}
          >
            <div className="ai-sheet-lines">
              {renderLines(
                'highlights',
                3
              )}
            </div>
          </AutoFitText>
        </div>

        <div className="ai-sheet-panel ai-sheet-conclusion">
          <div className="ai-sheet-bar">
            <span className="ai-sheet-index">
              5
            </span>

            <strong>
              ข้อสรุปเพื่อนำเรียนผู้บังคับบัญชา
            </strong>
          </div>

          <AutoFitText
            className="ai-auto-fit--conclusion"
            minSize={12}
            maxSize={21}
          >
            <p>
              {report.conclusion?.trim() ||
                'รอการตรวจสอบและจัดทำข้อสรุปจากภาพกล้องวงจรปิด'}
            </p>
          </AutoFitText>
        </div>

      </section>

      <footer className="ai-sheet-footer">
        <span>
          หน่วยงาน : {report.station || 'ยังไม่ระบุ'}
        </span>

        <span>
          หมายเหตุ : วิเคราะห์จากภาพนิ่ง
          ณ ช่วงเวลาที่ตรวจสอบ
          ต้องผ่านการตรวจทานก่อนนำเรียน
        </span>
      </footer>

    </article>
  )
}

/* =====================================
   MAIN COMPONENT
===================================== */

function CctvAiReport({ profile }) {
  const [count, setCount] = useState(9)

  // V13 — AI Model Selection
  const [aiModel, setAiModel] = useState('gemma4')

  const [uploadMode, setUploadMode] =
    useState('collage')

  const [images, setImages] = useState([])
  const [collageFile, setCollageFile] =
    useState(null)

  const [isDragOver, setIsDragOver] =
    useState(false)

  const [report, setReport] = useState(
    () => blankReport(profile?.agency || '')
  )

  const [centers, setCenters] = useState([])

  const [centerId, setCenterId] = useState(
    profile?.center_id
      ? String(profile.center_id)
      : ''
  )

  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const [previewScale, setPreviewScale] =
    useState(0.5)

  const fileInputRef = useRef(null)
  const previewWrapperRef = useRef(null)
  const exportRef = useRef(null)

  const canChooseCenter = [
    'admin',
    'supervisor',
  ].includes(profile?.role)

  /* =================================
     LOAD CENTERS
  ================================= */

  useEffect(() => {
    let cancelled = false

    async function loadCenters() {
      const { data, error } =
        await supabase
          .from('centers')
          .select('id, name, active')
          .eq('active', true)
          .order('name')

      if (cancelled) return

      if (error) {
        setMessage(
          `โหลดรายชื่อศูนย์ไม่สำเร็จ: ${error.message}`
        )
        return
      }

      const list = data || []
      setCenters(list)

      const own = list.find(
        x =>
          String(x.id) ===
          String(profile?.center_id)
      )

      if (own) {
        setReport(old => ({
          ...old,
          station: stationFromCenter(own.name),
          centerName: own.name,
        }))
      }
    }

    loadCenters()

    return () => {
      cancelled = true
    }
  }, [profile?.center_id])

  /* =================================
     LOAD CENTER LOGO
  ================================= */

  useEffect(() => {
    let cancelled = false

    setReport(old => ({
      ...old,
      centerLogo: '',
    }))

    async function loadLogo() {
      if (!centerId) return

      try {
        const {
          data: setting,
          error,
        } = await supabase
          .from('center_report_settings')
          .select('logo_path')
          .eq('center_id', String(centerId))
          .maybeSingle()

        if (error) throw error

        if (!setting?.logo_path) return

        const {
          data: blob,
          error: downloadError,
        } = await supabase.storage
          .from('center-report-assets')
          .download(setting.logo_path)

        if (downloadError) {
          throw downloadError
        }

        const dataUrl = await new Promise(
          (resolve, reject) => {
            const reader = new FileReader()

            reader.onload = () =>
              resolve(reader.result)

            reader.onerror = () =>
              reject(
                new Error('อ่านโลโก้ไม่สำเร็จ')
              )

            reader.readAsDataURL(blob)
          }
        )

        if (!cancelled) {
          setReport(old => ({
            ...old,
            centerLogo: dataUrl,
          }))
        }

      } catch (error) {
        if (!cancelled) {
          setMessage(
            `โหลดโลโก้ศูนย์ไม่สำเร็จ: ${error.message}`
          )
        }
      }
    }

    loadLogo()

    return () => {
      cancelled = true
    }
  }, [centerId])

  /* =================================
     PREVIEW SCALE
  ================================= */

  useEffect(() => {
    const node =
      previewWrapperRef.current

    if (!node) return

    const update = () =>
      setPreviewScale(
        Math.min(
          1,
          (node.clientWidth || 800) / 1600
        )
      )

    const observer =
      new ResizeObserver(update)

    observer.observe(node)
    update()

    return () => observer.disconnect()
  }, [])

  /* =================================
     REPORT EDITING
  ================================= */

  const update = (field, value) =>
    setReport(old => ({
      ...old,
      [field]: value,
    }))

  const updateSummaryLevel = (
    key,
    value
  ) =>
    setReport(old => ({
      ...old,
      summarySeverity: {
        ...old.summarySeverity,
        [key]: validLevel(value),
      },
    }))

  const updateList = (
    key,
    index,
    value
  ) =>
    setReport(old => ({
      ...old,
      [key]: old[key].map(
        (v, i) =>
          i === index ? value : v
      ),
    }))

  const updateItemLevel = (
    key,
    index,
    value
  ) =>
    setReport(old => ({
      ...old,

      itemSeverities: {
        ...old.itemSeverities,

        [key]: old.itemSeverities[key].map(
          (v, i) =>
            i === index
              ? validLevel(value)
              : v
        ),
      },
    }))

  const resetAnalysis = () =>
    setReport(old => ({
      ...blankReport(
        old.station,
        old.centerName
      ),

      centerLogo: old.centerLogo,
      location: old.location,
      reportDate: old.reportDate,
    }))

  const selectCenter = id => {
    setCenterId(id)

    const center = centers.find(
      x => String(x.id) === String(id)
    )

    setReport(old => ({
      ...old,

      station: center
        ? stationFromCenter(center.name)
        : '',

      centerName:
        center?.name || '',

      centerLogo: '',
    }))
  }

  /* =================================
     UPLOAD
  ================================= */

  const changeCount = async value => {
    const next = Number(value)

    setCount(next)
    resetAnalysis()
    setMessage('')

    if (
      uploadMode === 'collage' &&
      collageFile
    ) {
      setBusy('upload')

      try {
        setImages(
          await splitCollage(
            collageFile,
            next
          )
        )
      } catch (error) {
        setImages([])
        setMessage(error.message)
      } finally {
        setBusy('')
      }
    } else {
      setImages(
        old => old.slice(0, next)
      )
    }
  }

  const changeMode = mode => {
    setUploadMode(mode)
    setImages([])
    setCollageFile(null)
    resetAnalysis()
    setMessage('')
  }

  const processFiles = async incoming => {
    if (busy) return

    const files = Array.from(
      incoming || []
    )

    if (!files.length) return

    if (
      (
        uploadMode === 'collage' &&
        files.length !== 1
      ) ||
      files.length > count
    ) {
      setMessage(
        uploadMode === 'collage'
          ? 'โหมดภาพรวมรองรับครั้งละ 1 ภาพ'
          : `เลือกภาพได้ไม่เกิน ${count} ภาพ`
      )
      return
    }

    if (!files.every(validImage)) {
      setMessage(
        'รองรับ JPG, PNG, WEBP ขนาดไม่เกิน 15 MB ต่อภาพ'
      )
      return
    }

    setBusy('upload')
    setMessage('')

    try {
      if (uploadMode === 'collage') {
        const result = await splitCollage(
          files[0],
          count
        )

        setCollageFile(files[0])
        setImages(result)

      } else {
        const result = []

        for (const file of files) {
          result.push({
            name: file.name,
            src: await compressImage(file),
          })
        }

        setImages(result)
        setCollageFile(null)
      }

      resetAnalysis()

      setMessage(
        'นำเข้าภาพสำเร็จ พร้อมตรวจสอบและวิเคราะห์'
      )

    } catch (error) {
      setImages([])

      setMessage(
        error?.message ||
        'ไม่สามารถนำเข้าภาพได้'
      )
    } finally {
      setBusy('')
    }
  }

  const handleFiles = async event => {
    const files = Array.from(
      event.target.files || []
    )

    event.target.value = ''

    await processFiles(files)
  }

  /* =================================
     CTRL + V
  ================================= */

  useEffect(() => {
    const onPaste = event => {
      if (
        busy ||
        event.target?.closest?.(
          'input, textarea, select, [contenteditable], [role="textbox"]'
        )
      ) return

      const files = Array.from(
        event.clipboardData?.items || []
      )
        .filter(
          item =>
            item.kind === 'file' &&
            item.type.startsWith('image/')
        )
        .map(item => item.getAsFile())
        .filter(Boolean)

      if (files.length) {
        event.preventDefault()

        void processFiles(files)
      }
    }

    window.addEventListener(
      'paste',
      onPaste
    )

    return () =>
      window.removeEventListener(
        'paste',
        onPaste
      )
  })

  /* =================================
     AI ANALYSIS V13
  ================================= */

  const handleAnalyze = async () => {
    if (images.length !== count) {
      setMessage(
        `กรุณาอัปโหลดให้ครบ ${count} มุมมอง`
      )
      return
    }

    setBusy('ai')
    setMessage(
      'กำลังส่งภาพให้ AI วิเคราะห์...'
    )

    const controller =
      new AbortController()

    const timer = setTimeout(
      () => controller.abort(),
      240000
    )

    try {
      const { data, error } =
        await supabase.auth.getSession()

      if (error) throw error

      const token =
        data.session?.access_token

      if (!token) {
        throw new Error(
          'กรุณาเข้าสู่ระบบใหม่'
        )
      }

      const collage =
        await buildCctvOverview(
          images,
          count
        )

      const response = await fetch(
        AI_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${token}`,
          },

          body: JSON.stringify({
            model: aiModel,
            count,
            station: report.station,
            location: report.location,
            reportDate: report.reportDate,
            collage,
          }),

          signal: controller.signal,
        }
      )

      const payload =
        await response.json()

      if (!response.ok) {
        throw new Error(
          payload?.error ||
          'AI วิเคราะห์ไม่สำเร็จ'
        )
      }

      const result = payload?.report

      if (
        !result ||
        typeof result !== 'object' ||
        !result.summarySeverity ||
        !result.itemSeverities
      ) {
        throw new Error(
          'โปรดอัปเดต Cloudflare Worker เป็น V13 ก่อนใช้งาน'
        )
      }

      const overallAllowed = [
        'ปกติ',
        'เฝ้าระวัง',
        'ผิดปกติ',
        'ฉุกเฉิน',
        'ไม่สามารถประเมินได้',
      ]

      setReport(old => ({
        ...old,

        overall:
          overallAllowed.includes(
            result.overall
          )
            ? result.overall
            : 'ไม่สามารถประเมินได้',

        safety:
          String(result.safety || '')
            .slice(0, 200),

        traffic:
          String(result.traffic || '')
            .slice(0, 200),

        abnormal:
          String(result.abnormal || '')
            .slice(0, 200),

        visibility:
          String(result.visibility || '')
            .slice(0, 200),

        summarySeverity:
          Object.fromEntries(
            SUMMARY.map(x => [
              x.key,
              validLevel(
                result.summarySeverity[x.key]
              ),
            ])
          ),

        findings:
          fixedList(
            result.findings,
            5,
            145
          ),

        trafficFindings:
          fixedList(
            result.trafficFindings,
            3,
            130
          ),

        highlights:
          fixedList(
            result.highlights,
            3,
            130
          ),

        itemSeverities: {
          findings:
            fixedLevels(
              result.itemSeverities.findings,
              5
            ),

          trafficFindings:
            fixedLevels(
              result.itemSeverities.trafficFindings,
              3
            ),

          highlights:
            fixedLevels(
              result.itemSeverities.highlights,
              3
            ),
        },

        conclusion:
          String(result.conclusion || '')
            .slice(0, 400),
      }))

      setMessage(
        `AI วิเคราะห์เสร็จแล้ว กรุณาตรวจทานก่อนส่งออก${
          typeof payload.usage?.neurons === 'number'
            ? ` (ใช้ ${payload.usage.neurons.toFixed(2)} Neurons)`
            : ''
        }`
      )

    } catch (error) {
      setMessage(
        error?.name === 'AbortError'
          ? 'หมดเวลารอ AI กรุณาลองใหม่'
          : error.message
      )
    } finally {
      clearTimeout(timer)
      setBusy('')
    }
  }

  /* =================================
     EXPORT
  ================================= */

  const download = (url, filename) => {
    const a =
      document.createElement('a')

    a.href = url
    a.download = filename

    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const handleExport = async format => {
    if (!exportRef.current) return

    setBusy('export')
    setMessage(
      'กำลังสร้างไฟล์รายงาน...'
    )

    try {
      await document.fonts.ready

      const options = {
        backgroundColor: '#fff',
        pixelRatio: 1,
        cacheBust: false,
      }

      const base =
        `AI_CCTV_${safeName(report.station)}_${report.reportDate}`

      if (format === 'png') {
        download(
          await toPng(
            exportRef.current,
            options
          ),
          `${base}.png`
        )
      }

      if (format === 'jpg') {
        download(
          await toJpeg(
            exportRef.current,
            {
              ...options,
              quality: 0.94,
            }
          ),
          `${base}.jpg`
        )
      }

      if (format === 'pdf') {
        const url = await toJpeg(
          exportRef.current,
          {
            ...options,
            quality: 0.94,
          }
        )

        const pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: [160, 90],
          compress: true,
        })

        pdf.addImage(
          url,
          'JPEG',
          0,
          0,
          160,
          90
        )

        pdf.save(
          `${base}.pdf`
        )
      }

      setMessage(
        'สร้างไฟล์รายงานสำเร็จ'
      )

    } catch (error) {
      console.error(error)

      setMessage(
        'ไม่สามารถส่งออกไฟล์ได้'
      )
    } finally {
      setBusy('')
    }
  }

  /* =================================
     COPY REPORT IMAGE
  ================================= */

  const handleCopyImage = async () => {
    if (
      !exportRef.current ||
      busy
    ) return

    if (
      !window.isSecureContext ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === 'undefined'
    ) {
      setMessage(
        'เบราว์เซอร์ไม่รองรับการคัดลอกรูปภาพ กรุณาใช้ HTTPS'
      )
      return
    }

    setBusy('copy-image')
    setMessage(
      'กำลังคัดลอกรูปรายงาน...'
    )

    try {
      const imagePromise = (
        async () => {
          await document.fonts.ready

          const url = await toPng(
            exportRef.current,
            {
              backgroundColor: '#fff',
              pixelRatio: 1,
              cacheBust: false,
            }
          )

          return (
            await fetch(url)
          ).blob()
        }
      )()

      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': imagePromise,
        }),
      ])

      setMessage(
        'คัดลอกรูปรายงานสำเร็จ! กด Ctrl + V เพื่อวางภาพได้เลย'
      )

    } catch (error) {
      console.error(error)

      setMessage(
        'คัดลอกรูปภาพไม่สำเร็จ กรุณาใช้ปุ่ม JPG'
      )
    } finally {
      setBusy('')
    }
  }

  /* =================================
     COPY REPORT TEXT
  ================================= */

  const handleCopy = async () => {
    const lines = [
      'รายงานผลการวิเคราะห์ภาพกล้องวงจรปิด',

      `หน่วยงาน: ${report.station}`,
      `พื้นที่: ${report.location}`,
      `วันที่: ${thaiDate(report.reportDate)}`,
      `จำนวนกล้อง: ${count} มุมมอง`,

      `ผลประเมินโดยรวม: ${report.overall}`,

      '',

      ...SUMMARY.map(
        x =>
          `${x.label} (${LEVEL_NAMES[validLevel(report.summarySeverity[x.key])]}): ${report[x.key]}`
      ),

      '',

      ...LIST_FIELDS.flatMap(x => [
        x.title,

        ...getVisibleReportItems(
          report[x.key],
          report.itemSeverities[x.key],
          x.max
        ).map(
          (item, i) =>
            `${i + 1}. [${LEVEL_NAMES[item.level]}] ${item.text}`
        ),

        '',
      ]),

      '5. ข้อสรุปเพื่อนำเรียนผู้บังคับบัญชา',

      report.conclusion,
    ]

    try {
      await navigator.clipboard.writeText(
        lines.join('\n')
      )

      setMessage(
        'คัดลอกข้อความรายงานแล้ว'
      )
    } catch {
      setMessage(
        'คัดลอกข้อความไม่สำเร็จ'
      )
    }
  }

  /* =================================
     EDITOR COMPONENTS
  ================================= */

  const severitySelect = (
    value,
    onChange
  ) => (
    <select
      value={validLevel(value)}
      onChange={e =>
        onChange(e.target.value)
      }
      aria-label="เลือกระดับความผิดปกติ"
    >
      {LEVELS.map(level => (
        <option
          key={level}
          value={level}
        >
          {LEVEL_NAMES[level]}
        </option>
      ))}
    </select>
  )

  const field = (
    label,
    key,
    multiline = false
  ) => (
    <label
      className="ai-field"
      key={key}
    >
      <span>{label}</span>

      {multiline ? (
        <textarea
          rows={4}
          value={report[key]}
          onChange={e =>
            update(
              key,
              e.target.value
            )
          }
        />
      ) : (
        <input
          type="text"
          value={report[key]}
          onChange={e =>
            update(
              key,
              e.target.value
            )
          }
        />
      )}
    </label>
  )

  const listEditor = ({
    key,
    title,
  }) => (
    <div
      className="ai-editor-group"
      key={key}
    >
      <h4>{title}</h4>

      {report[key].map(
        (value, index) => (
          <div
            key={index}
            style={{
              marginBottom: 10,
            }}
          >
            <label className="ai-field">
              <span>
                ข้อที่ {index + 1}
              </span>

              <textarea
                rows={2}
                value={value}
                onChange={e =>
                  updateList(
                    key,
                    index,
                    e.target.value
                  )
                }
              />
            </label>

            <label className="ai-field">
              <span>
                ระดับความผิดปกติของข้อที่ {index + 1}
              </span>

              {severitySelect(
                report.itemSeverities[key][index],

                value =>
                  updateItemLevel(
                    key,
                    index,
                    value
                  )
              )}
            </label>
          </div>
        )
      )}
    </div>
  )

  /* =====================================
     RENDER
  ===================================== */

  return (
    <div className="ai-cctv-page">

      <header className="ai-page-header">
        <div>
          <div className="ai-page-eyebrow">
            AI CCTV ANALYSIS V13
          </div>

          <h1>
            วิเคราะห์สถานการณ์จากภาพกล้องวงจรปิด
          </h1>

          <p>
            อัปโหลดภาพ วิเคราะห์สถานการณ์
            ตรวจทานข้อความและระดับสี
            ก่อนนำเรียนผู้บังคับบัญชา
          </p>
        </div>

        <div className="ai-page-header-icon">
          <BrainCircuit size={34} />
        </div>
      </header>

      <section className="ai-upload-panel">

        <div className="ai-section-title">
          <Images size={21} />

          <h2>
            ข้อมูลและภาพประกอบรายงาน
          </h2>
        </div>

        <div className="ai-form-grid">

          <label className="ai-field">
            <span>โมเดล AI สำหรับวิเคราะห์ภาพ</span>

            <select
              value={aiModel}
              disabled={!!busy}
              onChange={e => {
                setAiModel(e.target.value)
                setMessage('')
              }}
            >
              <option value="gemma4">
                Google Gemma 4 26B (ค่าเริ่มต้น)
              </option>

              <option value="qwen38">
                Qwen 3.8 27B
              </option>

              <option value="llama4">
                Meta Llama 4 Scout
              </option>
            </select>
          </label>

          <label className="ai-field">
            <span>จำนวนกล้อง</span>

            <select
              value={count}
              disabled={!!busy}
              onChange={e =>
                changeCount(
                  e.target.value
                )
              }
            >
              {Object.keys(
                GRID_OPTIONS
              ).map(n => (
                <option
                  value={n}
                  key={n}
                >
                  {n} กล้อง
                </option>
              ))}
            </select>
          </label>

          <label className="ai-field">
            <span>
              ศูนย์ที่จัดทำรายงาน
            </span>

            {canChooseCenter ? (
              <select
                value={centerId}
                onChange={e =>
                  selectCenter(
                    e.target.value
                  )
                }
              >
                <option value="">
                  -- เลือกศูนย์ --
                </option>

                {centers.map(c => (
                  <option
                    key={c.id}
                    value={String(c.id)}
                  >
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="ai-readonly">
                <Building2 size={17} />

                {centers.find(
                  c =>
                    String(c.id) ===
                    String(centerId)
                )?.name ||
                  profile?.agency ||
                  '-'}
              </div>
            )}
          </label>

          <label className="ai-field">
            <span>
              วันที่ตรวจสอบ
            </span>

            <input
              type="date"
              value={report.reportDate}
              onChange={e =>
                update(
                  'reportDate',
                  e.target.value
                )
              }
            />
          </label>

          {field(
            'สถานีตำรวจ / หน่วยงาน',
            'station'
          )}

          {field(
            'บริเวณพื้นที่ตรวจสอบ',
            'location'
          )}

        </div>

        <div className="ai-upload-mode">

          <button
            type="button"
            disabled={!!busy}
            className={
              uploadMode === 'collage'
                ? 'active'
                : ''
            }
            onClick={() =>
              changeMode('collage')
            }
          >
            <FileImage size={17} />
            ภาพรวมหลายกล้อง
          </button>

          <button
            type="button"
            disabled={!!busy}
            className={
              uploadMode === 'separate'
                ? 'active'
                : ''
            }
            onClick={() =>
              changeMode('separate')
            }
          >
            <Images size={17} />
            ภาพแยกทีละกล้อง
          </button>

        </div>

        {/* UPLOAD ZONE */}

        <div
          className={[
            'ai-upload-zone',

            isDragOver
              ? 'ai-upload-zone--dragging'
              : '',

            busy
              ? 'ai-upload-zone--disabled'
              : '',
          ].join(' ')}

          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={!!busy}

          onClick={() => {
            if (!busy) {
              fileInputRef.current?.click()
            }
          }}

          onKeyDown={e => {
            if (
              !busy &&
              ['Enter', ' '].includes(e.key)
            ) {
              e.preventDefault()

              fileInputRef.current?.click()
            }
          }}

          onDragEnter={e => {
            e.preventDefault()

            if (!busy) {
              setIsDragOver(true)
            }
          }}

          onDragOver={e => {
            e.preventDefault()

            e.dataTransfer.dropEffect =
              busy ? 'none' : 'copy'

            if (!busy) {
              setIsDragOver(true)
            }
          }}

          onDragLeave={e => {
            if (
              !e.currentTarget.contains(
                e.relatedTarget
              )
            ) {
              setIsDragOver(false)
            }
          }}

          onDrop={e => {
            e.preventDefault()
            setIsDragOver(false)

            if (!busy) {
              void processFiles(
                e.dataTransfer.files
              )
            }
          }}
        >

          <div className="ai-upload-zone-icon">
            <Upload
              size={32}
              strokeWidth={1.8}
            />
          </div>

          <strong>
            {isDragOver
              ? 'ปล่อยภาพเพื่ออัปโหลด'
              : uploadMode === 'collage'
                ? 'อัปโหลด Screenshot ภาพรวม'
                : `อัปโหลดภาพจากกล้องสูงสุด ${count} ภาพ`}
          </strong>

          <span className="ai-upload-zone-description">
            ลากภาพมาวางที่นี่ หรือกด Ctrl + V
            เพื่อวางภาพจากคลิปบอร์ด
          </span>

          <span className="ai-upload-select-btn">
            <FileImage size={18} />
            เลือกไฟล์จากเครื่อง
          </span>

          <span className="ai-upload-zone-formats">
            รองรับ JPG, PNG, WEBP
            ไม่เกิน 15 MB ต่อภาพ
          </span>
        </div>

        <input
          ref={fileInputRef}
          className="ai-upload-native-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={
            uploadMode === 'separate'
          }
          disabled={!!busy}
          onChange={handleFiles}
          tabIndex={-1}
        />

        <div className="ai-upload-status">
          <span>
            <CheckCircle2 size={16} />

            โหลดภาพแล้ว {images.length} / {count} มุมมอง
          </span>

          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              setImages([])
              setCollageFile(null)
              resetAnalysis()
              setMessage('')
            }}
          >
            <RefreshCw size={15} />
            ล้างภาพ
          </button>
        </div>

        <div
          className="ai-upload-thumbnails"
          style={{
            gridTemplateColumns:
              `repeat(${Math.min(count, 4)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from(
            { length: count },
            (_, index) => (
              <div
                className="ai-upload-thumbnail"
                key={index}
              >
                {images[index] ? (
                  <img
                    src={images[index].src}
                    alt={`กล้อง ${index + 1}`}
                  />
                ) : (
                  <Camera size={23} />
                )}

                <span>
                  กล้อง {index + 1}
                </span>
              </div>
            )
          )}
        </div>

        <button
          className="ai-analyze-button"
          type="button"
          disabled={
            !!busy ||
            images.length !== count
          }
          onClick={handleAnalyze}
        >
          {busy === 'ai' ? (
            <Loader2
              size={20}
              className="ai-spin"
            />
          ) : (
            <BrainCircuit size={20} />
          )}

          {busy === 'ai'
            ? 'AI กำลังวิเคราะห์ภาพ...'
            : 'เริ่มวิเคราะห์ภาพด้วย AI'}
        </button>

        {message && (
          <div
            className="ai-message"
            role="status"
          >
            {message}
          </div>
        )}
      </section>

      {/* EDIT + PREVIEW */}

      <div className="ai-workspace">

        <aside className="ai-editor-panel">

          <div className="ai-section-title">
            <FileText size={21} />
            <h2>แก้ไขผลการวิเคราะห์</h2>
          </div>

          <div className="ai-editor-group">
            <h4>
              1. สรุปผลการประเมิน
            </h4>

            <label className="ai-field">
              <span>
                ผลประเมินโดยรวม
              </span>

              <select
                value={report.overall}
                onChange={e =>
                  update(
                    'overall',
                    e.target.value
                  )
                }
              >
                {[
                  'รอการวิเคราะห์',
                  'ปกติ',
                  'เฝ้าระวัง',
                  'ผิดปกติ',
                  'ฉุกเฉิน',
                  'ไม่สามารถประเมินได้',
                ].map(v => (
                  <option key={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            {SUMMARY.map(x => (
              <div key={x.key}>
                {field(
                  x.label,
                  x.key
                )}

                <label className="ai-field">
                  <span>
                    ระดับความผิดปกติ — {x.label}
                  </span>

                  {severitySelect(
                    report.summarySeverity[x.key],

                    value =>
                      updateSummaryLevel(
                        x.key,
                        value
                      )
                  )}
                </label>
              </div>
            ))}
          </div>

          {LIST_FIELDS.map(listEditor)}

          <div className="ai-editor-group">
            <h4>
              5. ข้อสรุปนำเรียนผู้บังคับบัญชา
            </h4>

            {field(
              'ข้อความสรุป',
              'conclusion',
              true
            )}
          </div>

        </aside>

        <section className="ai-preview-panel">

          <div className="ai-preview-toolbar">
            <div>
              <h2>
                พรีวิวรายงาน
              </h2>

              <p>
                ขนาด 1600 × 900 พิกเซล (16:9)
              </p>
            </div>

            <span className="ai-preview-scale">
              {Math.round(
                previewScale * 100
              )}%
            </span>
          </div>

          <div
            className="ai-preview-wrapper"
            ref={previewWrapperRef}
          >
            <div
              style={{
                width: 1600,
                height:
                  900 * previewScale,
              }}
            >
              <div
                style={{
                  width: 1600,
                  height: 900,

                  transform:
                    `scale(${previewScale})`,

                  transformOrigin:
                    'top left',
                }}
              >
                <ReportSheet
                  report={report}
                  images={images}
                  count={count}
                />
              </div>
            </div>
          </div>

          <div className="ai-export-actions">

            <button
              type="button"
              disabled={!!busy}
              onClick={handleCopyImage}
            >
              <Copy size={17} />
              คัดลอกรูป
            </button>

            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                handleExport('png')
              }
            >
              <Download size={17} />
              PNG
            </button>

            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                handleExport('jpg')
              }
            >
              <Download size={17} />
              JPG
            </button>

            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                handleExport('pdf')
              }
            >
              <FileText size={17} />
              PDF
            </button>

            <button
              type="button"
              disabled={!!busy}
              onClick={handleCopy}
            >
              <Copy size={17} />
              คัดลอกข้อความ
            </button>

          </div>

          <div className="ai-report-note">
            กรุณาตรวจสอบความถูกต้อง
            ของผลวิเคราะห์ ระดับสี
            และภาพประกอบทุกมุมมอง
            ก่อนนำเรียนผู้บังคับบัญชา
          </div>

        </section>
      </div>

      {/* FULL-SIZE EXPORT TARGET */}

      <div
        className="ai-export-render"
        aria-hidden="true"
      >
        <div ref={exportRef}>
          <ReportSheet
            report={report}
            images={images}
            count={count}
          />
        </div>
      </div>

    </div>
  )
}

export default CctvAiReport