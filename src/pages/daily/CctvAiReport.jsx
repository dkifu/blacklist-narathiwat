
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import {
  BrainCircuit,
  Building2,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  FileImage,
  FileText,
  Images,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react'

import { toPng, toJpeg } from 'html-to-image'
import { jsPDF } from 'jspdf'
import { supabase } from '../../lib/supabase'

import './CctvAiReport.css'


/* =============================
   SETTINGS
============================= */

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
  import.meta.env.VITE_CCTV_AI_URL || ''

const pad = (n) => String(n).padStart(2, '0')

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

  if (Number.isNaN(d.getTime())) return value

  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

const blankReport = (
  station = '',
  centerName = ''
) => ({
  station,
  centerName,
  location: 'บริเวณสถานที่สำคัญในพื้นที่รับผิดชอบ',
  reportDate: today(),
  overall: 'รอการวิเคราะห์',
  safety: 'ยังไม่ประเมิน',
  traffic: 'ยังไม่ประเมิน',
  abnormal: 'ยังไม่ประเมิน',
  visibility: 'ยังไม่ประเมิน',
  findings: ['', '', '', '', ''],
  trafficFindings: ['', '', ''],
  highlights: ['', '', ''],
  conclusion: '',
  centerLogo: '',
})

const stationFromCenter = (centerName) =>
  STATIONS[centerName] ||
  centerName?.replace(/^ศูนย์/, 'สภ.') ||
  ''

const safeName = (text) =>
  String(text || 'REPORT')
    .replace(/[^\w\u0E00-\u0E7F-]/g, '_')
    .slice(0, 70)


/* =============================
   IMAGE UTILITIES
============================= */

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('ไม่สามารถอ่านไฟล์ภาพได้'))
    }

    image.src = url
  })

const validImage = (file) =>
  ['image/jpeg', 'image/png', 'image/webp']
    .includes(file.type) &&
  file.size <= 15 * 1024 * 1024

const compressImage = async (file) => {
  const image = await loadImage(file)

  const ratio = Math.min(
    1,
    1600 / image.naturalWidth,
    1000 / image.naturalHeight
  )

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(
    1,
    Math.round(image.naturalWidth * ratio)
  )
  canvas.height = Math.max(
    1,
    Math.round(image.naturalHeight * ratio)
  )

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('ไม่สามารถประมวลผล Canvas ได้')
  }

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  )

  return canvas.toDataURL('image/jpeg', 0.85)
}

const splitCollage = async (file, count) => {
  const [columns, rows] = GRID_OPTIONS[count]
  const image = await loadImage(file)

  const cellWidth = image.naturalWidth / columns
  const cellHeight = image.naturalHeight / rows

  const result = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const canvas = document.createElement('canvas')

      canvas.width = Math.round(cellWidth)
      canvas.height = Math.round(cellHeight)

      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('ไม่สามารถตัดภาพกล้องได้')
      }

      context.drawImage(
        image,
        col * cellWidth,
        row * cellHeight,
        cellWidth,
        cellHeight,
        0,
        0,
        canvas.width,
        canvas.height
      )

      result.push({
        name: `กล้อง ${result.length + 1}`,
        src: canvas.toDataURL('image/jpeg', 0.88),
      })
    }
  }

  return result
}


/* =============================
   REPORT SHEET 1600 × 900
============================= */


/* =====================================
   FILTER REPORT ITEMS

   แสดงเฉพาะข้อที่มีข้อมูลจริง
   ไม่แสดงช่องว่างหรือเครื่องหมาย —
===================================== */

function getVisibleReportItems(items, maximum) {
  if (!Array.isArray(items)) {
    return []
  }

  return items
    .map((item) =>
      typeof item === 'string'
        ? item.trim()
        : ''
    )
    .filter(
      (item) =>
        item.length > 0 &&
        item !== '-' &&
        item !== '—' &&
        item !== '–'
    )
    .slice(0, maximum)
}

/* =========================================
   SUMMARY TONE HELPERS
   green  = ปกติทั่วไป
   yellow = เฝ้าระวัง / ฝนตก / ไฟมืด
   orange = ไม่ปกติ / รถติดหนัก / ก่อสร้าง / อุบัติเหตุ
   red    = ฉุกเฉิน / อุบัติเหตุใหญ่ / น้ำท่วม / ปิดถนน
========================================= */

const RED_KEYWORDS = [
  'ฉุกเฉิน',
  'อุบัติเหตุใหญ่',
  'น้ำท่วม',
  'น้ำท่วมขัง',
  
  'เพลิงไหม้',
  'กู้ภัย',
  'ถนนขาด',
  'ดินถล่ม',
  'รถพลิกคว่ำ',
  'ชนรุนแรง',
]

const ORANGE_KEYWORDS = [
  'ผิดปกติ',
  'ไม่ปกติ',
  'อุบัติเหตุ',
  'รถติดหนัก',
  'จราจรติดขัดมาก',
  'ก่อสร้าง',
  'สิ่งกีดขวาง',
  'กีดขวาง',
  'ชำรุด',
  'เสี่ยงสูง',
  'หนาแน่นมาก',
  'มีการปิดช่องจราจร',
  'เบี่ยงจราจร',
  
  'ปิดถนน',
  'ปิดการจราจร',
  'ถนนปิด',
  'ปิดช่องจราจร',
  'ขบวนพาเหรดบนถนน',
  'เดินขบวนบนผิวจราจร',
  'ใช้พื้นที่ถนนจัดกิจกรรม',
  'ใช้ช่องทางจราจรเป็นพื้นที่จัดกิจกรรม',

]

const YELLOW_KEYWORDS = [
  'เฝ้าระวัง',
  'ฝนตก',
  'ฝนตกหนัก',
  'พื้นผิวถนนเปียก',
  'เปียกลื่น',
  'แสงน้อย',
  'แสงสว่างน้อย',
  'ไฟมืด',
  'มืด',
  'ทัศนวิสัยต่ำ',
  'ค่อนข้างต่ำ',
  'หมอก',
  'น้ำขัง',
  'มีปัจจัยเสี่ยง',
  'ชะลอตัว',
  'ปานกลาง',
  'ประชาชนหนาแน่นริมถนน',
  'ประชาชนหนาแน่นใกล้ช่องจราจร',
  'คนเดินเท้าใช้พื้นที่ร่วมกับยานพาหนะ',
  'ฝูงชนหนาแน่นใกล้ถนน',
]

function textHasKeyword(text, keywords) {
  const value = String(text || '').toLowerCase()
  return keywords.some((keyword) =>
    value.includes(String(keyword).toLowerCase())
  )
}


function getOverallTone(overall) {
  const value = String(overall || '').trim()

  if (value === 'ฉุกเฉิน') return 'red'
  if (value === 'ผิดปกติ') return 'orange'
  if (value === 'เฝ้าระวัง') return 'yellow'
  if (value === 'ปกติ') return 'green'

  return 'neutral'
}



