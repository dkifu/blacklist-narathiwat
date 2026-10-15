
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import JSZip from 'jszip'

import { Archive } from 'libarchive.js'


import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import html2canvas from 'html2canvas'
import { supabase } from '../../lib/supabase'
import './Section09Editor.css'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker


Archive.init({
  workerUrl: `${import.meta.env.BASE_URL}libarchive/worker-bundle.js`,
})


const BUCKET = 'monthly-section09-assets'

const SLOTS = ['doc1', 'doc2', 'cctv1', 'cctv2']

const MONTHS = [
  '',
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

const pad = x => String(x).padStart(2, '0')

const numberOf = (y, m) =>
  Number(y) * 12 + Number(m)

const sortThai = (a, b) =>
  a.localeCompare(b, 'th', { numeric: true })

// ========================================
// IMAGE COMPRESSION
// ========================================

function toBlob(canvas, quality = 0.84) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob =>
        blob
          ? resolve(blob)
          : reject(new Error('แปลงภาพไม่สำเร็จ')),
      'image/webp',
      quality
    )
  })
}

async function optimizePhoto(file) {
  const bitmap = await createImageBitmap(file)

  try {
    const ratio = Math.min(
      1,
      1400 / bitmap.width,
      1100 / bitmap.height
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

    const ctx = canvas.getContext('2d', {
      alpha: false,
    })

    ctx.fillStyle = '#fff'
    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    )

    ctx.drawImage(
      bitmap,
      0,
      0,
      canvas.width,
      canvas.height
    )

    const blob = await toBlob(canvas)

    canvas.width = canvas.height = 0

    return blob
  } finally {
    bitmap.close()
  }
}

// ========================================
// PDF -> OPTIMIZED IMAGES
// ========================================

async function pdfToImages(pdfBytes) {
  const task = pdfjs.getDocument({
    data: pdfBytes,
  })

  const pdf = await task.promise

  try {
    if (
      pdf.numPages < 1 ||
      pdf.numPages > 2
    ) {
      throw new Error(
        `ใบคำร้องต้องมี PDF 1–2 หน้า (พบ ${pdf.numPages} หน้า)`
      )
    }

    const images = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)

      const base = page.getViewport({
        scale: 1,
      })

      const viewport = page.getViewport({
        scale: Math.min(
          2.8,
          2200 / base.height
        ),
      })

      const canvas = document.createElement('canvas')

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)

      const ctx = canvas.getContext('2d', {
        alpha: false,
      })

      ctx.fillStyle = '#fff'
      ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
      )

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise

      images.push(
        await toBlob(canvas, 0.88)
      )

      canvas.width = canvas.height = 0

      page.cleanup()
    }

    return images
    } finally {
        await task.destroy()
    }
}

// ========================================
// READ ZIP AND GROUP CASES
// ========================================


