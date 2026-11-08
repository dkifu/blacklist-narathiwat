import {
  useEffect,
  useRef,
  useState,
} from 'react'

import { supabase } from '../../lib/supabase'
import XLSX from 'xlsx-js-style'


import {
  Upload,
  FileSpreadsheet,
  Download,
  RefreshCw,
  Building2,
  UserRound,
  CheckCircle2,
} from 'lucide-react'

import './AlertReport.css'

const CENTER_TO_STATION = {
  'ศูนย์นราธิวาส': 'เมืองนราธิวาส',
  'ศูนย์ตากใบ': 'ตากใบ',
  'ศูนย์สุไหงโกลก': 'สุไหงโกลก',
  'ศูนย์ปัตตานี': 'เมืองปัตตานี',
  'ศูนย์หาดใหญ่': 'หาดใหญ่',
  'ศูนย์เบตง': 'เบตง',
}


const getStationName = (center) => {

  if (!center?.name) {
    return ''
  }

  return (
    CENTER_TO_STATION[center.name] ||
    center.name.replace(/^ศูนย์/, '').trim()
  )
}

const parseAlertDateTime = (value) => {

  if (!value) {
    return null
  }

  const text =
    String(value).trim()

  const match =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
    )

  if (!match) {
    return null
  }

  const [
    ,
    day,
    month,
    year,
    hour,
    minute,
    second,
  ] = match

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day)
  )

  const time =
    (
      Number(hour) * 3600 +
      Number(minute) * 60 +
      Number(second)
    ) / 86400

  return {
    date,
    time,
  }
}

const normalizePlateForMatch = (value) => {

  const thaiDigits =
    '๐๑๒๓๔๕๖๗๘๙'

  return String(value || '')
    .normalize('NFKC')
    .replace(
      /[๐-๙]/g,
      (digit) =>
        String(
          thaiDigits.indexOf(digit)
        )
    )
    .replace(
      /[\s\u00A0\u200B-\u200D\uFEFF\-–—.]/g,
      ''
    )
    .toUpperCase()
}


const normalizeProvinceForMatch = (value) => {

  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^จังหวัด\s*/i, '')
    .replace(/^จ\.\s*/i, '')
    .replace(/\s+/g, '')
}


const makePlateMatchKey = (
  plate,
  province
) => {

  return (
    normalizePlateForMatch(plate) +
    '|' +
    normalizeProvinceForMatch(province)
  )
}


const blobToDataUrl = (blob) => {

  return new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader()

      reader.onload =
        () => resolve(reader.result)

      reader.onerror =
        () => reject(reader.error)

      reader.readAsDataURL(blob)
    }
  )
}


const parseTemplateDateTime = (value) => {

  const text =
    String(value || '').trim()

  const match =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
    )

  if (!match) {
    return {
      date: '',
      time: '',
    }
  }

  const [
    ,
    day,
    month,
    year,
    hour,
    minute,
  ] = match

  const pad =
    (number) =>
      String(number).padStart(2, '0')

  return {
    date:
      `${year}-${pad(month)}-${pad(day)}`,

    time:
      `${pad(hour)}:${pad(minute)}`,
  }
}