function getSummaryTone(fieldKey, value, overall) {
  const text = String(value || '').trim()

  // ยังไม่มีผลประเมิน
  if (
    !text ||
    /^(ยังไม่ประเมิน|รอการวิเคราะห์|ไม่สามารถประเมินได้)$/.test(text)
  ) {
    return 'neutral'
  }

  // แยกข้อความเชิงปฏิเสธออก
  // เช่น "ไม่พบเหตุผิดปกติ แต่มีฝนตก"
  // ต้องประเมินจาก "มีฝนตก" เป็นสีเหลือง

  const parts = text.split(
    /แต่|อย่างไรก็ตาม|ขณะที่|ทว่า/
  )

  let checkText = parts
    .map((part) => part.trim())
    .filter(
      (part) =>
        part &&
        !/^(ไม่พบ|ไม่มี|ไม่ปรากฏ|ไม่ตรวจพบ|ไม่เกิด)/.test(part)
    )
    .join(' ')

  // ตัดข้อความปฏิเสธที่อยู่กลางประโยค
  checkText = checkText.replace(
    /(?:ไม่พบ|ไม่มี|ไม่ปรากฏ|ไม่ตรวจพบ|ไม่เกิด)\s*(?:เหตุการณ์|เหตุ|สิ่ง|ความ|การ)?\s*(?:ผิดปกติ|อุบัติเหตุ|น้ำท่วม|น้ำขัง|สิ่งกีดขวาง|กีดขวาง|ปิดถนน|จราจรติดขัด|เพลิงไหม้)/g,
    ' '
  )
  
  // แยกการปฏิเสธและการคาดการณ์ออกจากเหตุที่เกิดจริง
  checkText = checkText
    .replace(
      /(?:ไม่ได้|มิได้)\s*(?:มี)?\s*(?:การ)?\s*(?:ปิดถนน|ปิดการจราจร|ปิดช่องจราจร|ปิดเส้นทาง)/g,
      ' '
    )
    .replace(
      /(?:อาจจะ|อาจ|มีโอกาส|คาดว่า|หาก|ถ้า)\s*(?:มี)?\s*(?:การ)?\s*(?:ปิดถนน|ปิดการจราจร|ปิดช่องจราจร|ปิดเส้นทาง)/g,
      ' ควรเฝ้าระวัง '
    )
    .replace(
      /(?:อาจจะ|อาจ|มีโอกาส|คาดว่า|หาก|ถ้า)\s*(?:มี)?\s*(?:การ)?\s*(?:เดินขบวน|ขบวนกิจกรรม|เดินพาเหรด|ขบวนพาเหรด|พาเหรด)(?:.{0,30}(?:บนถนน|บนผิวจราจร|ใช้ผิวจราจร|ผิวถนน|ช่องจราจร|กลางถนน))?/g,
      ' ควรเฝ้าระวัง '
    )


  // สีแดง — ฉุกเฉิน
  if (
    textHasKeyword(checkText, RED_KEYWORDS) ||
    /อุบัติเหตุรุนแรง|อุบัติเหตุขนาดใหญ่/.test(checkText)
  ) {
    return 'red'
  }
  
  // กิจกรรมพิเศษที่ใช้ผิวจราจรจริง
  if (
    /(?:พาเหรด|เดินขบวน|ขบวนกิจกรรม).{0,30}(?:บนถนน|ผิวจราจร|ผิวถนน|ช่องจราจร|กลางถนน)/.test(checkText)
  ) {
    return 'orange'
  }


  // สีส้ม — สถานการณ์ไม่ปกติ
  if (
    textHasKeyword(checkText, ORANGE_KEYWORDS) ||
    /รถติดหนัก|จราจรติดขัดรุนแรง/.test(checkText)
  ) {
    return 'orange'
  }

  // การจราจรระดับปานกลางเพียงอย่างเดียว
  // ไม่ถือว่าเป็นเหตุเฝ้าระวัง
  const yellowText =
    fieldKey === 'traffic'
      ? checkText.replace(/ปานกลาง/g, '')
      : checkText

  // สีเหลือง — เฝ้าระวัง
  if (textHasKeyword(yellowText, YELLOW_KEYWORDS)) {
    return 'yellow'
  }

  // ข้อความทั่วไปหรือไม่พบเหตุผิดปกติ
  return 'green'
}

const LIST_RED_KEYWORDS = [
  'ฉุกเฉิน',
  'อุบัติเหตุใหญ่',
  'ชนรุนแรง',
  'เพลิงไหม้',
  'ไฟไหม้',
  'น้ำท่วม',
  'น้ำท่วมขัง',
  
  'ถนนขาด',
  'ดินถล่ม',
  'มีผู้บาดเจ็บ',
  'มีผู้เสียชีวิต',
]

const LIST_ORANGE_KEYWORDS = [
  'อุบัติเหตุ',
  'รถชน',
  'รถติดหนัก',
  'จราจรติดขัด',
  'ติดขัดมาก',
  'ก่อสร้าง',
  'สิ่งกีดขวาง',
  'ขวางการจราจร',
  'มีการปิดช่องทาง',
  'รถเสีย',
  'เหตุผิดปกติ',
  'น่าสงสัย',
  
  'ปิดถนน',
  'ปิดการจราจร',
  'ปิดช่องจราจร',
  'ปิดเส้นทาง',
  'ขบวนพาเหรดบนถนน',
  'เดินขบวนบนผิวจราจร',
  'ใช้พื้นที่ถนนจัดกิจกรรม',
  'ใช้ช่องทางจราจรเป็นพื้นที่จัดกิจกรรม',

]

const LIST_YELLOW_KEYWORDS = [
  'เฝ้าระวัง',
  'ฝนตก',
  'ฝนตกหนัก',
  'พื้นผิวเปียก',
  'ถนนลื่น',
  'ทัศนวิสัยต่ำ',
  'แสงน้อย',
  'ไฟมืด',
  'หมอก',
  'ควัน',
  'น้ำขัง',
  'จอดรถหนาแน่น',
  'รถมากกว่าปกติ',
  'ประชาชนหนาแน่นริมถนน',
  'ประชาชนหนาแน่นใกล้ช่องจราจร',
  'คนเดินเท้าใช้พื้นที่ร่วมกับยานพาหนะ',
  'ฝูงชนหนาแน่นใกล้ถนน',
]