async function readCaseArchive(file) {
  const MAX_ARCHIVE_SIZE = 250 * 1024 * 1024
  const MAX_ENTRIES = 500
  const MAX_EXTRACTED_SIZE = 400 * 1024 * 1024

  if (file.size > MAX_ARCHIVE_SIZE) {
    throw new Error('ไฟล์บีบอัดต้องไม่เกิน 250 MB')
  }

  const extension = file.name
    .split('.')
    .pop()
    .toLowerCase()

  if (!['zip', 'rar', '7z'].includes(extension)) {
    throw new Error('รองรับเฉพาะ ZIP, RAR และ 7Z')
  }

  const entries = []
  let knownSize = 0

  const addEntry = (path, getBlob, size = 0) => {
    const cleanPath = path
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')

    const parts = cleanPath.split('/')

    if (
      parts.length < 2 ||
      parts.some(part =>
        !part ||
        part.startsWith('.') ||
        part === '__MACOSX'
      ) ||
      !/\.(pdf|png|jpe?g|webp)$/i.test(cleanPath)
    ) {
      return
    }

    if (entries.length >= MAX_ENTRIES) {
      throw new Error('ไฟล์ภายในมากเกิน 500 รายการ')
    }

    knownSize += size

    if (knownSize > MAX_EXTRACTED_SIZE) {
      throw new Error(
        'ขนาดไฟล์ที่แตกแล้วเกิน 400 MB'
      )
    }

    entries.push({
      path: cleanPath,
      fileName: parts[parts.length - 1],
      getBlob,
    })
  }

  if (extension === 'zip') {
    // ใช้ JSZip เดิมสำหรับไฟล์ ZIP
    const zip = await JSZip.loadAsync(file)

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue

      addEntry(
        entry.name,
        () => entry.async('blob'),
        entry._data?.uncompressedSize || 0
      )
    }
  } else {
    // RAR / 7Z ใช้ Libarchive WebAssembly
    const archive = await Archive.open(file)

    if (await archive.hasEncryptedData() === true) {
      throw new Error(
        'ไฟล์ RAR/7Z ที่ใส่รหัสผ่านยังไม่รองรับ'
      )
    }

    const tree = await archive.extractFiles()

    // Libarchive คืนค่าเป็น File Tree
    const walk = (node, parent = '') => {
      for (const [name, value] of Object.entries(node)) {
        const path = parent
          ? `${parent}/${name}`
          : name

        if (value instanceof Blob) {
          addEntry(
            path,
            async () => value,
            value.size
          )
        } else if (
          value &&
          typeof value === 'object'
        ) {
          walk(value, path)
        }
      }
    }

    walk(tree)
  }

  const groups = new Map()

  for (const entry of entries) {
    const folder = entry.path
      .split('/')
      .slice(0, -1)
      .join('/')

    if (!groups.has(folder)) {
      groups.set(folder, [])
    }

    groups.get(folder).push(entry)
  }

  if (
    groups.size === 0 ||
    groups.size > 100
  ) {
    throw new Error(
      'ไม่พบโฟลเดอร์เคส หรือมีเกิน 100 เคส'
    )
  }

  const result = []

  for (const [folder, files] of
    [...groups].sort((a, b) =>
      sortThai(a[0], b[0])
    )
  ) {
    const pdfs = files.filter(
      entry => /\.pdf$/i.test(entry.fileName)
    )

    const photos = files
      .filter(entry =>
        /\.(png|jpe?g|webp)$/i.test(entry.fileName)
      )
      .sort((a, b) =>
        sortThai(a.fileName, b.fileName)
      )

    // ไฟล์ขาดได้ แต่ไฟล์เกินต้องแจ้ง
    // เพื่อไม่ให้เลือกผิดหรือทิ้งภาพโดยไม่รู้ตัว
    if (pdfs.length > 1) {
      throw new Error(
        `เคส ${folder} พบ PDF มากกว่า 1 ไฟล์`
      )
    }

    if (photos.length > 2) {
      throw new Error(
        `เคส ${folder} พบภาพมากกว่า 2 ไฟล์`
      )
    }

    const pdf = pdfs[0] || null

    // ไม่มี PDF ให้ใช้ชื่อโฟลเดอร์เป็นชื่อเคส
    const title = pdf
      ? pdf.fileName.replace(/\.pdf$/i, '')
      : folder.split('/').pop()

    result.push({
      folder,
      title,
      pdf,
      photos,
    })
  }

  return result
}

// ตรวจไฟล์ที่ยังขาด โดยอิง Path จริง
function getMissingSlots(item) {
  const paths = item?.paths || {}
  const missing = []

  if (!paths.doc1) {
    missing.push('PDF')
  }

  if (!paths.cctv1) {
    missing.push('ภาพ CCTV 1')
  }

  if (!paths.cctv2) {
    missing.push('ภาพ CCTV 2')
  }

  return missing
}


// ========================================
// REPORT PAGE TEMPLATE
// ========================================