function AlertReport({ profile }) {

  // VSS05_TEMP_TAB_20261108 — แยกข้อมูลจริงกับแบบฟอร์มชั่วคราว
  const [activeReportTab, setActiveReportTab] = useState('official')

  const fileInputRef = useRef(null)

  const reportFrameRef = useRef(null)
  const tempReportFrameRef = useRef(null)

  const [selectedFile, setSelectedFile] =
    useState(null)

  const [centers, setCenters] =
    useState([])

  const [
    selectedCenterId,
    setSelectedCenterId,
  ] = useState(
    profile?.role === 'center' &&
    profile?.center_id
      ? String(profile.center_id)
      : ''
  )

  const [inspectors, setInspectors] =
    useState([])

  const [
    selectedInspector,
    setSelectedInspector,
  ] = useState('')

  const [
    centersLoading,
    setCentersLoading,
  ] = useState(false)

  const [
    inspectorsLoading,
    setInspectorsLoading,
  ] = useState(false)

  const [convertedFile, setConvertedFile] =
    useState(null)

  const [isVss05Confirmed, setIsVss05Confirmed] =
    useState(false)  


  const isAdmin =
    profile?.role === 'admin'

  const isSupervisor =
    profile?.role === 'supervisor'

  const isCenter =
    profile?.role === 'center'

  const canChooseCenter =
    isAdmin || isSupervisor

  useEffect(() => {

    const loadCenters = async () => {

      setCentersLoading(true)

      const { data, error } =
        await supabase
          .from('centers')
          .select(
            'id, name, code, active'
          )
          .eq('active', true)
          .order('name')

      if (error) {

        console.error(
          'Load centers error:',
          error
        )

        setCenters([])
        setCentersLoading(false)

        return
      }

      setCenters(data || [])
      setCentersLoading(false)
    }

    loadCenters()

  }, [])  

  useEffect(() => {

    if (
      isCenter &&
      profile?.center_id
    ) {

      setSelectedCenterId(
        String(profile.center_id)
      )
    }

  }, [
    isCenter,
    profile?.center_id,
  ])

  const selectedCenter =
    centers.find(
      (center) =>
        String(center.id) ===
        String(selectedCenterId)
    )

  useEffect(() => {

    const loadInspectors = async () => {

      setSelectedInspector('')
      setInspectors([])
      setConvertedFile(null)
      setIsVss05Confirmed(false)

      if (!selectedCenterId) {
        setInspectorsLoading(false)
        return
      }

      setInspectorsLoading(true)

      const { data, error } =
        await supabase
          .from('center_members')
          .select(
            'id, name, rank, position, center_id, active'
          )
          .eq(
            'center_id',
            selectedCenterId
          )
          .eq('active', true)
          .order('name')

      if (error) {

        console.error(
          'Load inspectors error:',
          error
        )

        setInspectors([])
        setInspectorsLoading(false)

        return
      }

      setInspectors(data || [])
      setInspectorsLoading(false)
    }

    loadInspectors()

  }, [selectedCenterId])  


  const reportUrl =
    `${import.meta.env.BASE_URL}templates/VSS05_AlertReport.html`


  const handleFileChange = (event) => {

    const file =
      event.target.files?.[0]

    if (!file) {
      return
    }

    setSelectedFile(file)

    /*
      เมื่อมีการเลือกไฟล์ใหม่
      ให้ยกเลิกไฟล์ VSS05 เดิม
    */
    setConvertedFile(null)
    setIsVss05Confirmed(false)
  }


  const handleResetFile = () => {

    setSelectedFile(null)
    setConvertedFile(null)
    setIsVss05Confirmed(false)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const buildPhuketEyesPayload =
  async (sourceRows) => {

    /*
     * โหลดทะเบียนรถในระบบ
     */
    const {
      data: vehicleRows,
      error: vehicleError,
    } = await supabase
      .from('vehicles')
      .select(`
        id,
        plate_letters,
        plate_number,
        province,
        thumbnail_path,
        case_status,
        created_at
      `)
      .order(
        'created_at',
        {
          ascending: false,
        }
      )

    if (vehicleError) {
      throw vehicleError
    }


    /*
     * ทำ Index ทะเบียนในระบบ
     *
     * ถ้ามีทะเบียนซ้ำ
     * เลือกรถ open ก่อน
     * และเลือกรายการใหม่กว่า
     */
    const sortedVehicles =
      [...(vehicleRows || [])]
        .sort((a, b) => {

          const aOpen =
            a.case_status === 'open'

          const bOpen =
            b.case_status === 'open'

          if (aOpen !== bOpen) {
            return aOpen ? -1 : 1
          }

          return (
            new Date(
              b.created_at || 0
            ) -
            new Date(
              a.created_at || 0
            )
          )
        })


    const vehicleMap =
      new Map()


    sortedVehicles.forEach(
      (vehicle) => {

        const plate =
          [
            vehicle.plate_letters,
            vehicle.plate_number,
          ]
            .filter(Boolean)
            .join('')

        const key =
          makePlateMatchKey(
            plate,
            vehicle.province
          )

        if (
          key &&
          vehicle.thumbnail_path &&
          !vehicleMap.has(key)
        ) {
          vehicleMap.set(
            key,
            vehicle
          )
        }
      }
    )


    /*
     * รวมข้อมูล Excel
     * ทะเบียนเดียวกัน = รถ 1 คัน
     * แต่มีหลายจุดพบเหตุ
     */
    const groupedVehicles =
      new Map()

    const allDateTimes = []


    sourceRows.forEach((row) => {

      const plate =
        String(
          row['ทะเบียนรถ'] || ''
        ).trim()

      const province =
        String(
          row['จังหวัด'] || ''
        ).trim()


      if (!plate) {
        return
      }


      const key =
        makePlateMatchKey(
          plate,
          province
        )


      const dateTime =
        parseTemplateDateTime(
          row['วันที่-เวลา']
        )


      if (dateTime.date) {

        allDateTimes.push(
          `${dateTime.date}T${
            dateTime.time ||
            '00:00'
          }`
        )
      }


      if (
        !groupedVehicles.has(key)
      ) {

        groupedVehicles.set(
          key,
          {
            vss05Key: key,

            plate,
            prov: province,

            owner:
              String(
                row['เจ้าของเรื่อง'] ||
                ''
              ).trim(),

            type:
              String(
                row['รายละเอียดคดี'] ||
                ''
              ).trim(),

             

            s: [],

            imageDataUrl: '',
          }
        )
      }


      const vehicle =
        groupedVehicles.get(key)


      /*
       * ถ้าแถวแรกไม่มีข้อมูล
       * แต่แถวถัดไปมี
       */
      if (
        !vehicle.owner &&
        row['เจ้าของเรื่อง']
      ) {
        vehicle.owner =
          String(
            row['เจ้าของเรื่อง']
          ).trim()
      }


      if (
        !vehicle.type &&
        row['รายละเอียดคดี']
      ) {
        vehicle.type =
          String(
            row['รายละเอียดคดี']
          ).trim()
      }


      


      vehicle.s.push({
        place:
          String(
            row['จุดที่พบ'] || ''
          ).trim(),

        d: dateTime.date,

        t: dateTime.time,
      })
    })


    /*
     * ดึง Thumbnail
     * เฉพาะรถที่ทะเบียนตรงกัน
     */
    await Promise.all(

      [...groupedVehicles.entries()]
        .map(
          async ([key, item]) => {

            const vehicle =
              vehicleMap.get(key)

            if (
              !vehicle?.thumbnail_path
            ) {
              return
            }


            const {
              data: thumbnailBlob,
              error: thumbnailError,
            } =
              await supabase.storage
                .from(
                  'vehicle-images'
                )
                .download(
                  vehicle.thumbnail_path
                )


            if (
              thumbnailError ||
              !thumbnailBlob
            ) {

              console.warn(
                'โหลด Thumbnail ไม่สำเร็จ:',
                key,
                thumbnailError
              )

              return
            }


            try {

              item.imageDataUrl =
                await blobToDataUrl(
                  thumbnailBlob
                )

            } catch (error) {

              console.warn(
                'แปลง Thumbnail ไม่สำเร็จ:',
                key,
                error
              )
            }
          }
        )
    )


    /*
     * หาวันเริ่ม / วันจบ
     */
    
        
    /* =========================================
      ค่าเริ่มต้นของวันที่รายงานประจำวัน
      วันที่รายงาน = วันนี้
      ช่วงสถิติ = เมื่อวาน 00:00 - 23:59
    ========================================= */

    const now = new Date()

    const pad = (number) =>
      String(number).padStart(2, '0')

    const toLocalISO = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1
    )

    const reportDate = toLocalISO(now)
    const statisticsDate = toLocalISO(yesterday)

    return {
      reportDate,

      start: {
        d: statisticsDate,
        t: '00:00',
      },

      end: {
        d: statisticsDate,
        t: '23:59',
      },

      face: [],
      lpr: [...groupedVehicles.values()],
    }


    
  }

  const sendToPhuketEyes =
  (payload) => {

    const frame =
      (activeReportTab === 'temporary' ? tempReportFrameRef.current : reportFrameRef.current)
    if (!frame) {
      return
    }

    const send = () => {

      frame.contentWindow
        ?.postMessage(
          {
            type:
              'LOAD_VSS05_DATA',

            payload,
          },

          window.location.origin
        )
    }


    try {

      if (
        frame.contentDocument
          ?.readyState === 'complete'
      ) {
        send()
      } else {

        frame.addEventListener(
          'load',
          send,
          {
            once: true,
          }
        )
      }

    } catch {
      send()
    }
  }


  const handleConvert = async () => {

  if (
    !selectedFile ||
    !selectedCenterId ||
    !selectedInspector
  ) {
    return
  }


  try {

    setConvertedFile(null)
    setIsVss05Confirmed(false)


    /*
     * ผู้ตรวจสอบ
     */
    const inspector =
      inspectors.find(
        (person) =>
          String(person.id) ===
          String(selectedInspector)
      )


    if (!inspector) {

      window.alert(
        'ไม่พบข้อมูลผู้ตรวจสอบ'
      )

      return
    }


    /*
     * อ่าน alert_export.xlsx
     */
    const arrayBuffer =
      await selectedFile.arrayBuffer()


    const workbook =
      XLSX.read(
        arrayBuffer,
        {
          type: 'array',
        }
      )


    const sourceSheetName =
      workbook.SheetNames[0]


    const sourceSheet =
      workbook.Sheets[
        sourceSheetName
      ]


    const sourceRows =
      XLSX.utils.sheet_to_json(
        sourceSheet,
        {
          defval: '',
          raw: false,
        }
      )


    /*
     * ตรวจโครงสร้างไฟล์
     */
    const requiredColumns = [
      'วันที่-เวลา',
      'ทะเบียนรถ',
      'จังหวัด',
      'จุดที่พบ',
      'เจ้าของเรื่อง',
      'รายละเอียดคดี',
      'แผนเผชิญเหตุ',
    ]


    const firstRow =
      sourceRows[0]


    if (!firstRow) {

      window.alert(
        'ไม่พบข้อมูลในไฟล์ alert_export'
      )

      return
    }


    const missingColumns =
      requiredColumns.filter(
        (column) =>
          !Object.prototype.hasOwnProperty.call(
            firstRow,
            column
          )
      )


    if (missingColumns.length > 0) {

      window.alert(
        'รูปแบบไฟล์ไม่ถูกต้อง\n\n' +
        'ไม่พบคอลัมน์: ' +
        missingColumns.join(', ')
      )

      return
    }


    /*
     * สภ ตามศูนย์
     */
    const stationName =
      getStationName(
        selectedCenter
      )


    /*
     * Mapping alert_export → VSS05
     */
    // แถวข้อมูลที่ใช้สร้าง VSS05
          const reportSourceRows = sourceRows.filter(
            (row) =>
              String(row['วันที่-เวลา'] || '').trim()
          )

          // สร้าง Key ตามลำดับแถวจริงใน Excel
          const rowKeys = reportSourceRows.map(
            (row) =>
              makePlateMatchKey(
                row['ทะเบียนรถ'],
                row['จังหวัด']
              )
          )

          // ตรวจสอบทะเบียนก่อนสร้างรายงาน
          if (
            reportSourceRows.some(
              (row) =>
                !String(row['ทะเบียนรถ'] || '').trim()
            )
          ) {
            window.alert(
              'พบรายการที่มีวันที่แจ้งเตือน แต่ไม่มีทะเบียนรถ\n' +
              'กรุณาตรวจสอบไฟล์ Excel ก่อนแปลง'
            )
            return
          }

          // สร้างข้อมูล Excel
          const outputRows = reportSourceRows.map(
            (row) => {

          const dateTime =
            parseAlertDateTime(
              row['วันที่-เวลา']
            )


          return {

            'วัน Alert':
              dateTime?.date || '',

            'เวลา Alert':
              dateTime?.time ?? '',

            'สภ':
              stationName,

            'ด่านตรวจ':
              row['จุดที่พบ'] || '',

            'ป้ายทะเบียน':
              [
                row['ทะเบียนรถ'],
                row['จังหวัด'],
              ]
                .filter(Boolean)
                .join(' '),

            'ผลการตรวจสอบข้อมูล':
              '',

            'หน่วยงานรับผิดชอบ':
              row['เจ้าของเรื่อง'] || '',

            'รายละเอียดคดี':
              row['รายละเอียดคดี'] || '',

            'การปฎิบัติงาน':
              row['แผนเผชิญเหตุ'] || '',

            'ผลการปฎิบัติงาน':
              '',

            'ข้อมูลที่ผิด':
              '-',

            'ชื่อ-นามสกุล ผู้ตรวจสอบ':
              inspector.name || '',
          }

        })


    /*
     * สร้าง Worksheet VSS05
     */
    
    const outputSheet =
      XLSX.utils.json_to_sheet(
        outputRows,
        {
          header: [
            'วัน Alert',
            'เวลา Alert',
            'สภ',
            'ด่านตรวจ',
            'ป้ายทะเบียน',
            'ผลการตรวจสอบข้อมูล',
            'หน่วยงานรับผิดชอบ',
            'รายละเอียดคดี',
            'การปฎิบัติงาน',
            'ผลการปฎิบัติงาน',
            'ข้อมูลที่ผิด',
            'ชื่อ-นามสกุล ผู้ตรวจสอบ',
          ],

          cellDates: true,
        }
      )


    /*
    * จัดข้อความให้อยู่กึ่งกลาง
    */
    const range =
      XLSX.utils.decode_range(
        outputSheet['!ref']
      )

    for (
      let row = range.s.r;
      row <= range.e.r;
      row += 1
    ) {

      for (
        let col = range.s.c;
        col <= range.e.c;
        col += 1
      ) {

        const cellAddress =
          XLSX.utils.encode_cell({
            r: row,
            c: col,
          })

        const cell =
          outputSheet[cellAddress]

        if (!cell) {
          continue
        }

        cell.s = {
          alignment: {
            horizontal: 'center',
            vertical: 'center',
            wrapText: true,
          },
        }
      }
    }


    
    /*
     * Format วันที่ / เวลา
     */
    for (
      let rowNumber = 2;
      rowNumber <=
        outputRows.length + 1;
      rowNumber += 1
    ) {

      const dateCell =
        outputSheet[
          `A${rowNumber}`
        ]

      const timeCell =
        outputSheet[
          `B${rowNumber}`
        ]


      if (dateCell) {
        dateCell.z =
          'dd/mm/yyyy'
      }


      if (timeCell) {
        timeCell.z =
          'hh:mm:ss'
      }

    }


    /*
     * ความกว้าง Column
     */
    outputSheet['!cols'] = [

      { wch: 14 }, // วัน
      { wch: 12 }, // เวลา
      { wch: 20 }, // สภ
      { wch: 42 }, // ด่าน
      { wch: 24 }, // ป้ายทะเบียน
      { wch: 22 }, // ตรวจสอบ
      { wch: 30 }, // หน่วยงาน
      { wch: 40 }, // คดี
      { wch: 55 }, // การปฏิบัติ
      { wch: 22 },
      { wch: 22 },
      { wch: 30 }, // ผู้ตรวจสอบ

    ]


    /*
     * สร้าง Workbook ใหม่
     */
    const outputWorkbook =
      XLSX.utils.book_new()


    XLSX.utils.book_append_sheet(
      outputWorkbook,
      outputSheet,
      'รายละเอียดรถแจ้งเตือน'
    )


    /*
     * แปลงเป็นไฟล์ XLSX
     * แต่ยังไม่ Download
     */
    const outputBuffer =
      XLSX.write(
        outputWorkbook,
        {
          bookType: 'xlsx',
          type: 'array',
          cellDates: true,
        }
      )


    const blob =
      new Blob(
        [outputBuffer],
        {
          type:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      )


    setConvertedFile({
      blob,

      // เก็บ Workbook สำหรับแก้ข้อมูลหลังยืนยัน
      workbook: outputWorkbook,

      // Key ที่ตรงกับแถวใน Excel
      rowKeys,

      fileName:
        `VSS05_${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`,

      rowCount: outputRows.length,
    })

    /*
    * ส่งข้อมูลเข้า Phuket Eyes
    */
    try {

      const phuketEyesPayload =
        await buildPhuketEyesPayload(
          reportSourceRows
        )

      sendToPhuketEyes(
        phuketEyesPayload
      )

    } catch (templateError) {

      console.error(
        'Load Phuket Eyes error:',
        templateError
      )

      window.alert(
        'สร้าง Excel VSS05 สำเร็จแล้ว\n' +
        'แต่ไม่สามารถเติมข้อมูลเข้า Phuket Eyes ได้'
      )
    }


  } catch (error) {

    console.error(
      'Convert VSS05 error:',
      error
    )


    window.alert(
      'ไม่สามารถแปลงไฟล์ VSS05 ได้'
    )
  }

}


const handleVss05Confirm = () => {
  if (!convertedFile) return

  (activeReportTab === 'temporary' ? tempReportFrameRef.current : reportFrameRef.current)?.contentWindow?.postMessage(
    {
      type: 'REQUEST_VSS05_CONFIRMATION',
    },
    window.location.origin
  )
}


/* ==================================================
   VSS05 - รับข้อมูลที่ยืนยันแล้วจาก Phuket Eyes
================================================== */

useEffect(() => {

  const handleVss05Message = (event) => {

    // รับเฉพาะ iframe รายงานในเว็บไซต์เดียวกัน
    if (
      event.origin !== window.location.origin ||
      event.source !== (activeReportTab === 'temporary' ? tempReportFrameRef.current : reportFrameRef.current)?.contentWindow
    ) {
      return
    }

    const message = event.data

    if (!message || typeof message !== 'object') {
      return
    }

    // เมื่อผู้ใช้แก้ข้อมูลหลังยืนยัน
    if (message.type === 'VSS05_CONFIRMATION_RESET') {
      setIsVss05Confirmed(false)
      return
    }

    if (message.type !== 'VSS05_DATA_CONFIRMED') {
      return
    }

    // ตรวจสอบไฟล์ต้นฉบับที่แปลงไว้
    if (
      !convertedFile?.workbook ||
      !Array.isArray(convertedFile.rowKeys) ||
      !Array.isArray(message.lpr)
    ) {
      setIsVss05Confirmed(false)
      return
    }

    try {

      const resultMap = new Map()

      // รับค่าล่าสุดที่ผู้ใช้ตรวจสอบแล้ว
      for (const item of message.lpr) {

        const key = String(
          item.vss05Key || ''
        ).trim()

        // รถที่เพิ่มเองและไม่มีแถวใน Excel
        if (!key) continue

        if (resultMap.has(key)) {
          throw new Error(
            `พบรหัสทะเบียนซ้ำในข้อมูลยืนยัน: ${key}`
          )
        }

        resultMap.set(key, {
          result: String(item.result || '').trim(),
          arrest: String(item.arrest || '').trim(),
        })
      }

      // ตรวจสอบว่ารถจาก Excel ทุกคันได้รับผล
      const missingKeys = [
        ...new Set(convertedFile.rowKeys)
      ].filter(
        (key) => !resultMap.has(key)
      )

      if (missingKeys.length > 0) {
        throw new Error(
          `ไม่พบผลตรวจสอบของรถ ${missingKeys.length} ทะเบียน\n` +
          'กรุณาตรวจสอบรายการรถใน Phuket Eyes'
        )
      }

      const workbook = convertedFile.workbook

      const sheet =
        workbook.Sheets['รายละเอียดรถแจ้งเตือน']

      if (!sheet) {
        throw new Error(
          'ไม่พบ Worksheet รายละเอียดรถแจ้งเตือน'
        )
      }

      // เขียนค่าลง Excel ตามลำดับแถวต้นฉบับ
      convertedFile.rowKeys.forEach((key, index) => {

        const values = resultMap.get(key)

        // Excel แถวแรกเป็น Header
        const excelRow = index + 2

        const updates = [
          // F = ผลการตรวจสอบข้อมูล
          [`F${excelRow}`, values.result],

          // J = ผลการปฎิบัติงาน
          [`J${excelRow}`, values.arrest],
        ]

        for (const [address, value] of updates) {

          const cell = sheet[address] || {}

          // อัปเดตค่าโดยรักษา Style เดิม
          sheet[address] = {
            ...cell,
            t: 's',
            v: value,
            s: cell.s || {
              alignment: {
                horizontal: 'center',
                vertical: 'center',
                wrapText: true,
              },
            },
          }
        }
      })

      // สร้าง XLSX ใหม่จากข้อมูลที่ยืนยันแล้ว
      const outputBuffer = XLSX.write(
        workbook,
        {
          bookType: 'xlsx',
          type: 'array',
          cellDates: true,
        }
      )

      const blob = new Blob(
        [outputBuffer],
        {
          type:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      )

      // เปลี่ยนไฟล์ดาวน์โหลดเป็นฉบับล่าสุด
      setConvertedFile((previous) => {

        if (
          !previous ||
          previous.workbook !== workbook
        ) {
          return previous
        }

        return {
          ...previous,
          blob,
        }
      })

      // ปลดล็อกปุ่มดาวน์โหลด
      setIsVss05Confirmed(true)

    } catch (error) {

      console.error(
        'VSS05 confirmation error:',
        error
      )

      setIsVss05Confirmed(false)

      window.alert(
        'ยืนยันข้อมูล VSS05 ไม่สำเร็จ\n\n' +
        (error.message || 'เกิดข้อผิดพลาด')
      )
    }
  }

  window.addEventListener(
    'message',
    handleVss05Message
  )

  return () => {
    window.removeEventListener(
      'message',
      handleVss05Message
    )
  }

}, [convertedFile, activeReportTab])




    /* VSS05_DAILY_V1_20261106 — separate from existing XLSX conversion. */
  const vss05LiveRef = useRef({selectedInspector,inspectors,centers})
  vss05LiveRef.current = {selectedInspector,inspectors,centers}
  useEffect(() => {
    let alive = true
    const frame = () => reportFrameRef.current?.contentWindow
    const isCentral = String(selectedCenterId) === '10'
    const center = isCentral ? null : Number(selectedCenterId)
    const validCenter = isCentral || [1,2,4,7,8,9].includes(center)
    const dateOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d||'')) &&
      !Number.isNaN(new Date(`${d}T12:00:00`).getTime())
    const context = () => {
      const current=vss05LiveRef.current
      frame()?.postMessage({
        type: 'VSS05_DAILY_CONTEXT', central: isCentral,
        centerId: validCenter ? center : null,
        inspectorId: current.selectedInspector || '',
        inspectorName: current.inspectors.find(
          p=>String(p.id)===String(current.selectedInspector)
        )?.name || ''
      }, window.location.origin)
    }
    const blobOf = async data => {
      if (typeof data !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(data))
        throw new Error('ภาพต้องเป็น JPEG, PNG หรือ WebP เท่านั้น')
      const blob=await fetch(data).then(r=>r.blob())
      if(!blob.size || blob.size>1048576) throw new Error('รูปต้องมีขนาดไม่เกิน 1MB')
      return blob
    }
    // VSS05_IMAGE_CLEANUP_V2_20261106
    const imageRefs = payload => {
      const paths = new Set()
      for (const kind of ['face','lpr']) {
        const entries = Array.isArray(payload?.[kind]) ? payload[kind] : []
        for (const item of entries) {
          const value = item?.image_path
          if (typeof value === 'string' && value) paths.add(value)
        }
      }
      return paths
    }
    const safeScopedImage = (path, centerId, reportDate) => {
      const prefix = `${centerId}/${reportDate}/`
      return typeof path === 'string' && path.startsWith(prefix) &&
        /^[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i.test(path.slice(prefix.length))
    }
    const loadImages = async reports => {
      const copy=JSON.parse(JSON.stringify(reports||[]))
      const todo=[]
      for(const rec of copy) for(const kind of ['face','lpr'])
        for(const item of rec.payload?.[kind]||[]) if(item.image_path) todo.push(item)
      let failures=0
      for(let i=0;i<todo.length;i+=6){
        await Promise.all(todo.slice(i,i+6).map(async item=>{
          const {data,error}=await supabase.storage.from('vss05-daily-assets').download(item.image_path)
          if(error || !data){failures+=1;return}
          try{item.imageDataUrl=await blobToDataUrl(data)}catch{failures+=1}
        }))
      }
      return {records:copy,imageError:failures>0}
    }
    const onDailyMessage=async event=>{
      if(!alive || event.origin!==window.location.origin || event.source!==frame()) return
      const msg=event.data
      if(!msg || !String(msg.type||'').startsWith('VSS05_DAILY_')) return
      if(msg.type==='VSS05_DAILY_READY'){context();return}
      if(msg.type==='VSS05_DAILY_GET_REQUEST'){
        if(!validCenter || !dateOk(msg.reportDate)){
          frame()?.postMessage({type:'VSS05_DAILY_LOAD_RESULT',
            requestId:msg.requestId,reportDate:msg.reportDate,
            error:'กรุณาเลือกศูนย์และวันที่รายงานให้ถูกต้อง'},event.origin)
          return
        }
        const requestId=msg.requestId,reportDate=msg.reportDate
        try{
          const {data,error}=await supabase.rpc(
            isCentral ? 'vss05_daily_central' : 'vss05_daily_get',
            isCentral ? {p_report_date:reportDate} :
              {p_center_id:center,p_report_date:reportDate}
          )
          if(error) throw error
          const rawRecords=isCentral
            ? (Array.isArray(data?.reports) ? data.reports : [])
            : (data?.record ? [data.record] : [])
          const namedRecords=rawRecords.map(rec=>({
            ...rec,
            center_name: vss05LiveRef.current.centers.find(
              c=>Number(c.id)===Number(rec.center_id))?.name ||
              `ศูนย์ ${rec.center_id}`
          }))
          const images=await loadImages(namedRecords)
          if(!alive || event.source!==frame()) return
          frame()?.postMessage({
            type:'VSS05_DAILY_LOAD_RESULT',requestId,reportDate,
            result:{
              records:images.records,
              saved_count:isCentral ? Number(data?.saved_count || 0) : (data?.found ? 1 : 0),
              expected_count:isCentral ? 6 : 1,
              complete:isCentral ? data?.complete===true : data?.found===true
            },imageError:images.imageError
          },event.origin)
        }catch(err){
          if(alive && event.source===frame()) frame()?.postMessage({
            type:'VSS05_DAILY_LOAD_RESULT',requestId,reportDate,
            error:err?.message||'โหลดข้อมูลไม่สำเร็จ'
          },event.origin)
        }
        return
      }
      if(msg.type==='VSS05_DAILY_SAVE_REQUEST'){
        if(!validCenter || isCentral || !dateOk(msg.reportDate)){
          frame()?.postMessage({type:'VSS05_DAILY_SAVE_RESULT',
            requestId:msg.requestId,reportDate:msg.reportDate,
            error:'ไม่มีสิทธิ์บันทึก หรือศูนย์/วันที่ไม่ถูกต้อง'},event.origin)
          return
        }
        const requestId=msg.requestId,reportDate=msg.reportDate
        const freshUploads=[]
        let saveRpcStarted=false
        try{
          // Read current saved revision BEFORE uploading. If another editor changed
          // this day, stop early rather than leaving unnecessary files in Storage.
          const {data:oldData,error:oldError}=await supabase.rpc('vss05_daily_get',{
            p_center_id:center,p_report_date:reportDate
          })
          if(oldError) throw oldError
          const oldRecord=oldData?.record || null
          if(Number(oldRecord?.revision||0)!==Number(msg.expectedRevision||0))
            throw new Error('ข้อมูลรายงานถูกแก้ไขจากหน้าจออื่น กรุณาโหลดใหม่ก่อนบันทึก')
          const oldImageRefs=imageRefs(oldRecord?.payload)
          if(!msg.payload || !Array.isArray(msg.payload.face) || !Array.isArray(msg.payload.lpr))
            throw new Error('รูปแบบรายงานไม่ถูกต้อง')
          const clean={...msg.payload}
          for(const kind of ['face','lpr']){
            clean[kind]=[]
            for(const entry of msg.payload[kind]){
              const item={...entry}
              delete item.image_data
              if(entry.image_data){
                const blob=await blobOf(entry.image_data)
                const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg'
                const filePath=`${center}/${reportDate}/${crypto.randomUUID()}.${ext}`
                const {error:uploadError}=await supabase.storage.from('vss05-daily-assets')
                  .upload(filePath,blob,{contentType:blob.type,upsert:false})
                if(uploadError) throw uploadError
                freshUploads.push(filePath)
                item.image_path=filePath
              }
              item.image_path=String(item.image_path||'')
              clean[kind].push(item)
            }
          }
          // Once the save RPC starts, do not roll back new files based on a
          // network error: the DB might have committed despite a lost response.
          saveRpcStarted=true
          const {data,error}=await supabase.rpc('vss05_daily_save',{
            p_center_id:center,p_report_date:reportDate,p_payload:clean,
            p_expected_revision:Number(msg.expectedRevision||0)
          })
          if(error) throw error

          // DB save confirmed. Re-read the persisted payload before removing
          // anything, and NEVER delete a still-referenced or out-of-scope path.
          // A cleanup failure is nonfatal: the new report is already saved.
          let cleanupWarning=''
          const obsoleteCandidates=[...oldImageRefs].filter(
            path=>safeScopedImage(path,center,reportDate) && !imageRefs(clean).has(path)
          )
          if(obsoleteCandidates.length){
            try{
              const {data:verified,error:verifyError}=await supabase.rpc(
                'vss05_daily_get',{p_center_id:center,p_report_date:reportDate}
              )
              if(verifyError || Number(verified?.record?.revision)!==Number(data.revision)){
                cleanupWarning='ไม่สามารถตรวจยืนยันรุ่นข้อมูลเพื่อเก็บกวาดรูปเก่าได้'
              }else{
                const persistedRefs=imageRefs(verified.record?.payload)
                const obsolete=obsoleteCandidates.filter(path=>!persistedRefs.has(path))
                for(let i=0;i<obsolete.length;i+=50){
                  const {error:removeError}=await supabase.storage
                    .from('vss05-daily-assets').remove(obsolete.slice(i,i+50))
                  if(removeError) throw removeError
                }
              }
            }catch(e){
              console.warn('VSS05 old image cleanup failed:',e)
              cleanupWarning='บันทึกสำเร็จ แต่ยังลบไฟล์รูปเก่าบางรายการไม่ได้'
            }
          }
          if(!alive || event.source!==frame()) return
          frame()?.postMessage({type:'VSS05_DAILY_SAVE_RESULT',requestId,reportDate,
            revision:data.revision,payload:clean,cleanupWarning},event.origin)
        }catch(err){
          // Safe rollback only when the save RPC was NEVER attempted.
          // On an ambiguous network failure after RPC start, leave uploads
          // in place and reconcile later instead of risking broken images.
          if(!saveRpcStarted && freshUploads.length){
            try{
              const {error:cleanupError}=await supabase.storage
                .from('vss05-daily-assets').remove(freshUploads)
              if(cleanupError) console.warn('VSS05 upload rollback:',cleanupError)
            }catch(cleanupError){console.warn('VSS05 upload rollback:',cleanupError)}
          }
          if(alive && event.source===frame()) frame()?.postMessage({
            type:'VSS05_DAILY_SAVE_RESULT',requestId,reportDate,
            error:err?.message||'บันทึกไม่สำเร็จ'
          },event.origin)
        }
      }
    }
    window.addEventListener('message',onDailyMessage)
    context()
    return ()=>{alive=false;window.removeEventListener('message',onDailyMessage)}
  },[selectedCenterId])


  useEffect(() => {
    const frame=reportFrameRef.current?.contentWindow
    if(!frame) return
    const isCentral=String(selectedCenterId)==='10'
    frame.postMessage({
      type:'VSS05_DAILY_CONTEXT', central:isCentral,
      centerId:isCentral ? null : Number(selectedCenterId)||null,
      inspectorId:selectedInspector||'',
      inspectorName:inspectors.find(p=>String(p.id)===String(selectedInspector))?.name||''
    },window.location.origin)
  },[selectedCenterId,selectedInspector,inspectors])
const handleDownload = () => {

    if (!convertedFile?.blob || !isVss05Confirmed) {
      return
    }


    const url =
      URL.createObjectURL(
        convertedFile.blob
      )


    const link =
      document.createElement('a')


    link.href = url

    link.download =
      convertedFile.fileName ||
      'VSS05.xlsx'


    document.body.appendChild(
      link
    )


    link.click()


    document.body.removeChild(
      link
    )


    URL.revokeObjectURL(url)

  }


  return (

    <div className="alert-report-page">

      {/* VSS05_TEMP_TAB_20261108: เมนูสลับโหมดภายในหน้าเดิม */}
      <div className="vss05-report-tabs" role="tablist" aria-label="เลือกโหมดรายงาน">
        <button
          type="button"
          role="tab"
          aria-selected={activeReportTab === 'official'}
          className={activeReportTab === 'official' ? 'active' : ''}
          onClick={() => { setActiveReportTab('official'); setConvertedFile(null); setIsVss05Confirmed(false) }}
        >
          รายงานประจำวัน (บันทึกข้อมูล)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeReportTab === 'temporary'}
          className={activeReportTab === 'temporary' ? 'active' : ''}
          onClick={() => { setActiveReportTab('temporary'); setConvertedFile(null); setIsVss05Confirmed(false) }}
        >
          รายงานชั่วคราว (สภ. / ไม่บันทึก)
        </button>
      </div>

      {/* VSS05_SHARED_UPLOAD_V6_20261108: บาร์อัปโหลดใช้ร่วมกัน แต่แปลงลง iframe ของแท็บที่เลือก */}
      {/* =========================================
          VSS05 TOOLBAR
      ========================================== */}
      <section className="vss05-toolbar">

        <div className="vss05-toolbar-head">

          <div>

            <span className="vss05-toolbar-code">
              VSS05
            </span>

            <h2>
              เครื่องมือแปลงรายงานการแจ้งเตือน
            </h2>

            <p>
              อัปโหลดไฟล์ alert_export
              แล้วแปลงเป็นรูปแบบ VSS05
            </p>

          </div>

        </div>


        <div className="vss05-toolbar-grid">


          {/* ===============================
              FILE
          ================================ */}

          <div className="vss05-tool-block">

            <div className="vss05-tool-label">

              <FileSpreadsheet size={17} />

              <span>
                ไฟล์ Alert Export
              </span>

            </div>


            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              hidden
            />


            {!selectedFile ? (

              <button
                type="button"
                className="vss05-upload-button"
                onClick={() =>
                  fileInputRef.current?.click()
                }
              >

                <Upload size={18} />

                อัปโหลด alert_export

              </button>

            ) : (

              <div className="vss05-file-selected">

                <div>

                  <strong>
                    {selectedFile.name}
                  </strong>

                  <span>
                    {(
                      selectedFile.size /
                      1024
                    ).toFixed(1)} KB
                  </span>

                </div>


                <button
                  type="button"
                  className="vss05-file-reset"
                  onClick={handleResetFile}
                  title="เลือกไฟล์ใหม่"
                >

                  <RefreshCw size={16} />

                </button>

              </div>

            )}

          </div>


          {/* ===============================
              CENTER
          ================================ */}

          <div className="vss05-tool-block">

            <div className="vss05-tool-label">

              <Building2 size={17} />

              <span>
                ศูนย์ที่จัดทำรายงาน
              </span>

            </div>


            {canChooseCenter ? (

              <select
                className="vss05-select"
                value={selectedCenterId}
                disabled={centersLoading}
                onChange={(event) => {

                  setSelectedCenterId(
                    event.target.value
                  )

                  setSelectedInspector('')
                  setConvertedFile(null)
                  setIsVss05Confirmed(false)
                }}
              >

                <option value="">
                  {centersLoading
                    ? 'กำลังโหลดศูนย์...'
                    : '-- เลือกศูนย์ --'}
                </option>

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

              <div className="vss05-fixed-value">

                <Building2 size={16} />

                <span>
                  {selectedCenter?.name ||
                    profile?.agency ||
                    '-'}
                </span>

              </div>

            )}

          </div>


          {/* ===============================
              INSPECTOR
          ================================ */}

          <div className="vss05-tool-block">

            <div className="vss05-tool-label">

              <UserRound size={17} />

              <span>
                ผู้ตรวจสอบ
              </span>

            </div>


            <select
              className="vss05-select"
              value={selectedInspector}
              disabled={
                !selectedCenterId ||
                inspectorsLoading
              }
              onChange={(event) => {

                setSelectedInspector(
                  event.target.value
                )

                setConvertedFile(null)
                setIsVss05Confirmed(false)
              }}
            >

              <option value="">

                {!selectedCenterId
                  ? '-- เลือกศูนย์ก่อน --'
                  : inspectorsLoading
                    ? 'กำลังโหลดผู้ตรวจสอบ...'
                    : '-- เลือกผู้ตรวจสอบ --'}

              </option>

              {inspectors.map((person) => (

                <option
                  key={person.id}
                  value={person.id}
                >
                  {[
                    person.rank,
                    person.name,
                  ].filter(Boolean).join(' ') ||
                    'ไม่ระบุชื่อ'}
                </option>

              ))}

            </select>

          </div>


          {/* ===============================
              ACTIONS
          ================================ */}

          <div className="vss05-tool-block vss05-tool-actions">

            <div className="vss05-tool-label">

              <span>
                การทำงาน
              </span>

            </div>


            <div className="vss05-action-buttons">

              <button
                type="button"
                className="vss05-convert-button"
                disabled={
                  !selectedFile ||
                  !selectedCenterId ||
                  !selectedInspector
                }
                onClick={handleConvert}
              >

                <FileSpreadsheet size={18} />

                แปลงเป็น VSS05

              </button>

              
              <button
                type="button"
                className="vss05-confirm-button"
                disabled={!convertedFile}
                onClick={handleVss05Confirm}
              >
                <CheckCircle2 size={18} />
                ยืนยันความถูกต้อง
              </button>



              <button
                type="button"
                className="vss05-download-button"
                disabled={!convertedFile || !isVss05Confirmed}
                onClick={handleDownload}
              >

                <Download size={18} />

                ดาวน์โหลด VSS05

              </button>

            </div>

          </div>

        </div>


        {/* ===============================
            STATUS
        ================================ */}

        <div className="vss05-status-row">

          <span
            className={
              selectedFile
                ? 'vss05-status-dot ready'
                : 'vss05-status-dot'
            }
          />

          {convertedFile ? (

            <span>
              แปลง VSS05 สำเร็จ
              {' '}
              {convertedFile.rowCount}
              {' '}
              รายการ
              {isVss05Confirmed
                ? 'พร้อมดาวน์โหลด'
                : 'รอการยืนยันความถูกต้อง'}
            </span>

          ) : selectedFile ? (

            <span>
              โหลดไฟล์แล้ว
              พร้อมตั้งค่าก่อนแปลง
            </span>

          ) : (

            <span>
              กรุณาอัปโหลดไฟล์
              alert_export.xlsx
            </span>

          )}

        </div>

      </section>

      {/* รายงานจริงยังคง iframe เดิมไว้ ไม่สลับทิ้งเมื่อกดแท็บชั่วคราว */}
      <div style={{ display: activeReportTab === 'official' ? 'block' : 'none' }}>
      {/* =========================================
          PHUKET EYES เดิม
      ========================================== */}

      <iframe
        ref={reportFrameRef}
        className="alert-report-frame"
        src={reportUrl}
        title="VSS05 รายงานการแจ้งเตือน"
      />

      </div>

      {/* โหมดชั่วคราวใช้ไฟล์ HTML ตัวเดิม แต่เปิดด้วย query mode=temp */}
      <div style={{ display: activeReportTab === 'temporary' ? 'block' : 'none' }}>
        <div className="vss05-temp-notice" role="status">
          <strong>แบบฟอร์มชั่วคราวสำหรับ สภ.</strong>
          <span>แก้ไขข้อมูลและคัดลอกรูปเพื่อส่งต่อได้ทันที ไม่มีการบันทึกลงฐานข้อมูลหรือเก็บแบบร่างในเครื่อง รีเฟรชหน้าแล้วข้อมูลจะหาย</span>
        </div>
        <iframe
          className="alert-report-frame"
          ref={tempReportFrameRef}
          src={`${reportUrl}?mode=temp`}
          title="รายงานชั่วคราวสำหรับ สภ. — ไม่บันทึกข้อมูล"
        />
      </div>

    </div>

  )
}


export default AlertReport