function normalizeListItems(items = []) {
  return (items || [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && item !== '-')
}


function getListTone(text = '') {
  const value = String(text || '').trim()

  if (
    !value ||
    ['-', '—', '–'].includes(value)
  ) {
    return 'neutral'
  }

  const event =
    '(?:ผิดปกติ|อุบัติเหตุ(?:ใหญ่|รุนแรง)?|' +
    'น้ำท่วม(?:ขัง)?|น้ำขัง|ปิดถนน|' +
    'ปิดการจราจร|เพลิงไหม้|ไฟไหม้|' +
    'สิ่งกีดขวาง|กีดขวาง|' +
    'จราจรติดขัด|รถติดหนัก|' +
    'ผู้บาดเจ็บ|ผู้เสียชีวิต)'

  const riskEvent =
    '(?:อุบัติเหตุ(?:ใหญ่|รุนแรง)?|' +
    'น้ำท่วม(?:ขัง)?|ปิดถนน|' +
    'ปิดการจราจร|จราจรติดขัด|รถติดหนัก)'

  // ข้อความปฏิเสธ เช่น
  // "ไม่พบอุบัติเหตุหรือเหตุผิดปกติ"

  const negativePattern = new RegExp(
    '(?:ไม่พบ|ไม่มี|ไม่ปรากฏ|ไม่ตรวจพบ|ไม่เกิด)' +
    '\\s*(?:เหตุการณ์|เหตุ|การ|สิ่ง|ความ)?\\s*' +
    event +
    '(?:\\s*(?:และ|หรือ)\\s*' +
    '(?:เหตุการณ์|เหตุ|การ|สิ่ง|ความ)?\\s*' +
    event + ')*',
    'g'
  )

  // ความเสี่ยงที่ยังไม่เกิดขึ้นจริง

  const potentialPattern = new RegExp(
    '(?:อาจ|เสี่ยงต่อการ|เสี่ยง|มีโอกาส)' +
    '\\s*(?:ทำให้|ก่อให้)?\\s*(?:เกิด|มี)?\\s*' +
    riskEvent,
    'g'
  )

  // เหตุการณ์สมมุติ เช่น "หากมีน้ำท่วม"

  const ifPattern = new RegExp(
    '(?:หาก|ถ้า)\\s*(?:มี|เกิด)?\\s*' +
    riskEvent,
    'g'
  )

  const factual = value
    .replace(negativePattern, ' ')
    
    .replace(
      /(?:ไม่พบ|ไม่มี|ไม่ปรากฏ|ไม่ตรวจพบ)\s*(?:การ)?\s*(?:ขบวนพาเหรด|เดินพาเหรด|พาเหรด)(?:.{0,20}(?:บนถนน|บนผิวจราจร|ใช้ผิวจราจร))?/g,
      ' '
    )
    .replace(
      /(?:อาจ|อาจจะ|มีโอกาส|คาดว่า|หาก|ถ้า)\s*(?:มี)?\s*(?:การ)?\s*(?:ปิดถนน|ปิดการจราจร|ปิดช่องจราจร|ปิดเส้นทาง)/g,
      ' ควรเฝ้าระวัง '
    )
    
    // กรณีไม่พบกิจกรรมเดินขบวน
    .replace(
      /(?:ไม่พบ|ไม่มี|ไม่ปรากฏ|ไม่ตรวจพบ)\s*(?:การ)?\s*(?:เดินขบวน|ขบวนกิจกรรม)(?:.{0,30}(?:บนถนน|บนผิวจราจร|ใช้ผิวจราจร|ผิวถนน|ช่องจราจร|กลางถนน))?/g,
      ' '
    )

    // กรณียืนยันว่าไม่ได้ปิดถนน
    .replace(
      /(?:ไม่ได้|มิได้)\s*(?:มี)?\s*(?:การ)?\s*(?:ปิดถนน|ปิดการจราจร|ปิดช่องจราจร|ปิดเส้นทาง)/g,
      ' '
    )

    // กรณีเป็นเพียงการคาดการณ์ว่าจะมีกิจกรรม
    .replace(
      /(?:อาจจะ|อาจ|มีโอกาส|คาดว่า|หาก|ถ้า)\s*(?:มี)?\s*(?:การ)?\s*(?:เดินขบวน|ขบวนกิจกรรม|เดินพาเหรด|ขบวนพาเหรด|พาเหรด)(?:.{0,30}(?:บนถนน|บนผิวจราจร|ใช้ผิวจราจร|ผิวถนน|ช่องจราจร|กลางถนน))?/g,
      ' ควรเฝ้าระวัง '
    )


    // ลบเหตุการณ์ที่ระบุชัดว่า "ไม่พบ"
    // เช่น ไม่พบกลุ่มคนหรือกิจกรรมที่น่าสงสัย
    .replace(
        /(?:ไม่พบ|ไม่มี|ไม่ปรากฏ|ไม่ตรวจพบ)\s*(?:(?:กลุ่มคน|บุคคล|ผู้คน|กิจกรรม|พฤติกรรม|การกระทำ|สิ่งของ|วัตถุ|เหตุการณ์|เหตุ|สิ่ง)\s*(?:(?:หรือ|และ|รวมถึง)\s*)?){1,4}(?:ที่มีลักษณะ|ที่)?\s*(?:น่าสงสัย|ผิดปกติ)/g,
        ' '
    )
    .replace(
      /(?:ไม่พบ|ไม่มี|ไม่ปรากฏ)\s*(?:ความเสี่ยง|ปัจจัยเสี่ยง|อุปสรรค)/g,
      ' '
    )
    .replace(
      potentialPattern,
      ' ควรเฝ้าระวัง '
    )
    .replace(
      ifPattern,
      ' ควรเฝ้าระวัง '
    )

  // แดง — เหตุฉุกเฉินที่ระบุว่าเกิดขึ้น

  if (
    textHasKeyword(factual, LIST_RED_KEYWORDS)
  ) {
    return 'red'
  }

  // ส้ม — สถานการณ์ผิดปกติที่ระบุว่าเกิดขึ้น

  if (
    textHasKeyword(factual, LIST_ORANGE_KEYWORDS)
  ) {
    return 'orange'
  }

  
  // ตรวจจับกิจกรรมพิเศษที่ใช้พื้นที่ผิวจราจร
  if (
    /(?:พาเหรด|เดินขบวน|ขบวนกิจกรรม).{0,30}(?:บนถนน|ผิวจราจร|ผิวถนน|ช่องจราจร|กลางถนน)/.test(factual)
  ) {
    return 'orange'
  }


  // เหลือง — ความเสี่ยงหรือสภาพที่ต้องเฝ้าระวัง

  if (
    textHasKeyword(factual, LIST_YELLOW_KEYWORDS) ||
    /เปียก|ลื่น|ทัศนวิสัยลดลง|แสงสว่างไม่เพียงพอ|ควรเฝ้าระวัง|ควรระวัง|อาจเป็นอุปสรรค|อาจกระทบ|เสี่ยง/.test(factual)
  ) {
    return 'yellow'
  }

  // เขียว — ไม่พบประเด็นที่ต้องยกระดับ

  return 'green'
}


function getListIcon(tone = 'green') {
  switch (tone) {
    case 'red':
      return '✕'
    case 'orange':
      return '▲'
    case 'yellow':
      return '!'
    case 'green':
      return '✓'
    default:
      return '•'
  }
}


/* =========================================
   AUTO FIT TEXT
   ปรับขนาดตามพื้นที่จริงของกล่อง
========================================= */

function AutoFitText({
  children,
  minSize = 13,
  maxSize = 21,
  maxLines = 0,
  className = '',
}) {
  const frameRef = useRef(null)
  const contentRef = useRef(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const content = contentRef.current

    if (!frame || !content) return

    let active = true

    const fits = (size) => {
      content.style.fontSize = `${size}px`

      const lineTarget = content.querySelector(
        '[data-line-cap]'
      )

      let linesOK = true

      if (maxLines > 0 && lineTarget) {
        const lineHeight = parseFloat(
          window.getComputedStyle(lineTarget).lineHeight
        )

        if (lineHeight > 0) {
          const lineCount =
            lineTarget.scrollHeight / lineHeight

          linesOK = lineCount <= maxLines + 0.15
        }
      }

      return (
        content.scrollHeight <= frame.clientHeight + 1 &&
        content.scrollWidth <= frame.clientWidth + 1 &&
        linesOK
      )
    }

    const fit = () => {
      if (
        frame.clientWidth <= 0 ||
        frame.clientHeight <= 0
      ) {
        return
      }

      if (fits(maxSize)) {
        content.style.fontSize = `${maxSize}px`
        return
      }

      if (!fits(minSize)) {
        content.style.fontSize = `${minSize}px`
        return
      }

      let low = minSize
      let high = maxSize

      for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2

        if (fits(middle)) {
          low = middle
        } else {
          high = middle
        }
      }

      content.style.fontSize =
        `${Math.floor(low * 4) / 4}px`
    }

    const observer = new ResizeObserver(fit)

    observer.observe(frame)
    fit()

    document.fonts?.ready?.then(() => {
      if (active) fit()
    })

    return () => {
      active = false
      observer.disconnect()
    }
  }, [children, minSize, maxSize, maxLines])

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