function CasePaper({
  item,
  images,
  center,
  month,
  year,
}) {
  return (
    <div className="s09-paper">
      <div className="s09-paper-top">
        <strong>
          ใบคำร้องขอดูภาพและภาพประกอบ
        </strong>

        <span>
          ประจำเดือน {MONTHS[Number(month)]} {year}
          {' • '}
          {center?.name || 'ศูนย์กล้องวงจรปิด'}
        </span>
      </div>

      <div className="s09-paper-title">
        {item?.title || 'ไม่มีชื่อเหตุการณ์'}
      </div>

      <div className="s09-paper-columns">
        <div
          className={`s09-docs ${
            images?.doc2 ? '' : 'one-doc'
          }`}
        >
          {['doc1', 'doc2']
            .filter(
              slot =>
                slot === 'doc1' ||
                images?.doc2
            )
            .map(slot => (
              <div className="s09-doc" key={slot}>
                {images?.[slot] ? (
                  <img
                    src={images[slot]}
                    alt="ใบคำร้อง"
                  />
                ) : (
                  <span>ไม่มีภาพเอกสาร</span>
                )}
              </div>
            ))}
        </div>

        <div className="s09-cctvs">
          {['cctv1', 'cctv2'].map(slot => (
            <div className="s09-cctv" key={slot}>
              {images?.[slot] ? (
                <img
                  src={images[slot]}
                  alt="ภาพจากกล้อง CCTV"
                />
              ) : (
                <span>ไม่มีภาพ CCTV</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ========================================
// MAIN EDITOR
// ========================================

const Section09Editor = forwardRef(
  function Section09Editor({
    report,
    center,
    month,
    year,
    canEdit = false,
    onDataChange,
  }, ref) {

    const centerId = Number(center?.id)

    const [cases, setCases] = useState([])
    const [selectedId, setSelectedId] = useState(null)
    const [openedId, setOpenedId] = useState(null)
    const [preview, setPreview] = useState({})
    const [exportItem, setExportItem] = useState(null)

    const [ready, setReady] = useState(false)
    const [busy, setBusy] = useState(false)

    const [message, setMessage] = useState('')
    const [progress, setProgress] = useState('')

    const [scale, setScale] = useState(1)

    const savedAtRef = useRef(null)
    const exportPageRef = useRef(null)
    const previewWrapRef = useRef(null)
    const zipInputRef = useRef(null)

    const selected =
      cases.find(c => c.id === selectedId) ||
      cases[0]

    // ====================================
    // SUPABASE STORAGE
    // ====================================

    async function imageData(path) {
      if (!path) return ''

      const { data, error } = await supabase
        .storage
        .from(BUCKET)
        .download(path)

      if (error) throw error

      return new Promise((resolve, reject) => {
        const reader = new FileReader()

        reader.onload = () =>
          resolve(reader.result)

        reader.onerror = () =>
          reject(
            new Error('อ่านข้อมูลภาพไม่สำเร็จ')
          )

        reader.readAsDataURL(data)
      })
    }

    async function loadImages(paths) {
      const entries = await Promise.all(
        SLOTS.map(async slot => [
          slot,
          await imageData(paths?.[slot]),
        ])
      )

      return Object.fromEntries(entries)
    }

    async function deletePaths(paths) {
      const clean = [
        ...new Set(paths.filter(Boolean)),
      ]

      for (
        let i = 0;
        i < clean.length;
        i += 100
      ) {
        const { error } = await supabase
          .storage
          .from(BUCKET)
          .remove(clean.slice(i, i + 100))

        if (error) throw error
      }
    }

    async function upload(blob, prefix, slot) {
      const extension =
        blob.type === 'image/webp'
          ? 'webp'
          : 'png'

      const path =
        `${prefix}/${slot}.${extension}`

      const { error } = await supabase
        .storage
        .from(BUCKET)
        .upload(path, blob, {
          contentType: blob.type,
          cacheControl: '3600',
          upsert: false,
        })

      if (error) throw error

      return path
    }

    // ====================================
    // LOAD SAVED CASES
    // ====================================

    useEffect(() => {
      let active = true

      setReady(false)
      setCases([])
      setPreview({})
      setSelectedId(null)
      setOpenedId(null)

      savedAtRef.current = null

      if (!report?.id || !centerId) {
        setReady(true)

        return () => {
          active = false
        }
      }

      ;(async () => {
        const { data, error } = await supabase
          .from('monthly_report_section09_months')
          .select('cases, updated_at')
          .eq('center_id', centerId)
          .eq('report_year', Number(year))
          .eq('report_month', Number(month))
          .maybeSingle()

        if (!active) return

        if (error) {
          setMessage(error.message)
        } else {
          const items = data?.cases || []

          savedAtRef.current =
            data?.updated_at || null

          setCases(items)

          setSelectedId(
            items[0]?.id || null
          )
        }

        setReady(true)
      })()

      return () => {
        active = false
      }
    }, [report?.id, centerId, month, year])

    // ====================================
    // LOAD CURRENT PREVIEW IMAGES
    // ====================================

    useEffect(() => {
      let active = true

      setPreview({})

      if (selected?.paths) {
        loadImages(selected.paths)
          .then(urls => {
            if (active) setPreview(urls)
          })
          .catch(err => {
            if (active) {
              setMessage(
                `โหลดภาพไม่สำเร็จ: ${err.message}`
              )
            }
          })
      }

      return () => {
        active = false
      }
    }, [
      selected?.id,
      selected?.paths?.doc1,
      selected?.paths?.doc2,
      selected?.paths?.cctv1,
      selected?.paths?.cctv2,
    ])

    // ====================================
    // RESPONSIVE PREVIEW
    // ====================================

    useEffect(() => {
      const node = previewWrapRef.current

      if (!node) return

      const resize = () => {
        setScale(
          Math.min(
            1,
            Math.max(
              0.2,
              (node.clientWidth - 24) / 1120
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
    }, [ready, canEdit])

    // ====================================
    // SAVE VIA TRANSACTION
    // ====================================

    async function commit(
      nextCases,
      replace,
      newPaths = []
    ) {
      try {
        const { data, error } = await supabase
          .rpc('section09_save_month', {
            p_center_id: centerId,
            p_report_year: Number(year),
            p_report_month: Number(month),
            p_cases: nextCases,
            p_replace: replace,
            p_expected_at:
              replace
                ? null
                : savedAtRef.current,
          })

        if (error) throw error

        savedAtRef.current = data.updated_at

        setCases(nextCases)

        setSelectedId(previous =>
          nextCases.some(c => c.id === previous)
            ? previous
            : (nextCases[0]?.id || null)
        )

        setMessage('บันทึกข้อมูลเรียบร้อยแล้ว')

        onDataChange?.()

        try {
          await deletePaths(
            data.removed_paths || []
          )
        } catch (cleanupError) {
          console.warn(
            'Section09 cleanup:',
            cleanupError
          )

          setMessage(
            'บันทึกแล้ว แต่ลบภาพเก่าบางไฟล์ไม่สำเร็จ กรุณาตรวจ Storage'
          )
        }
      } catch (err) {
        if (newPaths.length) {
          try {
            await deletePaths(newPaths)
          } catch (cleanupError) {
            console.warn(cleanupError)
          }
        }

        throw err
      }
    }

    // ====================================
    // BULK IMPORT ZIP
    // ====================================

    async function handleZip(file) {
      if (!file || !canEdit || busy) return

      setBusy(true)
      setMessage('')

      const uploaded = []

      try {
        

        setProgress('กำลังตรวจ ZIP...')

        
        const groups = await readCaseArchive(file)


        const batch = crypto.randomUUID()
        const nextCases = []

        for (
          let i = 0;
          i < groups.length;
          i++
        ) {
          const group = groups[i]

          setProgress(
            `กำลังแปลง/อัปโหลดเคส ${i + 1} / ${groups.length}: ${group.title}`
          )

          
            // PDF อาจไม่มีในบางเคส
            let docs = []

            if (group.pdf) {
            const pdfBlob = await group.pdf.getBlob()

            if (pdfBlob.size > 25 * 1024 * 1024) {
                throw new Error(
                `PDF เคส ${group.title} ต้องไม่เกิน 25 MB`
                )
            }

            docs = await pdfToImages(
                new Uint8Array(
                await pdfBlob.arrayBuffer()
                )
            )
            }

            // ภาพ CCTV อาจมี 0, 1 หรือ 2 ภาพ
            const photos = []

            for (const photo of group.photos) {
            const blob = await photo.getBlob()

            if (blob.size > 20 * 1024 * 1024) {
                throw new Error(
                `ภาพในเคส ${group.title} ต้องไม่เกิน 20 MB`
                )
            }

            photos.push(
                await optimizePhoto(blob)
            )
            }


          const prefix =
            `${centerId}/${year}-${pad(month)}` +
            `/${batch}/${pad(i + 1)}`

          const paths = {
            doc1: '',
            doc2: '',
            cctv1: '',
            cctv2: '',
          }

          const blobs = {
            doc1: docs[0],
            doc2: docs[1],
            cctv1: photos[0],
            cctv2: photos[1],
          }

          for (const slot of SLOTS) {
            if (!blobs[slot]) continue

            const path = await upload(
              blobs[slot],
              prefix,
              slot
            )

            paths[slot] = path
            uploaded.push(path)
          }

          nextCases.push({
            id: crypto.randomUUID(),
            title: group.title,
            paths,
          })
        }

        // สำเร็จทั้งหมดก่อน จึงแทนของเดิม
        await commit(
          nextCases,
          true,
          uploaded
        )

        
        const incomplete = nextCases.filter(
        item => getMissingSlots(item).length > 0
        ).length

        setMessage(
        `นำเข้าสำเร็จ ${nextCases.length} เคส` +
        (incomplete
            ? ` • มี ${incomplete} เคสที่ต้องเติมไฟล์`
            : ' • ไฟล์ครบทุกเคส')
        )


        setOpenedId(
          nextCases[0]?.id || null
        )

      } catch (err) {
        setMessage(
          `นำเข้า ZIP ไม่สำเร็จ: ${err.message}`
        )

        if (uploaded.length) {
          try {
            await deletePaths(uploaded)
          } catch (cleanupError) {
            console.warn(cleanupError)
          }
        }

      } finally {
        setBusy(false)
        setProgress('')
      }
    }

    // ====================================
    // EDIT CASE TITLE
    // ====================================

    async function saveTitle() {
      if (
        !canEdit ||
        busy ||
        !cases.length
      ) return

      setBusy(true)

      try {
        await commit(cases, false)
      } catch (err) {
        setMessage(
          `บันทึกไม่สำเร็จ: ${err.message}`
        )
      } finally {
        setBusy(false)
      }
    }

    // ====================================
    // REPLACE PDF / CCTV IMAGE
    // ====================================

    async function replaceFile(
      caseId,
      slot,
      file
    ) {
      if (
        !canEdit ||
        !file ||
        busy
      ) return

      setBusy(true)
      setMessage('')

      const uploaded = []

      try {
        const item = cases.find(
          c => c.id === caseId
        )

        if (!item) {
          throw new Error('ไม่พบเคส')
        }

        const prefix =
          `${centerId}/${year}-${pad(month)}` +
          `/${crypto.randomUUID()}`

        const paths = {
          ...item.paths,
        }

        if (slot === 'pdf') {
          if (
            file.type !== 'application/pdf' &&
            !/\.pdf$/i.test(file.name)
          ) {
            throw new Error('ต้องเลือก PDF')
          }

          if (
            file.size > 25 * 1024 * 1024
          ) {
            throw new Error(
              'PDF ต้องไม่เกิน 25 MB'
            )
          }

          const docs = await pdfToImages(
            new Uint8Array(
              await file.arrayBuffer()
            )
          )

          paths.doc1 = await upload(
            docs[0],
            prefix,
            'doc1'
          )

          uploaded.push(paths.doc1)

          paths.doc2 = ''

          if (docs[1]) {
            paths.doc2 = await upload(
              docs[1],
              prefix,
              'doc2'
            )

            uploaded.push(paths.doc2)
          }

        } else {
          if (
            ![
              'image/png',
              'image/jpeg',
              'image/webp',
            ].includes(file.type)
          ) {
            throw new Error(
              'รูปต้องเป็น JPG, PNG หรือ WEBP'
            )
          }

          if (
            file.size > 20 * 1024 * 1024
          ) {
            throw new Error(
              'ภาพต้องไม่เกิน 20 MB'
            )
          }

          paths[slot] = await upload(
            await optimizePhoto(file),
            prefix,
            slot
          )

          uploaded.push(paths[slot])
        }

        const next = cases.map(c =>
          c.id === caseId
            ? { ...c, paths }
            : c
        )

        await commit(
          next,
          false,
          uploaded
        )

        setSelectedId(caseId)
        setOpenedId(caseId)

      } catch (err) {
        setMessage(
          `เปลี่ยนไฟล์ไม่สำเร็จ: ${err.message}`
        )

        if (uploaded.length) {
          try {
            await deletePaths(uploaded)
          } catch (cleanupError) {
            console.warn(cleanupError)
          }
        }

      } finally {
        setBusy(false)
      }
    }

    // ====================================
    // CAPTURE PDF PAGE
    // ====================================

    async function capture(item) {
      const images = await loadImages(
        item.paths
      )

      flushSync(() =>
        setExportItem({
          item,
          images,
        })
      )

      const node = exportPageRef.current

      await document.fonts.ready

      await Promise.all(
        [...node.querySelectorAll('img')]
          .map(img =>
            img.decode().catch(() => {})
          )
      )

      const canvas = await html2canvas(
        node,
        {
          width: 1120,
          height: 792,
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        }
      )

      return canvas.toDataURL(
        'image/jpeg',
        0.88
      )
    }

    // ====================================
    // PDF EXPORT INTERFACE
    // ====================================

    useImperativeHandle(ref, () => ({
      isReady: () =>
        ready && !busy,

      hasData: () =>
        cases.length > 0,

      exportPdfPages: async () => {
        const pages = []

        try {
          for (const item of cases) {
            const dataUrl =
              await capture(item)

            pages.push({
              orientation: 'landscape',
              dataUrl,
            })
          }

          return pages
        } finally {
          flushSync(() =>
            setExportItem(null)
          )
        }
      },
    }))

    // ====================================
    // USER INTERFACE
    // ====================================

    return (
      <div
        className={`s09-editor ${
          canEdit ? '' : 'view-only'
        }`}
      >
        {canEdit && (
          <aside className="s09-panel">
            <h3>
              หัวข้อ 09 — ใบคำร้องและภาพประกอบ
            </h3>

            <p>
              นำเข้า ZIP แล้วกดเปิดแต่ละเคส
              เพื่อแก้ไขได้
            </p>

            <button
              className="s09-upload"
              disabled={busy || !ready}
              onClick={() =>
                zipInputRef.current?.click()
              }
            >
              {busy
                ? 'กำลังดำเนินการ...'
                : '↑ อัปโหลด ZIP / RAR / 7Z'}
            </button>

            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,.rar,.7z,application/zip"
              hidden
              onChange={e => {
                const file =
                  e.target.files?.[0]

                e.target.value = ''

                handleZip(file)
              }}
            />

            <small>
              อัปโหลดใหม่ = แทนที่เคสทั้งเดือน
              {' • '}
              เก็บเฉพาะ 2 เดือนล่าสุด
              ที่อัปโหลดสำเร็จ
            </small>

            {progress && (
              <p className="s09-progress">
                {progress}
              </p>
            )}

            {message && (
              <p
                role="status"
                className="s09-message"
              >
                {message}
              </p>
            )}

            <div className="s09-case-count">
              เคสทั้งหมด {cases.length} รายการ
            </div>

            {cases.map((item, index) => (
              <div
                className="s09-accordion"
                key={item.id}
              >
                <button
                  className="s09-accordion-head"
                  onClick={() => {
                    setOpenedId(
                      openedId === item.id
                        ? null
                        : item.id
                    )

                    setSelectedId(item.id)
                  }}
                >
                  <b>{pad(index + 1)}</b>
                  
                    <span className="s09-case-label">
                    <span className="s09-case-title">
                        {item.title}
                    </span>

                    {getMissingSlots(item).length > 0 ? (
                        <small className="s09-case-incomplete">
                        ⚠ ขาด: {getMissingSlots(item).join(', ')}
                        </small>
                    ) : (
                        <small className="s09-case-complete">
                        ✓ ไฟล์ครบ
                        </small>
                    )}
                    </span>

                  <i>
                    {openedId === item.id
                      ? '⌃'
                      : '⌄'}
                  </i>
                </button>

                {openedId === item.id && (
                  <div className="s09-fields">
                    <label>
                      ชื่อเหตุการณ์

                      <textarea
                        rows="3"
                        value={item.title}
                        disabled={busy}
                        onChange={e => {
                          const title =
                            e.target.value

                          setCases(prev =>
                            prev.map(c =>
                              c.id === item.id
                                ? { ...c, title }
                                : c
                            )
                          )
                        }}
                      />
                    </label>

                    <button
                      disabled={
                        busy ||
                        !item.title.trim()
                      }
                      onClick={saveTitle}
                    >
                      บันทึกชื่อเหตุการณ์
                    </button>

                    <label className="s09-file-label">
                      เปลี่ยน PDF (1–2 หน้า)

                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        disabled={busy}
                        onChange={e => {
                          const f =
                            e.target.files?.[0]

                          e.target.value = ''

                          replaceFile(
                            item.id,
                            'pdf',
                            f
                          )
                        }}
                      />
                    </label>

                    {[
                      'cctv1',
                      'cctv2',
                    ].map((slot, n) => (
                      <label
                        className="s09-file-label"
                        key={slot}
                      >
                        เปลี่ยนภาพ CCTV {n + 1}

                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={busy}
                          onChange={e => {
                            const f =
                              e.target.files?.[0]

                            e.target.value = ''

                            replaceFile(
                              item.id,
                              slot,
                              f
                            )
                          }}
                        />
                      </label>
                    ))}

                    
                    <div className="s09-files-summary">
                        เอกสาร PDF:{' '}
                        {!item.paths?.doc1
                            ? 'ไม่มี'
                            : item.paths?.doc2
                            ? '2 หน้า'
                            : '1 หน้า'}

                        {' • '}

                        ภาพ CCTV:{' '}
                        {[
                            item.paths?.cctv1,
                            item.paths?.cctv2,
                        ].filter(Boolean).length}/2 ภาพ
                    </div>

                  </div>
                )}
              </div>
            ))}
          </aside>
        )}

        <section
          className="s09-preview"
          ref={previewWrapRef}
        >
          {!ready ? (
            <p>กำลังโหลดข้อมูล...</p>
          ) : !selected ? (
            <div className="s09-guide">
            <div className="s09-guide-header">
                <div className="s09-guide-icon">📂</div>

                <div>
                <h3>วิธีเตรียมไฟล์สำหรับอัปโหลด</h3>
                <p>
                    จัดเตรียมไฟล์ใบคำร้องและภาพ CCTV
                    ก่อนนำเข้าหัวข้อ 09
                </p>
                </div>
            </div>

            <div className="s09-guide-grid">
                <div className="s09-guide-section">
                <h4>01 — ไฟล์ที่รองรับ</h4>

                <div className="s09-guide-formats">
                    <span>ZIP</span>
                    <span>RAR</span>
                    <span>7Z</span>
                </div>

                <p>
                    บีบอัดโฟลเดอร์เคสทั้งหมดเป็นไฟล์เดียว
                    แล้วอัปโหลดเข้าระบบ
                </p>
                </div>

                <div className="s09-guide-section">
                <h4>02 — ข้อมูลในแต่ละเคส</h4>

                <ul>
                    <li>PDF ใบคำร้อง 1 ไฟล์ (1–2 หน้า)</li>
                    <li>ภาพ CCTV ไม่เกิน 2 ภาพ</li>
                    <li>ชื่อ PDF ใช้เป็นชื่อเหตุการณ์</li>
                    <li>ชื่อภาพตั้งอะไรก็ได้ ไม่จำกัดลำดับ</li>
                </ul>
                </div>
            </div>

            <div className="s09-guide-section">
                <h4>03 — ตัวอย่างโครงสร้างโฟลเดอร์</h4>

                <pre className="s09-guide-tree">{`รายงานประจำเดือน.rar
            │
            ├── 01/
            │   ├── 01-1002 อุบัติเหตุรถจักรยานยนต์.pdf
            │   ├── IMG_001.jpg
            │   └── IMG_002.jpg
            │
            ├── 02/
            │   ├── 02-1003 รถยนต์ชนคนเดินเท้า.pdf
            │   ├── CCTV_A.jpg
            │   └── CCTV_B.jpg
            │
            └── 03/
                ├── 03-1004 อาชญากรรม.pdf
                └── ภาพเหตุการณ์.jpg`}</pre>
            </div>

            <div className="s09-guide-note">
                <strong>กรณีไฟล์ไม่ครบ</strong>
                <p>
                ระบบยังนำเข้าเคสได้ แม้ไม่มี PDF
                หรือมีภาพ CCTV ไม่ครบ 2 ภาพ
                โดยจะแสดงสถานะไฟล์ที่ขาดในบาร์แก้ไข
                เพื่อให้อัปโหลดเพิ่มภายหลัง
                </p>
            </div>

            <div className="s09-guide-footer">
                <span>✓ 1 โฟลเดอร์ = 1 เคส</span>
                <span>✓ PDF 1–2 หน้า</span>
                <span>✓ แก้ไขข้อมูลหลังอัปโหลดได้</span>
            </div>
            </div>

          ) : (
            <div
              className="s09-stage"
              style={{
                width: 1120 * scale,
                height: 792 * scale,
              }}
            >
              <div
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <CasePaper
                  item={selected}
                  images={preview}
                  center={center}
                  month={month}
                  year={year}
                />
              </div>
            </div>
          )}
        </section>

        {/* Paper สำหรับ PDF Export เท่านั้น */}
        <div
          className="s09-export-host"
          aria-hidden="true"
        >
          <div ref={exportPageRef}>
            {exportItem && (
              <CasePaper
                item={exportItem.item}
                images={exportItem.images}
                center={center}
                month={month}
                year={year}
              />
            )}
          </div>
        </div>
      </div>
    )
  }
)

export default Section09Editor