function ReportSheet({ report, images, count }) {
  const [columns, rows] = GRID_OPTIONS[count]

  const cameraSlots = Array.from(
    { length: count },
    (_, i) => images[i] || null
  )

  
const overallClass = {
  'ปกติ': 'normal',
  'เฝ้าระวัง': 'watch',
  'ผิดปกติ': 'abnormal',
  'ฉุกเฉิน': 'emergency',
  'รอการวิเคราะห์': 'pending',
  'ไม่สามารถประเมินได้': 'pending',
}[report.overall] || 'pending'


  
  
    
const renderLines = (items, numbered = false) => {
  const visibleItems = getVisibleReportItems(
    items,
    Array.isArray(items) ? items.length : 0
  )

  return visibleItems.map((item, index) => {
    const tone = getListTone(item)

    return (
      <div
        className={`ai-sheet-line ai-sheet-line--${tone}`}
        key={index}
      >
        <span
          className={`ai-sheet-line-number ai-sheet-line-number--${tone}`}
        >
          {numbered ? index + 1 : getListIcon(tone)}
        </span>

        <span
          className={`ai-sheet-line-text ai-sheet-line-text--${tone}`}
        >
          {item}
        </span>
      </div>
    )
  })
}


    const summaryCards = [
    {
      key: 'safety',
      label: 'ความเรียบร้อย',
      value: report?.safety || 'ยังไม่ประเมิน',
    },
    {
      key: 'traffic',
      label: 'การจราจร',
      value: report?.traffic || 'ยังไม่ประเมิน',
    },
    {
      key: 'abnormal',
      label: 'เหตุผิดปกติ',
      value: report?.abnormal || 'ยังไม่ประเมิน',
    },
    {
      key: 'visibility',
      label: 'สภาพอากาศ/ทัศนวิสัย',
      value: report?.visibility || 'ยังไม่ประเมิน',
    },
    
  ]


  // เรียงรายการตามระดับเหตุการณ์
  const sortedFindings = sortInsightItems(
    report.findings || []
  )

  const sortedTrafficFindings = sortInsightItems(
    report.trafficFindings || []
  )

  const sortedHighlights = sortInsightItems(
    report.highlights || []
  )  

  return (
    <article className="ai-sheet">

      {/* HEADER */}

      <header className="ai-sheet-header">
        <div className="ai-sheet-emblem">
    {report?.centerLogo ? (
        <img
        src={report.centerLogo}
        alt={report.station || 'โลโก้หน่วยงาน'}
        className="ai-sheet-emblem-image"
        />
    ) : (
        <ShieldCheck
        size={54}
        strokeWidth={1.5}
        className="ai-sheet-emblem-fallback"
        />
    )}

    <span className="ai-sheet-emblem-text">
        {report?.centerName || 'ศูนย์กล้องวงจรปิด'}
    </span>
    </div>

        <div className="ai-sheet-title">
          <h1>รายงานผลการวิเคราะห์ภาพกล้องวงจรปิด</h1>

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


      {/* MAIN */}

      <main className="ai-sheet-main">

        {/* CAMERA GRID */}

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
            {cameraSlots.map((image, index) => (
              <div
                className="ai-sheet-camera"
                key={index}
              >
                {image ? (
                  <img
                    src={image.src}
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
            ))}
          </div>
        </section>


        {/* RIGHT */}

        <div className="ai-sheet-right">

          <section className="ai-sheet-panel">
            <div className="ai-sheet-bar">
              <span className="ai-sheet-index">1</span>
              <strong>สรุปผลการประเมิน</strong>

              <span className={`ai-sheet-overall ${overallClass}`}>
                {report.overall}
              </span>
            </div>

            
            <div className="ai-sheet-status-grid">
                {summaryCards.map((item) => {
                    const tone = getSummaryTone(
                    item.key,
                    item.value,
                    report.overall
                    )

                    return (
                    <div
                        className={`ai-sheet-status ai-sheet-status--${tone}`}
                        key={item.key}
                    >
                        <small>{item.label}</small>

                        

<AutoFitText
  className="ai-auto-fit--summary"
  minSize={11}
  maxSize={20}
  maxLines={0}
>

  <strong
    data-line-cap
    title={item.value}
  >
    {item.value}
  </strong>
</AutoFitText>

                    </div>
                    )
                })}
            </div>


          </section>

          <section className="ai-sheet-panel">
            <div className="ai-sheet-bar">
              <span className="ai-sheet-index">2</span>
              <strong>ผลการตรวจสอบที่สำคัญ</strong>
            </div>

           
            <AutoFitText
            className="ai-auto-fit--list"
            minSize={13}
            maxSize={21}
            >
            <div className="ai-sheet-lines">
                {renderLines(sortedFindings, true)}
            </div>
            </AutoFitText>

          </section>

        </div>
      </main>


      {/* BOTTOM */}

      <section className="ai-sheet-bottom">

        <div className="ai-sheet-panel">
          <div className="ai-sheet-bar">
            <span className="ai-sheet-index">3</span>
            <strong>วิเคราะห์สภาพการจราจร</strong>
          </div>

          
            <AutoFitText
            className="ai-auto-fit--list"
            minSize={13}
            maxSize={20}
            >
            <div className="ai-sheet-lines">
                {renderLines(sortedTrafficFindings)}
            </div>
            </AutoFitText>

        </div>

        <div className="ai-sheet-panel">
          <div className="ai-sheet-bar">
            <span className="ai-sheet-index">4</span>
            <strong>เหตุการณ์น่าสนใจ</strong>
          </div>

          
        <AutoFitText
        className="ai-auto-fit--list"
        minSize={13}
        maxSize={20}
        >
        <div className="ai-sheet-lines">
            {renderLines(sortedHighlights)}
        </div>
        </AutoFitText>

        </div>

        <div className="ai-sheet-panel ai-sheet-conclusion">
          <div className="ai-sheet-bar">
            <span className="ai-sheet-index">5</span>
            <strong>ข้อสรุปเพื่อนำเรียนผู้บังคับบัญชา</strong>
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


      {/* FOOTER */}

      <footer className="ai-sheet-footer">
        <span>
          หน่วยงาน : {report.station || 'ยังไม่ระบุ'}
        </span>

        <span>
          หมายเหตุ : วิเคราะห์จากภาพนิ่ง ณ ช่วงเวลาที่ตรวจสอบ
          ต้องผ่านการตรวจทานก่อนนำเรียน
        </span>
      </footer>

    </article>
  )
}


/* =============================
   MAIN COMPONENT
============================= */


/* =====================================
   CCTV OVERVIEW IMAGE BUILDER V6

   รวมภาพทั้งหมดเป็นภาพเดียว
   สำหรับส่งให้ AI วิเคราะห์ภาพรวม
===================================== */

async function buildCctvOverview(images, count) {
  const [columns, rows] =
    GRID_OPTIONS[count] || []

  if (
    !columns ||
    !rows ||
    images.length !== count
  ) {
    throw new Error(
      'จำนวนภาพไม่ตรงกับจำนวนกล้อง'
    )
  }

  const tileWidth = 400
  const tileHeight = 245
  const headerHeight = 25
  const gap = 4

  const canvas =
    document.createElement('canvas')

  canvas.width = columns * tileWidth
  canvas.height = rows * tileHeight

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error(
      'เบราว์เซอร์ไม่รองรับการรวมภาพ'
    )
  }

  ctx.fillStyle = '#071a30'
  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  )


  /* =========================
     LOAD IMAGE
  ========================= */

  const loadImageSource = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image()

      image.onload = () => resolve(image)

      image.onerror = () => {
        reject(
          new Error('อ่านภาพกล้องไม่สำเร็จ')
        )
      }

      image.src = src
    })


  const decoded = await Promise.all(
    images.map((item) =>
      loadImageSource(item.src)
    )
  )


  /* =========================
     DRAW CAMERA GRID
  ========================= */

  for (
    let i = 0;
    i < decoded.length;
    i++
  ) {
    const x = (i % columns) * tileWidth

    const y =
      Math.floor(i / columns) * tileHeight

    const img = decoded[i]

    ctx.fillStyle = '#0f2439'

    ctx.fillRect(
      x + gap,
      y + gap,
      tileWidth - 2 * gap,
      tileHeight - 2 * gap
    )

    const availableW =
      tileWidth - gap * 2

    const availableH =
      tileHeight - headerHeight - gap * 2

    // ย่อภาพโดยรักษาสัดส่วนเดิม
    // ไม่บีบ ไม่ยืด และไม่ตัดส่วนภาพ

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
        (tileWidth - drawW) / 2
      )

    const drawY =
      y + headerHeight +
      Math.round(
        (availableH - drawH) / 2
      )

    ctx.drawImage(
      img,
      drawX,
      drawY,
      drawW,
      drawH
    )


    /* =========================
       CAMERA LABEL
    ========================= */

    ctx.fillStyle = '#0a2c4e'

    ctx.fillRect(
      x + gap,
      y + gap,
      tileWidth - gap * 2,
      headerHeight
    )

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 16px sans-serif'

    ctx.fillText(
      `Camera ${i + 1}`,
      x + 13,
      y + 23
    )
  }


  /* =========================
     COMPRESS OVERVIEW
  ========================= */

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
      'ภาพรวมมีขนาดใหญ่เกินไป กรุณาลดความละเอียด'
    )
  }

  return jpeg
}

const ITEM_PRIORITY = {
  normal: 1,
  watch: 2,
  warning: 3,
  danger: 4,
}

function normalizeItemLevel(item) {
  const rawLevel = String(
    item?.level ||
    item?.severity ||
    item?.tone ||
    item?.status ||
    ''
  ).toLowerCase()

  if (
    ['normal', 'ok', 'good', 'safe', 'success'].includes(rawLevel)
  ) {
    return 'normal'
  }

  if (
    ['watch', 'caution', 'yellow', 'attention'].includes(rawLevel)
  ) {
    return 'watch'
  }

  if (
    ['warning', 'orange', 'abnormal', 'risk'].includes(rawLevel)
  ) {
    return 'warning'
  }

  if (
    ['danger', 'red', 'emergency', 'critical'].includes(rawLevel)
  ) {
    return 'danger'
  }

  const text =
    typeof item === 'string'
      ? item
      : String(item?.text || item?.label || item?.title || '')

  if (
    /(ปกติ|เรียบร้อย|ไม่พบ|คล่องตัว|เพียงพอ|ใช้งานได้|ชัดเจน|ต่อเนื่อง)/.test(text)
  ) {
    return 'normal'
  }

  if (
    /(เฝ้าระวัง|ระวัง|ฝนตก|ไฟมืด|มืด|เปียก|ลื่น|เบาบาง|ปานกลาง|ชะลอ|สังเกต)/.test(text)
  ) {
    return 'watch'
  }

  if (
    /(ไม่ปกติ|อุบัติเหตุ|รถติด|ก่อสร้าง|หนาแน่น|ติดขัด|เสี่ยง|สิ่งกีดขวาง)/.test(text)
  ) {
    return 'warning'
  }

  if (
    /(ฉุกเฉิน|ร้ายแรง|น้ำท่วม|ปิดถนน|เพลิงไหม้|อุบัติเหตุใหญ่)/.test(text)
  ) {
    return 'danger'
  }

  return 'watch'
}


function sortInsightItems(items = []) {
  const priority = {
    green: 1,
    yellow: 2,
    orange: 3,
    red: 4,
    neutral: 5,
  }

  return getVisibleReportItems(
    items,
    Array.isArray(items) ? items.length : 0
  ).sort((a, b) => {
    return (
      priority[getListTone(a)] -
      priority[getListTone(b)]
    )
  })
}



function CctvAiReport({ profile }) {
  const [count, setCount] = useState(9)
  const [uploadMode, setUploadMode] = useState('collage')

  const [images, setImages] = useState([])
  
  const [cameraObservations, setCameraObservations] =
    useState([])

  const [collageFile, setCollageFile] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)


  const [report, setReport] = useState(() =>
    blankReport(profile?.agency || '')
  )

  const [centers, setCenters] = useState([])
  const [centerId, setCenterId] = useState(
    profile?.center_id
      ? String(profile.center_id)
      : ''
  )

  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const fileInputRef = useRef(null)
  const previewWrapperRef = useRef(null)
  const exportRef = useRef(null)
  const [previewScale, setPreviewScale] = useState(0.5)

  const canChooseCenter =
    ['admin', 'supervisor'].includes(profile?.role)


  /* =============================
     LOAD CENTERS
  ============================= */

  
useEffect(() => {
  let cancelled = false

  const load = async () => {
    const { data, error } = await supabase
      .from('centers')
      .select('id, name, active')
      .eq('active', true)
      .order('name')

    if (cancelled) return

    if (error) {
      console.error('Load centers error:', error)

      setMessage(
        `โหลดรายชื่อศูนย์ไม่สำเร็จ: ${error.message}`
      )
      return
    }

    const rows = data || []

    setCenters(rows)

    const ownCenter = rows.find(
      (item) =>
        String(item.id) ===
        String(profile?.center_id)
    )

    if (ownCenter) {
    setReport((old) => ({
        ...old,
        station: stationFromCenter(ownCenter.name),
        centerName: ownCenter.name,
    }))
    }

    if (rows.length === 0) {
      setMessage(
        'ไม่พบรายชื่อศูนย์ที่เปิดใช้งาน กรุณาตรวจสอบสิทธิ์การเข้าถึงข้อมูล'
      )
    }
  }

  load()

  return () => {
    cancelled = true
  }
}, [profile?.center_id])


/* =============================
   LOAD CENTER LOGO
   ใช้โลโก้เดียวกับ DailyCctvReport
============================= */

useEffect(() => {
  let cancelled = false

  const loadCenterLogo = async () => {
    // ล้างโลโก้ของศูนย์ก่อนหน้า
    setReport((old) => ({
      ...old,
      centerLogo: '',
    }))

    if (!centerId) return

    try {
      // 1. อ่านตำแหน่งโลโก้ของศูนย์
      const {
        data: setting,
        error: settingError,
      } = await supabase
        .from('center_report_settings')
        .select('logo_path')
        .eq('center_id', String(centerId))
        .maybeSingle()

      if (settingError) {
        throw settingError
      }

      if (!setting?.logo_path) {
        console.warn(
          'ศูนย์นี้ยังไม่มีโลโก้:',
          centerId
        )
        return
      }

      // 2. ดาวน์โหลดจาก Private Storage
      const {
        data: logoBlob,
        error: downloadError,
      } = await supabase
        .storage
        .from('center-report-assets')
        .download(setting.logo_path)

      if (downloadError) {
        throw downloadError
      }

      if (!logoBlob) {
        throw new Error('ไม่พบไฟล์โลโก้')
      }

      // 3. แปลงรูปเป็น Data URL
      const dataUrl = await new Promise(
        (resolve, reject) => {
          const reader = new FileReader()

          reader.onload = () => {
            resolve(reader.result)
          }

          reader.onerror = () => {
            reject(
              new Error('อ่านไฟล์โลโก้ไม่สำเร็จ')
            )
          }

          reader.readAsDataURL(logoBlob)
        }
      )

      // 4. นำโลโก้ไปใส่ในรายงาน
      if (!cancelled) {
        setReport((old) => ({
          ...old,
          centerLogo: dataUrl,
        }))
      }

    } catch (error) {
      if (!cancelled) {
        console.error(
          'Load center logo error:',
          error
        )

        setMessage(
          `โหลดโลโก้ศูนย์ไม่สำเร็จ: ${error.message}`
        )
      }
    }
  }

  loadCenterLogo()

  return () => {
    cancelled = true
  }
}, [centerId])


  /* =============================
     PREVIEW SCALE
  ============================= */

  useEffect(() => {
    const node = previewWrapperRef.current
    if (!node) return

    const update = () => {
      const width = node.clientWidth || 800
      setPreviewScale(Math.min(1, width / 1600))
    }

    update()

    const observer = new ResizeObserver(update)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])


  /* =============================
     REPORT EDITING
  ============================= */

  const update = (field, value) => {
    setReport((old) => ({
      ...old,
      [field]: value,
    }))
  }

  const updateList = (field, index, value) => {
    setReport((old) => {
      const items = [...old[field]]
      items[index] = value

      return {
        ...old,
        [field]: items,
      }
    })
  }

  
const resetAnalysis = () => {
  setCameraObservations([])

  setReport((old) => ({
    ...blankReport(
      old.station,
      old.centerName
    ),
    centerLogo: old.centerLogo,
    location: old.location,
    reportDate: old.reportDate,
  }))
}


  
const selectCenter = (id) => {
  setCenterId(id)

  const center = centers.find(
    (item) => String(item.id) === String(id)
  )

  setReport((old) => ({
    ...old,
    station: center
      ? stationFromCenter(center.name)
      : '',
    centerName: center?.name || '',
    centerLogo: '',
  }))
}



  /* =============================
     UPLOAD
  ============================= */

  const changeCount = async (value) => {
    const nextCount = Number(value)

    setCount(nextCount)
    resetAnalysis()
    setMessage('')

    if (uploadMode === 'collage' && collageFile) {
      setBusy('upload')

      try {
        setImages(
          await splitCollage(collageFile, nextCount)
        )
      } catch (error) {
        setImages([])
        setMessage(error.message)
      } finally {
        setBusy('')
      }
    } else {
      setImages((old) => old.slice(0, nextCount))
    }
  }

  const changeMode = (mode) => {
    setUploadMode(mode)
    setImages([])
    setCollageFile(null)
    resetAnalysis()
    setMessage('')
  }

  
/* =============================
   UPLOAD FILES — 3 METHODS
   1. เลือกไฟล์
   2. ลากวาง
   3. Ctrl + V
============================= */

const processFiles = async (incomingFiles) => {
  if (busy) return

  const files = Array.from(incomingFiles || [])

  if (!files.length) return

  if (
    (uploadMode === 'collage' && files.length !== 1) ||
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
      'รองรับ JPG, PNG และ WEBP ขนาดไม่เกิน 15 MB ต่อภาพ'
    )
    return
  }

  setBusy('upload')
  setMessage('')

  try {
    if (uploadMode === 'collage') {
      const file = files[0]

      const result = await splitCollage(file, count)

      setCollageFile(file)
      setImages(result)
    } else {
      const result = []

      for (const file of files) {
        result.push({
          name: file.name || `ภาพ ${result.length + 1}`,
          src: await compressImage(file),
        })
      }

      setCollageFile(null)
      setImages(result)
    }

    resetAnalysis()

    setMessage(
      'นำเข้าภาพสำเร็จ พร้อมตรวจสอบและวิเคราะห์'
    )
  } catch (error) {
    setImages([])
    setMessage(
      error?.message || 'ไม่สามารถนำเข้าภาพได้'
    )
  } finally {
    setBusy('')
  }
}

/* เลือกไฟล์จากเครื่อง */

const handleFiles = async (event) => {
  const files = Array.from(event.target.files || [])

  event.target.value = ''

  await processFiles(files)
}

/* รองรับ Ctrl + V จาก Clipboard
   โดยไม่รบกวนการวางข้อความในฟอร์ม */

useEffect(() => {
  const handlePaste = (event) => {
    if (busy) return

    const target = event.target

    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable], [role="textbox"]'
      )
    ) {
      return
    }

    const items = Array.from(
      event.clipboardData?.items || []
    )

    const imageFiles = items
      .filter(
        (item) =>
          item.kind === 'file' &&
          item.type.startsWith('image/')
      )
      .map((item) => item.getAsFile())
      .filter(Boolean)

    if (!imageFiles.length) return

    event.preventDefault()

    void processFiles(imageFiles)
  }

  window.addEventListener('paste', handlePaste)

  return () => {
    window.removeEventListener('paste', handlePaste)
  }
})



  /* =============================
     AI ANALYSIS
  ============================= */

  const handleAnalyze = async () => {
    if (images.length !== count) {
      setMessage(
        `กรุณาอัปโหลดภาพให้ครบ ${count} มุมมอง`
      )
      return
    }

    if (!AI_URL) {
      setMessage(
        'ยังไม่ได้ตั้งค่า AI Backend (VITE_CCTV_AI_URL)'
      )
      return
    }

    setBusy('ai')
    setMessage('กำลังส่งภาพให้ AI วิเคราะห์...')

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      240000
    )

    try {
      const { data, error } =
        await supabase.auth.getSession()

      if (error) throw error

      const token = data.session?.access_token

      if (!token) {
        throw new Error('กรุณาเข้าสู่ระบบใหม่')
      }

      
      const collage = await buildCctvOverview(
        images,
        count
      )


      const response = await fetch(AI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        
        body: JSON.stringify({
            count,
            station: report.station,
            location: report.location,
            reportDate: report.reportDate,
            collage,
        }),

        signal: controller.signal,
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(
          payload.error || 'AI วิเคราะห์ไม่สำเร็จ'
        )
      }

      const result = payload.report
      
        setCameraObservations(
        Array.isArray(payload.observations)
            ? payload.observations
            : []
        )


      if (!result || typeof result !== 'object') {
        throw new Error('ข้อมูลตอบกลับจาก AI ไม่ถูกต้อง')
      }

      const str = (value, max = 400) =>
        typeof value === 'string'
          ? value.slice(0, max)
          : ''

      const list = (value, length, max = 160) =>
        Array.from({ length }, (_, index) =>
          str(
            Array.isArray(value) ? value[index] : '',
            max
          )
        )

      
        const allowed = [
        'ปกติ',
        'เฝ้าระวัง',
        'ผิดปกติ',
        'ฉุกเฉิน',
        'ไม่สามารถประเมินได้',
        ]

      setReport((old) => ({
        ...old,
        overall: allowed.includes(result.overall)
          ? result.overall
          : 'ไม่สามารถประเมินได้',
        
            safety: str(result.safety, 200),
            traffic: str(result.traffic, 200),
            abnormal: str(result.abnormal, 200),
            visibility: str(result.visibility, 200),

        findings: list(result.findings, 5),
        trafficFindings: list(
          result.trafficFindings, 3
        ),
        highlights: list(result.highlights, 3),
        conclusion: str(result.conclusion, 400),
      }))

      setMessage(
        'AI วิเคราะห์เสร็จแล้ว กรุณาตรวจทานก่อนส่งออก'
      )
    } catch (error) {
      setMessage(
        error.name === 'AbortError'
          ? 'หมดเวลารอ AI กรุณาลองใหม่'
          : error.message
      )
    } finally {
      clearTimeout(timer)
      setBusy('')
    }
  }


  /* =============================
     EXPORT
  ============================= */

  const download = (dataUrl, filename) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename

    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const handleExport = async (format) => {
    if (!exportRef.current) return

    setBusy('export')
    setMessage('กำลังสร้างไฟล์รายงาน...')

    try {
      await document.fonts.ready

      const options = {
        backgroundColor: '#ffffff',
        pixelRatio: 1,
        cacheBust: false,
      }

      const baseName =
        `AI_CCTV_${safeName(report.station)}_` +
        report.reportDate

      if (format === 'png') {
        const url = await toPng(
          exportRef.current,
          options
        )

        download(url, `${baseName}.png`)
      }

      if (format === 'jpg') {
        const url = await toJpeg(
          exportRef.current,
          { ...options, quality: 0.94 }
        )

        download(url, `${baseName}.jpg`)
      }

      if (format === 'pdf') {
        const url = await toJpeg(
          exportRef.current,
          { ...options, quality: 0.94 }
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

        pdf.save(`${baseName}.pdf`)
      }

      setMessage('สร้างไฟล์รายงานสำเร็จ')
    } catch (error) {
      console.error(error)

      setMessage(
        'ไม่สามารถส่งออกไฟล์ได้ กรุณาตรวจสอบภาพและลองใหม่'
      )
    } finally {
      setBusy('')
    }
  }

  
/* =============================
   COPY REPORT IMAGE TO CLIPBOARD
   PNG 1600 × 900
============================= */

const handleCopyImage = async () => {
  if (!exportRef.current || busy) return

  if (
    !window.isSecureContext ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === 'undefined'
  ) {
    setMessage(
      'เบราว์เซอร์ไม่รองรับการคัดลอกรูปภาพ กรุณาใช้ HTTPS หรือ localhost'
    )
    return
  }

  const node = exportRef.current

  setBusy('copy-image')
  setMessage('กำลังคัดลอกรูปรายงาน...')

  try {
    // สร้าง Promise ของภาพทันที
    // เพื่อรักษาสิทธิ์ Clipboard จากการคลิกปุ่ม

    const imagePromise = (async () => {
      await document.fonts.ready

      const dataUrl = await toPng(node, {
        backgroundColor: '#ffffff',
        pixelRatio: 1,
        cacheBust: false,
      })

      const response = await fetch(dataUrl)
      const blob = await response.blob()

      if (!blob.size) {
        throw new Error('ไม่สามารถสร้างรูปภาพได้')
      }

      return blob
    })()

    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': imagePromise,
      }),
    ])

    setMessage(
      'คัดลอกรูปรายงานสำเร็จ! สามารถกด Ctrl + V เพื่อวางภาพได้เลย'
    )

  } catch (error) {
    console.error('Copy report image:', error)

    setMessage(
      'คัดลอกรูปภาพไม่สำเร็จ กรุณาอนุญาตการใช้คลิปบอร์ด หรือใช้ปุ่ม JPG แทน'
    )
  } finally {
    setBusy('')
  }
}


  const handleCopy = async () => {
    const text = [
      'รายงานผลการวิเคราะห์ภาพกล้องวงจรปิด',
      `หน่วยงาน: ${report.station}`,
      `พื้นที่: ${report.location}`,
      `วันที่: ${thaiDate(report.reportDate)}`,
      `จำนวนกล้อง: ${count} มุมมอง`,
      '',
      `ผลการประเมินโดยรวม: ${report.overall}`,
      `ความเรียบร้อย: ${report.safety}`,
      `การจราจร: ${report.traffic}`,
      `เหตุผิดปกติ: ${report.abnormal}`,
      `ทัศนวิสัย: ${report.visibility}`,
      '',
      'ผลการตรวจสอบที่สำคัญ',
      
        ...getVisibleReportItems(report.findings, 5).map(
        (item, i) => `${i + 1}. ${item}`
        ),

      '',
      'สภาพการจราจร',
      
        ...getVisibleReportItems(report.trafficFindings, 3).map(
        (item, i) => `${i + 1}. ${item}`
        ),

      '',
      'เหตุการณ์น่าสนใจ',
      
        ...getVisibleReportItems(report.highlights, 3).map(
        (item, i) => `${i + 1}. ${item}`
        ),

      '',
      'ข้อสรุปเพื่อนำเรียนผู้บังคับบัญชา',
      report.conclusion,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setMessage('คัดลอกข้อความรายงานแล้ว')
    } catch {
      setMessage('คัดลอกไม่สำเร็จ')
    }
  }


  /* =============================
     EDITOR COMPONENTS
  ============================= */

  const field = (label, key, multiline = false) => (
    <label className="ai-field" key={key}>
      <span>{label}</span>

      {multiline ? (
        <textarea
          value={report[key]}
          onChange={(e) => update(key, e.target.value)}
          rows={4}
        />
      ) : (
        <input
          type="text"
          value={report[key]}
          onChange={(e) => update(key, e.target.value)}
        />
      )}
    </label>
  )

  const listEditor = (label, key) => (
    <div className="ai-editor-group" key={key}>
      <h4>{label}</h4>

      {report[key].map((value, index) => (
        <label className="ai-field" key={index}>
          <span>ข้อที่ {index + 1}</span>

          <textarea
            rows={2}
            value={value}
            onChange={(e) =>
              updateList(key, index, e.target.value)
            }
          />
        </label>
      ))}
    </div>
  )


  /* =============================
     RENDER
  ============================= */

  return (
    <div className="ai-cctv-page">

      <header className="ai-page-header">
        <div>
          <div className="ai-page-eyebrow">
            AI CCTV ANALYSIS
          </div>

          <h1>
            วิเคราะห์สถานการณ์จากภาพกล้องวงจรปิด
          </h1>

          <p>
            อัปโหลดภาพ วิเคราะห์สถานการณ์
            ตรวจทานข้อความ และจัดทำรายงาน
            สำหรับนำเรียนผู้บังคับบัญชา
          </p>
        </div>

        <div className="ai-page-header-icon">
          <BrainCircuit size={34} />
        </div>
      </header>


      <section className="ai-upload-panel">

        <div className="ai-section-title">
          <Images size={21} />
          <h2>ข้อมูลและภาพประกอบรายงาน</h2>
        </div>

        <div className="ai-form-grid">

          <label className="ai-field">
            <span>จำนวนกล้อง</span>
            <select
              value={count}
              disabled={!!busy}
              onChange={(e) => changeCount(e.target.value)}
            >
              {Object.keys(GRID_OPTIONS).map((n) => (
                <option value={n} key={n}>
                  {n} กล้อง
                </option>
              ))}
            </select>
          </label>

          <label className="ai-field">
            <span>ศูนย์ที่จัดทำรายงาน</span>

            {canChooseCenter ? (
              <select
                value={centerId}
                onChange={(e) =>
                  selectCenter(e.target.value)
                }
              >
                <option value="">-- เลือกศูนย์ --</option>

                {centers.map((center) => (
                  <option
                    key={center.id}
                    value={String(center.id)}
                  >
                    {center.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="ai-readonly">
                <Building2 size={17} />
                {centers.find(
                  (c) =>
                    String(c.id) === String(centerId)
                )?.name || profile?.agency || '-'}
              </div>
            )}
          </label>

          <label className="ai-field">
            <span>วันที่ตรวจสอบ</span>
            <input
              type="date"
              value={report.reportDate}
              onChange={(e) =>
                update('reportDate', e.target.value)
              }
            />
          </label>

          {field('สถานีตำรวจ / หน่วยงาน', 'station')}
          {field('บริเวณพื้นที่ตรวจสอบ', 'location')}

        </div>


        <div className="ai-upload-mode">
          <button
            type="button"
            className={
              uploadMode === 'collage' ? 'active' : ''
            }
            disabled={!!busy}
            onClick={() => changeMode('collage')}
          >
            <FileImage size={17} />
            ภาพรวมหลายกล้อง
          </button>

          <button
            type="button"
            className={
              uploadMode === 'separate' ? 'active' : ''
            }
            disabled={!!busy}
            onClick={() => changeMode('separate')}
          >
            <Images size={17} />
            ภาพแยกทีละกล้อง
          </button>
        </div>


        
{/* UPLOAD ZONE — CLICK / DRAG / PASTE */}

<div
  className={[
    'ai-upload-zone',
    isDragOver ? 'ai-upload-zone--dragging' : '',
    busy ? 'ai-upload-zone--disabled' : '',
  ].filter(Boolean).join(' ')}
  role="button"
  tabIndex={busy ? -1 : 0}
  aria-disabled={!!busy}
  aria-label="เลือกไฟล์ภาพ หรือลากวางภาพเพื่ออัปโหลด"
  onClick={() => {
    if (!busy) {
      fileInputRef.current?.click()
    }
  }}
  onKeyDown={(event) => {
    if (busy) return

    if (
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault()
      fileInputRef.current?.click()
    }
  }}
  onDragEnter={(event) => {
    event.preventDefault()
    if (!busy) setIsDragOver(true)
  }}
  onDragOver={(event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect =
      busy ? 'none' : 'copy'

    if (!busy) setIsDragOver(true)
  }}
  onDragLeave={(event) => {
    if (
      !event.currentTarget.contains(
        event.relatedTarget
      )
    ) {
      setIsDragOver(false)
    }
  }}
  onDrop={(event) => {
    event.preventDefault()
    setIsDragOver(false)

    if (busy) return

    void processFiles(
      Array.from(event.dataTransfer.files || [])
    )
  }}
>
  <div className="ai-upload-zone-icon">
    <Upload size={32} strokeWidth={1.8} />
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
    รองรับ JPG, PNG, WEBP ไม่เกิน 15 MB ต่อภาพ
  </span>
</div>

<input
  ref={fileInputRef}
  className="ai-upload-native-input"
  type="file"
  accept="image/jpeg,image/png,image/webp"
  multiple={uploadMode === 'separate'}
  disabled={!!busy}
  onChange={handleFiles}
  tabIndex={-1}
  aria-label="เลือกไฟล์ภาพกล้องวงจรปิด"
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
          {Array.from({ length: count }, (_, index) => (
            <div className="ai-upload-thumbnail" key={index}>
              {images[index] ? (
                <img
                  src={images[index].src}
                  alt={`กล้อง ${index + 1}`}
                />
              ) : (
                <Camera size={23} />
              )}

              <span>กล้อง {index + 1}</span>
            </div>
          ))}
        </div>


        <button
          type="button"
          className="ai-analyze-button"
          disabled={!!busy || images.length !== count}
          onClick={handleAnalyze}
        >
          {busy === 'ai' ? (
            <Loader2 size={20} className="ai-spin" />
          ) : (
            <BrainCircuit size={20} />
          )}

          {busy === 'ai'
            ? 'AI กำลังวิเคราะห์ภาพ...'
            : 'เริ่มวิเคราะห์ภาพด้วย AI'}
        </button>

        {message && (
          <div className="ai-message" role="status">
            {message}
          </div>
        )}
      </section>


      
        {/* =========================
            CAMERA OBSERVATIONS
        ========================= */}

        {cameraObservations.length > 0 && (

        <section className="ai-upload-panel ai-camera-observations">

            <div className="ai-section-title">
            <Camera size={21} />
            <h2>บันทึกข้อสังเกตรายกล้องจาก AI</h2>
            </div>

            <p className="ai-camera-observations-note">
            รายละเอียดที่ AI ตรวจพบจากภาพนิ่งแต่ละมุมมอง
            สำหรับเจ้าหน้าที่ใช้ตรวจสอบประกอบรายงาน
            </p>

            <div className="ai-camera-observations-grid">

            {cameraObservations.map((item) => (

                <details
                key={item.camera}
                className="ai-camera-observation-card"
                >
                <summary>
                    <Camera size={17} />
                    มุมมองที่ {item.camera}
                </summary>

                <p>{item.observation}</p>

                </details>

            ))}

            </div>

        </section>

        )}



      {/* EDIT + PREVIEW */}

      <div className="ai-workspace">

        <aside className="ai-editor-panel">

          <div className="ai-section-title">
            <FileText size={21} />
            <h2>แก้ไขผลการวิเคราะห์</h2>
          </div>

          <div className="ai-editor-group">
            <h4>1. สรุปผลการประเมิน</h4>

            <label className="ai-field">
              <span>ผลประเมินโดยรวม</span>
              <select
                value={report.overall}
                onChange={(e) =>
                  update('overall', e.target.value)
                }
              >
                
                {[
                'รอการวิเคราะห์',
                'ปกติ',
                'เฝ้าระวัง',
                'ผิดปกติ',
                'ฉุกเฉิน',
                'ไม่สามารถประเมินได้',
                ].map((value) => (
                <option key={value}>{value}</option>
                ))}

              </select>
            </label>

            {field('ความเรียบร้อย', 'safety')}
            {field('สภาพการจราจร', 'traffic')}
            {field('เหตุผิดปกติ', 'abnormal')}
            {field('สภาพอากาศ/ทัศนวิสัย', 'visibility')}
          </div>

          {listEditor(
            '2. ผลการตรวจสอบที่สำคัญ',
            'findings'
          )}

          {listEditor(
            '3. วิเคราะห์สภาพการจราจร',
            'trafficFindings'
          )}

          {listEditor(
            '4. เหตุการณ์น่าสนใจ',
            'highlights'
          )}

          <div className="ai-editor-group">
            <h4>5. ข้อสรุปนำเรียนผู้บังคับบัญชา</h4>
            {field('ข้อความสรุป', 'conclusion', true)}
          </div>

        </aside>


        <section className="ai-preview-panel">

          <div className="ai-preview-toolbar">
            <div>
              <h2>พรีวิวรายงาน</h2>
              <p>ขนาด 1600 × 900 พิกเซล (16:9)</p>
            </div>

            <span className="ai-preview-scale">
              {Math.round(previewScale * 100)}%
            </span>
          </div>

          <div
            className="ai-preview-wrapper"
            ref={previewWrapperRef}
          >
            <div
              style={{
                width: 1600,
                height: 900 * previewScale,
              }}
            >
              <div
                style={{
                  width: 1600,
                  height: 900,
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
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
            title="คัดลอกรูปรายงาน เพื่อวางใน LINE หรือแชต"
            >
            <Copy size={17} />
            คัดลอก
            </button>


            <button
              type="button"
              disabled={!!busy}
              onClick={() => handleExport('jpg')}
            >
              <Download size={17} />
              JPG
            </button>

            <button
              type="button"
              disabled={!!busy}
              onClick={() => handleExport('pdf')}
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
            กรุณาตรวจสอบความถูกต้องของผลวิเคราะห์
            และภาพประกอบทุกมุมมองก่อนนำเรียน
            ผู้บังคับบัญชา
          </div>

        </section>
      </div>


      {/* FULL-SIZE EXPORT TARGET */}

      <div className="ai-export-render" aria-hidden="true">
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
