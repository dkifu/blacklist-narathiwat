import { useEffect, useState } from 'react'
import liff from '@line/liff'
import { supabase } from '../lib/supabase'

function VehicleDetail({
  vehicleId,
  profile,
  onBack,
  onDeleted,
  onEdit,
}) {
  const [vehicle, setVehicle] = useState(null)
  const [watchLevel, setWatchLevel] = useState(null)
  const [agency, setAgency] = useState(null)
  const [recordCenter, setRecordCenter] = useState(null)
  const [createdByUser, setCreatedByUser] = useState(null)
  const [requester, setRequester] = useState(null)

  const [sharingLine, setSharingLine] = useState(false)

  const [vehicleImageUrl, setVehicleImageUrl] = useState('')
  const [templateImageUrl, setTemplateImageUrl] = useState('')

  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState(false)

  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')
  const createVehicleImageUrl = async (
    path,
    expiresIn = 3600
  ) => {
    if (!path) return ''

    const { data, error } =
      await supabase.storage
        .from('vehicle-images')
        .createSignedUrl(
          path,
          expiresIn
        )

    if (error) {
      console.error(
        'สร้าง Signed URL รูปไม่สำเร็จ:',
        error
      )

      return ''
    }

    return data?.signedUrl || ''
  }

  useEffect(() => {
    loadVehicle()
  }, [vehicleId])

  const loadVehicle = async () => {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single()

    if (error) {
      console.error(error)
      setMessageType('error')
      setMessage(error.message)
      setLoading(false)
      return
    }

    setVehicle(data)

    const [
      signedOriginalUrl,
      signedTemplateUrl,
    ] = await Promise.all([
      data.image_path
        ? createVehicleImageUrl(
            data.image_path,
            3600
          )
        : Promise.resolve(''),

      data.template_image_path
        ? createVehicleImageUrl(
            data.template_image_path,
            3600
          )
        : Promise.resolve(''),
    ])

    setVehicleImageUrl(
      signedOriginalUrl
    )

    setTemplateImageUrl(
      signedTemplateUrl
    )

    

    const [
      watchResult,
      agencyResult,
      centerResult,
      requesterResult,
    ] = await Promise.all([

    data.watch_level_id
      ? supabase
          .from('watch_levels')
          .select('*')
          .eq('id', data.watch_level_id)
          .single()
      : Promise.resolve({ data: null }),

    data.agency_id
      ? supabase
          .from('agencies')
          .select('*')
          .eq('id', data.agency_id)
          .single()
      : Promise.resolve({ data: null }),

    data.created_center_id
      ? supabase
          .from('centers')
          .select('id, name, code')
          .eq('id', data.created_center_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    data.requested_by_id
      ? supabase
          .from('requesters')
          .select('id, name, rank, phone')
          .eq('id', data.requested_by_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),  
  ])

  setWatchLevel(watchResult.data || null)
  setAgency(agencyResult.data || null)
  setRecordCenter(centerResult.data || null)
  setRequester(requesterResult.data || null)

  

  // โหลด User ผู้สร้างแยกทีหลัง
  if (data.created_by_user_id) {
    const {
      data: creatorData,
      error: creatorError,
    } = await supabase
      .from('profiles')
      .select('id, username, full_name')
      .eq('id', data.created_by_user_id)
      .maybeSingle()

    if (creatorError) {
      console.error(
        'โหลดข้อมูล User ผู้สร้างไม่สำเร็จ:',
        creatorError
      )
    }

    setCreatedByUser(creatorData || null)
  } else {
    setCreatedByUser(null)
  }

  // ข้อมูลทุกอย่างโหลดครบแล้วค่อยเปิดหน้า
  setLoading(false)
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'

    const date = new Date(`${dateString}T00:00:00`)

    return new Intl.DateTimeFormat('th-TH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date)
  }

  const formatDateTime = (dateString) => {
    if (!dateString) return '-'

    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(dateString))
  }

  const formatPhone = (phone) => {
    if (!phone) return ''

    const digits = String(phone).replace(/\D/g, '')

    if (digits.length === 9 || digits.length === 10) {
      return `${digits.slice(0, -7)}-${digits.slice(-7)}`
    }

    return phone
  }

  const fullPlate = [
    vehicle?.plate_letters,
    vehicle?.plate_number,
  ]
    .filter(Boolean)
    .join(' ')

  const getPlateTheme = (plateType = '') => {
    const themes = {
      'ป้ายพื้นสีขาว': {
        bg: '#f8fafc',
        text: '#111827',
        border: '#cbd5e1',
      },
      'ป้ายพื้นสีเหลือง': {
        bg: '#f4d03f',
        text: '#111827',
        border: '#d4ac0d',
      },
      'ป้ายพื้นสีเขียว': {
        bg: '#1f8b4c',
        text: '#ffffff',
        border: '#166534',
      },
      'ป้ายพื้นสีแดง': {
        bg: '#e5484d',
        text: '#111827',
        border: '#b91c1c',
      },
      'ป้ายพื้นสีดำ': {
        bg: '#111827',
        text: '#ffffff',
        border: '#334155',
      },
    }

    return themes[plateType] || themes['ป้ายพื้นสีขาว']
  }

  const isMotorcycleVehicle = String(vehicle?.vehicle_type || '')
    .includes('จักรยานยนต์')

  const plateTheme = getPlateTheme(vehicle?.plate_type)  

  const getWatchLevelTheme = (name = '') => {
    if (!name) return 'default'

    if (name.includes('รถเป้าหมาย')) {
        return 'target'
    }

    if (
        name.includes('รถเฝ้าระวัง') ||
        name.includes('ตรวจสอบ')
    ) {
        return 'watch'
    }

    if (name.includes('รถเฝ้าติดตาม')) {
        return 'track'
    }

    if (name.includes('VIP')) {
        return 'vip'
    }

    if (name.includes('รถทดสอบ')) {
        return 'test'
    }

    return 'default'
    }

  const watchTheme = getWatchLevelTheme(watchLevel?.name)

  const hasTemplate =
    Boolean(
      vehicle?.template_image_path &&
      templateImageUrl
    )

  const displayImageUrl =
    templateImageUrl ||
    vehicleImageUrl

  const canManageTemplate = true

  const drawRoundedRect = (
    ctx,
    x,
    y,
    width,
    height,
    radius,
    fillStyle
  ) => {
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

    ctx.fillStyle = fillStyle
    ctx.fill()
  }


  const drawCoverImage = (
    ctx,
    image,
    x,
    y,
    width,
    height
  ) => {
    const imageRatio =
      image.width / image.height

    const boxRatio =
      width / height

    let sourceWidth
    let sourceHeight
    let sourceX
    let sourceY

    if (imageRatio > boxRatio) {
      sourceHeight = image.height
      sourceWidth =
        sourceHeight * boxRatio

      sourceX =
        (image.width - sourceWidth) / 2

      sourceY = 0
    } else {
      sourceWidth = image.width
      sourceHeight =
        sourceWidth / boxRatio

      sourceX = 0

      sourceY =
        (image.height - sourceHeight) / 2
    }

    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      x,
      y,
      width,
      height
    )
  }


  const drawWrappedText = (
    ctx,
    text,
    x,
    y,
    maxWidth,
    lineHeight,
    maxLines = 3
  ) => {
    const value = String(text || '-')
    const chars = [...value]

    const lines = []
    let line = ''

    for (let i = 0; i < chars.length; i += 1) {
      const testLine = line + chars[i]

      if (
        ctx.measureText(testLine).width > maxWidth &&
        line
      ) {
        lines.push(line)
        line = chars[i]
      } else {
        line = testLine
      }
    }

    if (line) {
      lines.push(line)
    }

    const visibleLines = lines.slice(0, maxLines)

    visibleLines.forEach((item, index) => {
      ctx.fillText(
        item,
        x,
        y + index * lineHeight
      )
    })

    return visibleLines.length
  }
  
  const createThumbnailBlobFromBlob = async (sourceBlob) => {
    if (!sourceBlob) {
      throw new Error('ไม่พบรูปสำหรับสร้าง Thumbnail')
    }

    const image = await createImageBitmap(sourceBlob)

    try {
      const MAX_SIZE = 480

      let width = image.width
      let height = image.height

      const scale = Math.min(
        1,
        MAX_SIZE / Math.max(width, height)
      )

      width = Math.max(
        1,
        Math.round(width * scale)
      )

      height = Math.max(
        1,
        Math.round(height * scale)
      )

      const canvas =
        document.createElement('canvas')

      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')

      if (!ctx) {
        throw new Error('ไม่สามารถสร้าง Canvas สำหรับ Thumbnail ได้')
      }

      ctx.drawImage(
        image,
        0,
        0,
        width,
        height
      )

      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(
                new Error('ไม่สามารถสร้าง Thumbnail ได้')
              )
              return
            }

            resolve(blob)
          },
          'image/webp',
          0.72
        )
      })
    } finally {
      image.close?.()
    }
  }

  const buildVehicleTemplateBlob =
    async () => {

    if (!vehicleImageUrl) {
      throw new Error(
        'ไม่พบภาพต้นฉบับของรถ'
      )
    }

    if (document.fonts?.ready) {
      await document.fonts.ready
    }

    const response =
      await fetch(vehicleImageUrl)

    if (!response.ok) {
      throw new Error(
        'ไม่สามารถโหลดภาพต้นฉบับได้'
      )
    }

    const originalBlob =
      await response.blob()

    const image =
      await createImageBitmap(
        originalBlob
      )

    const canvas =
      document.createElement('canvas')

    // 20:13
    canvas.width = 1600
    canvas.height = 1040

    const ctx =
      canvas.getContext('2d')

    const themes = {
    // รถเป้าหมาย = แดง
    target: {
      main: '#e5484d',
      text: '#ffffff',
    },

    // รถเฝ้าระวัง-ตรวจสอบ = ส้ม
    watch: {
      main: '#e89532',
      text: '#ffffff',
    },

    // รถเฝ้าติดตาม = เขียว
    track: {
      main: '#2fb171',
      text: '#ffffff',
    },

    // รถ VIP = น้ำเงิน
    vip: {
      main: '#3b82f6',
      text: '#ffffff',
    },

    // รถทดสอบ = ม่วง
    test: {
      main: '#9b59b6',
      text: '#ffffff',
    },

    // ไม่มีข้อมูล
    default: {
      main: '#64748b',
      text: '#ffffff',
    },
  }

    const theme =
      themes[watchTheme] ||
      themes.default


    // =====================
    // BACKGROUND
    // =====================

    ctx.fillStyle = '#f5f8fc'

    ctx.fillRect(
      0,
      0,
      1600,
      1040
    )


    // =====================
    // HEADER
    // =====================

    const gradient =
      ctx.createLinearGradient(
        30,
        0,
        1000,
        0
      )

    gradient.addColorStop(
      0,
      '#55d7df'
    )

    gradient.addColorStop(
      1,
      '#1453aa'
    )

    drawRoundedRect(
      ctx,
      30,
      28,
      1010,
      135,
      24,
      gradient
    )

    

    const centerName =
      recordCenter?.name ||
      'ไม่ระบุศูนย์'

    ctx.fillStyle = '#ffffff'

    let centerFontSize = 72

    do {
      ctx.font =
        `800 ${centerFontSize}px "Noto Sans Thai", Arial, sans-serif`

      if (
        ctx.measureText(centerName).width <= 900
      ) {
        break
      }

      centerFontSize -= 2
    } while (centerFontSize > 42)

    ctx.textBaseline = 'middle'

    ctx.fillText(
      centerName,
      72,
      96
    )

    ctx.textBaseline = 'alphabetic'


    // =====================
    // WATCH LEVEL
    // =====================

    drawRoundedRect(
      ctx,
      1065,
      28,
      505,
      135,
      24,
      theme.main
    )

    ctx.fillStyle =
      theme.text

    ctx.textAlign = 'center'

    ctx.font =
      '800 46px "Noto Sans Thai", Arial, sans-serif'

    ctx.fillText(
      watchLevel?.name ||
        'รถ Blacklist',
      1317,
      110
    )

    ctx.textAlign = 'left'


    // =====================
    // IMAGE AREA
    // =====================

    drawRoundedRect(
      ctx,
      30,
      190,
      1010,
      650,
      26,
      '#245f9f'
    )

    ctx.save()

    ctx.beginPath()

    ctx.roundRect(
      45,
      205,
      980,
      620,
      20
    )

    ctx.clip()

    drawCoverImage(
      ctx,
      image,
      45,
      205,
      980,
      620
    )

    ctx.restore()

    // =====================
    // RIGHT INFORMATION
    // =====================

        const rightX = 1065
        const rightY = 190
        const rightW = 505
        const rightH = 650

        const rightInnerX = 1090
        const rightInnerW = 455

        drawRoundedRect(
          ctx,
          rightX,
          rightY,
          rightW,
          rightH,
          26,
          '#2e64a3'
        )

        // ---------------------
        // HEADER : ทะเบียนรถ
        // ---------------------

        ctx.textAlign = 'center'
        ctx.fillStyle = '#ffffff'
        ctx.font =
          '700 28px "Noto Sans Thai", Arial, sans-serif'

        ctx.fillText(
          'ทะเบียนรถ',
          rightX + rightW / 2,
          228
        )

          
          // ---------------------
          // PLATE CARD
          // ---------------------

          const plateType =
            String(vehicle.plate_type || '').trim()

          const plateThemes = {
            'ป้ายพื้นสีขาว': {
              bg: '#f8fafc',
              text: '#111827',
              border: '#cbd5e1',
            },
            'ป้ายพื้นสีเหลือง': {
              bg: '#f1c40f',
              text: '#111827',
              border: '#b7950b',
            },
            'ป้ายพื้นสีเขียว': {
              bg: '#1f8b4c',
              text: '#ffffff',
              border: '#166534',
            },
            'ป้ายพื้นสีแดง': {
              bg: '#e74c3c',
              text: '#111827',
              border: '#c0392b',
            },
            'ป้ายพื้นสีดำ': {
              bg: '#111827',
              text: '#ffffff',
              border: '#334155',
            },
          }

          const plateTheme =
            plateThemes[plateType] ||
            plateThemes['ป้ายพื้นสีขาว']

          drawRoundedRect(
            ctx,
            rightInnerX,
            248,
            rightInnerW,
            150,
            24,
            plateTheme.bg
          )

          // เส้นขอบป้าย
          ctx.save()
          ctx.strokeStyle = plateTheme.border
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.roundRect(
            rightInnerX,
            248,
            rightInnerW,
            150,
            24
          )
          ctx.stroke()
          ctx.restore()

          ctx.fillStyle = plateTheme.text
          ctx.textAlign = 'center'

          const plateCenterX =
            rightX + rightW / 2

          // ตรวจว่าเป็นรถจักรยานยนต์หรือไม่
          const isMotorcycle =
            String(vehicle.vehicle_type || '')
              .includes('จักรยานยนต์')


          // helper สำหรับลด font อัตโนมัติ
          // กรณีชื่อจังหวัด / ทะเบียนยาว
          const drawPlateText = (
            text,
            y,
            {
              maxFontSize,
              minFontSize,
              maxWidth = 400,
              weight = 800,
            }
          ) => {
            let fontSize = maxFontSize

            do {
              ctx.font =
                `${weight} ${fontSize}px "Noto Sans Thai", Arial, sans-serif`

              if (
                ctx.measureText(String(text || '-')).width <=
                maxWidth
              ) {
                break
              }

              fontSize -= 2
            } while (fontSize > minFontSize)

            ctx.fillText(
              text || '-',
              plateCenterX,
              y
            )
          }


          if (isMotorcycle) {

            // =====================================
            // รถจักรยานยนต์
            //
            // บรรทัด 1 : หมวดอักษร
            // บรรทัด 2 : จังหวัด
            // บรรทัด 3 : เลขทะเบียน
            // =====================================

            drawPlateText(
              vehicle.plate_letters,
              292,
              {
                maxFontSize: 40,
                minFontSize: 30,
                maxWidth: 390,
              }
            )

            drawPlateText(
              vehicle.province,
              333,
              {
                maxFontSize: 30,
                minFontSize: 22,
                maxWidth: 390,
                weight: 700,
              }
            )

            drawPlateText(
              vehicle.plate_number,
              378,
              {
                maxFontSize: 44,
                minFontSize: 32,
                maxWidth: 390,
              }
            )

          } else {

            // =====================================
            // รถทั่วไป
            // Layout เดิม
            // =====================================

            drawPlateText(
              fullPlate,
              325,
              {
                maxFontSize: 60,
                minFontSize: 42,
                maxWidth: 400,
              }
            )

            // จังหวัดลดขนาดลงจากเดิม
            drawPlateText(
              vehicle.province,
              378,
              {
                maxFontSize: 36,
                minFontSize: 26,
                maxWidth: 400,
                weight: 700,
              }
            )
          }

          ctx.textAlign = 'left'

        // ---------------------
        // CASE INFO AREA
        // ---------------------

        const incidentArea =
          [vehicle.police_station, vehicle.case_province]
            .filter(Boolean)
            .join(' / ') || '-'

            const infoCardX = 1090
            const infoCardW = 455

            // =========================
            // INFO CARD LAYOUT
            // =========================

            const infoStartY = 412
            const infoCardH = 96
            const infoGap = 10

            const drawInfoCard = ({
              title,
              value,
              index,
              fontSize = 18,
              lineHeight = 20,
              maxLines = 2,
            }) => {

              const y =
                infoStartY +
                index * (infoCardH + infoGap)

              // -------------------------
              // CARD
              // -------------------------

              drawRoundedRect(
                ctx,
                infoCardX,
                y,
                infoCardW,
                infoCardH,
                16,
                'rgba(255, 255, 255, 0.10)'
              )

              // -------------------------
              // TITLE CHIP
              // -------------------------

              ctx.font =
                '700 14px "Noto Sans Thai", Arial, sans-serif'

              const chipWidth = Math.min(
                infoCardW - 32,
                ctx.measureText(title).width + 26
              )

              drawRoundedRect(
                ctx,
                infoCardX + 16,
                y + 11,
                chipWidth,
                24,
                12,
                'rgba(255, 255, 255, 0.16)'
              )

              ctx.fillStyle =
                'rgba(255, 255, 255, 0.90)'

              ctx.fillText(
                title,
                infoCardX + 29,
                y + 28
              )

              // -------------------------
              // VALUE
              // -------------------------

              ctx.fillStyle = '#ffffff'

              ctx.font =
                `600 ${fontSize}px "Noto Sans Thai", Arial, sans-serif`

              drawWrappedText(
                ctx,
                value || '-',
                infoCardX + 17,
                y + 59,
                infoCardW - 34,
                lineHeight,
                maxLines
              )
            }


            // =========================
            // DATA
            // =========================

            drawInfoCard({
              title: 'รายละเอียดคดี',
              value: vehicle.detail,
              index: 0,
              fontSize: 20,
              lineHeight: 25,
              maxLines: 2,
            })

            drawInfoCard({
              title: 'วันที่เกิดเหตุ',
              value: formatDate(vehicle.incident_date),
              index: 1,
              fontSize: 18,
              lineHeight: 25,
              maxLines: 1,
            })

            drawInfoCard({
              title: 'พื้นที่เกิดเหตุ',
              value: 'สภ.'+incidentArea,
              index: 2,
              fontSize: 20,
              lineHeight: 25,
              maxLines: 1,
            })

            drawInfoCard({
              title: 'แผนเผชิญเหตุ',
              value: vehicle.response_plan,
              index: 3,
              fontSize: 20,
              lineHeight: 25,
              maxLines: 2,
            })
    

    // =====================
    // BOTTOM
    // =====================

    drawRoundedRect(
      ctx,
      30,
      855,
      1540,
      175,
      25,
      '#ffffff'
    )

    const vehicleName =
      [
        vehicle.brand,
        vehicle.model,
        vehicle.color,
      ]
        .filter(Boolean)
        .join(' ') ||
      'ไม่ระบุข้อมูลรถ'

    let requesterPhone =
      requester?.phone || ''

    if (
      !requesterPhone &&
      vehicle.requested_by_id
    ) {
      const {
        data: requesterPhoneData,
      } = await supabase
        .from('requesters')
        .select('phone')
        .eq(
          'id',
          vehicle.requested_by_id
        )
        .maybeSingle()

      requesterPhone =
        requesterPhoneData?.phone || ''
    }

    const phone =
      requesterPhone
        ? formatPhone(requesterPhone)
        : '-'

    const otherDetails =
      String(vehicle.vehicle_description || '').trim() || '-'


    // ---------------------
    // LEFT BLOCK
    // ---------------------

    ctx.fillStyle = '#111827'

    ctx.font =
      '800 45px "Noto Sans Thai", Arial, sans-serif'

    ctx.fillText(
      vehicleName,
      65,
      905
    )

    

    ctx.font =
      '600 28px "Noto Sans Thai", Arial, sans-serif'

    ctx.fillStyle = '#475569'

    ctx.fillText(
      `หน่วยงาน: ${
        agency?.name || '-'
      }`,
      65,
      948
    )

    const requesterText =
      `ผู้ขอเพิ่มรถ : ${
        vehicle.requested_by || '-'
      }`

    ctx.fillText(
      requesterText,
      65,
      988
    )

    const requesterTextWidth =
      ctx.measureText(requesterText).width

    ctx.fillText(
      `โทร : ${phone}`,
      65 + requesterTextWidth + 25,
      988
    )

    // ---------------------
    // VERTICAL DIVIDER
    // ---------------------

    ctx.save()

    ctx.strokeStyle = '#b5bac2'
    ctx.lineWidth = 4

    ctx.beginPath()

    ctx.moveTo(
      1053,
      880
    )

    ctx.lineTo(
      1053,
      1008
    )

    ctx.stroke()

    ctx.restore()


    // ---------------------
    // CENTER-RIGHT BLOCK
    // ---------------------

    const infoBlockX = 1120

    ctx.fillStyle = '#475569'

    ctx.font =
      '600 28px "Noto Sans Thai", Arial, sans-serif'

    ctx.fillText(
      `เลขเครื่อง : ${
        vehicle.engine_number || '-'
      }`,
      infoBlockX,
      905
    )

    ctx.fillText(
      `เลขตัวถัง : ${
        vehicle.chassis_number || '-'
      }`,
      infoBlockX,
      945
    )

    const otherLabel = 'ลักษณะอื่นๆ :'

    ctx.fillText(
      otherLabel,
      infoBlockX,
      985
    )

    const otherLabelWidth =
      ctx.measureText(otherLabel).width

    drawWrappedText(
      ctx,
      otherDetails,
      infoBlockX + otherLabelWidth + 15,
      985,
      250,
      22,
      2
    )


    


    return await new Promise(
      (resolve, reject) => {

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(
                new Error(
                  'สร้างไฟล์ Template ไม่สำเร็จ'
                )
              )

              return
            }

            resolve(blob)
          },

          'image/jpeg',
          0.92
        )
      }
    )
  }    

  const handleCreateTemplate =
    async () => {

    try {
      setCreatingTemplate(true)
      setMessage('')

      // สร้างภาพ Template
      const templateBlob =
        await buildVehicleTemplateBlob()

      // สร้าง Thumbnail จาก Template
      const thumbnailBlob =
        await createThumbnailBlobFromBlob(
          templateBlob
        )

      const timestamp = Date.now()

      const newTemplatePath =
        `templates/${vehicle.id}/template-${timestamp}.jpg`

      const newThumbnailPath =
        `${vehicle.id}/thumbnail-${timestamp}.webp`

      const oldTemplatePath =
        vehicle.template_image_path

      const oldThumbnailPath =
        vehicle.thumbnail_path

      // Upload Template + Thumbnail พร้อมกัน
      const [
        templateUpload,
        thumbnailUpload,
      ] = await Promise.all([

        supabase.storage
          .from('vehicle-images')
          .upload(
            newTemplatePath,
            templateBlob,
            {
              contentType: 'image/jpeg',
              cacheControl: '3600',
              upsert: false,
            }
          ),

        supabase.storage
          .from('vehicle-images')
          .upload(
            newThumbnailPath,
            thumbnailBlob,
            {
              contentType: 'image/webp',
              cacheControl: '3600',
              upsert: false,
            }
          ),

      ])

      // ถ้า Upload ตัวใดตัวหนึ่งไม่ผ่าน
      if (
        templateUpload.error ||
        thumbnailUpload.error
      ) {

        const uploadedPaths = []

        if (!templateUpload.error) {
          uploadedPaths.push(
            newTemplatePath
          )
        }

        if (!thumbnailUpload.error) {
          uploadedPaths.push(
            newThumbnailPath
          )
        }

        if (uploadedPaths.length > 0) {
          await supabase.storage
            .from('vehicle-images')
            .remove(uploadedPaths)
        }

        throw (
          templateUpload.error ||
          thumbnailUpload.error
        )
      }

      // เปลี่ยนทั้ง Template และ Thumbnail
      // ใน Database พร้อมกัน
      const {
        error: updateError,
      } = await supabase
        .from('vehicles')
        .update({
          template_image_path:
            newTemplatePath,

          thumbnail_path:
            newThumbnailPath,
        })
        .eq(
          'id',
          vehicle.id
        )

      if (updateError) {

        // DB ไม่ผ่าน ลบไฟล์ใหม่ทิ้ง
        await supabase.storage
          .from('vehicle-images')
          .remove([
            newTemplatePath,
            newThumbnailPath,
          ])

        throw updateError
      }

      // DB เปลี่ยนสำเร็จแล้ว
      // ค่อยลบ Template / Thumbnail เก่า
      const oldPaths = [
        oldTemplatePath,
        oldThumbnailPath,
      ].filter(
        (path) =>
          path &&
          path !== newTemplatePath &&
          path !== newThumbnailPath
      )

      if (oldPaths.length > 0) {

        const {
          error: removeOldError,
        } = await supabase.storage
          .from('vehicle-images')
          .remove(oldPaths)

        if (removeOldError) {
          console.error(
            'ลบไฟล์เก่าไม่สำเร็จ:',
            removeOldError
          )
        }
      }

      await loadVehicle()

      setMessageType('success')

      setMessage(
        'สร้าง Template และอัปเดตภาพ Preview เรียบร้อยแล้ว'
      )

    } catch (error) {

      console.error(
        'สร้าง Template ไม่สำเร็จ:',
        error
      )

      setMessageType('error')

      setMessage(
        `สร้าง Template ไม่สำเร็จ: ${
          error?.message ||
          'เกิดข้อผิดพลาด'
        }`
      )

    } finally {

      setCreatingTemplate(false)

    }
  }

  const handleDeleteTemplate =
    async () => {

    if (
      !vehicle.template_image_path
    ) {
      return
    }

    const confirmed =
      window.confirm(
        'ยืนยันลบ Template?\n\nระบบจะกลับไปใช้ภาพ Original อัตโนมัติ'
      )

    if (!confirmed) return

    try {

      setDeletingTemplate(true)
      setMessage('')

      if (!vehicleImageUrl) {
        throw new Error(
          'ไม่พบภาพ Original ของรถ'
        )
      }

      const oldTemplatePath =
        vehicle.template_image_path

      const oldThumbnailPath =
        vehicle.thumbnail_path

      // โหลดภาพ Original
      const response =
        await fetch(vehicleImageUrl)

      if (!response.ok) {
        throw new Error(
          'ไม่สามารถโหลดภาพ Original ได้'
        )
      }

      const originalBlob =
        await response.blob()

      // สร้าง Thumbnail จาก Original
      const thumbnailBlob =
        await createThumbnailBlobFromBlob(
          originalBlob
        )

      const newThumbnailPath =
        `${vehicle.id}/thumbnail-${Date.now()}.webp`

      // Upload Thumbnail ใหม่
      const {
        error: thumbnailUploadError,
      } = await supabase.storage
        .from('vehicle-images')
        .upload(
          newThumbnailPath,
          thumbnailBlob,
          {
            contentType: 'image/webp',
            cacheControl: '3600',
            upsert: false,
          }
        )

      if (thumbnailUploadError) {
        throw thumbnailUploadError
      }

      // สลับ Database กลับมา Original
      // พร้อมเปลี่ยน Thumbnail
      const {
        error: updateError,
      } = await supabase
        .from('vehicles')
        .update({
          template_image_path: null,
          thumbnail_path:
            newThumbnailPath,
        })
        .eq(
          'id',
          vehicle.id
        )

      if (updateError) {

        // DB ไม่ผ่าน ลบ Thumbnail ใหม่
        await supabase.storage
          .from('vehicle-images')
          .remove([
            newThumbnailPath,
          ])

        throw updateError
      }

      // DB สำเร็จแล้ว
      // ค่อยลบ Template และ Thumbnail เก่า
      const oldPaths = [
        oldTemplatePath,
        oldThumbnailPath,
      ].filter(
        (path) =>
          path &&
          path !== newThumbnailPath
      )

      if (oldPaths.length > 0) {

        const {
          error: removeError,
        } = await supabase.storage
          .from('vehicle-images')
          .remove(oldPaths)

        if (removeError) {
          console.error(
            'ลบไฟล์เก่าไม่สำเร็จ:',
            removeError
          )
        }
      }

      await loadVehicle()

      setMessageType('success')

      setMessage(
        'ลบ Template แล้ว และเปลี่ยนภาพ Preview กลับเป็น Original'
      )

    } catch (error) {

      console.error(
        'ลบ Template ไม่สำเร็จ:',
        error
      )

      setMessageType('error')

      setMessage(
        `ลบ Template ไม่สำเร็จ: ${
          error?.message ||
          'เกิดข้อผิดพลาด'
        }`
      )

    } finally {

      setDeletingTemplate(false)

    }
  }

  const handleShareLine = async () => {
    try {
      setSharingLine(true)
      setMessage('')

      const liffId = import.meta.env.VITE_LIFF_ID

      if (!liffId) {
        throw new Error('ไม่พบ VITE_LIFF_ID')
      }

      await liff.init({
        liffId,
      })

      if (!liff.isLoggedIn()) {
        liff.login()
        return
      }

      if (!liff.isApiAvailable('shareTargetPicker')) {
        throw new Error(
          'อุปกรณ์หรือ Browser นี้ไม่รองรับการแชร์เข้า LINE'
        )
      }

      

      let imageUrl = null

        const shareImagePath =
          vehicle.template_image_path ||
          vehicle.image_path

        if (shareImagePath) {
          const { data } =
            supabase.storage
              .from('vehicle-images')
              .getPublicUrl(
                shareImagePath
              )

          imageUrl =
            data?.publicUrl || null
        }

  const flexMessage = {
    type: 'flex',

    altText:
      `🚨 ข้อมูลรถ Blacklist ${fullPlate || ''}`,

    contents: {
      type: 'bubble',
      size: 'mega',

      ...(imageUrl
        ? {
            hero: {
              type: 'image',
              url: imageUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
              backgroundColor: '#111111',
            },
          }
        : {}),

      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',

        contents: [
          {
            type: 'text',
            text: '🚨 ข้อมูลรถ Blacklist',
            weight: 'bold',
            size: 'lg',
            color: '#C9143C',
          },

          {
            type: 'separator',
          },

          {
            type: 'text',
            text:
              `ทะเบียน: ${fullPlate || '-'} ${vehicle.province || ''}`,
            weight: 'bold',
            size: 'md',
            wrap: true,
          },

          {
            type: 'text',
            text:
              `ประเภทรถ: ${vehicle.vehicle_type || '-'}`,
            size: 'sm',
            wrap: true,
          },

          {
            type: 'text',
            text:
              `ยี่ห้อ/รุ่น: ${
                [vehicle.brand, vehicle.model]
                  .filter(Boolean)
                  .join(' ') || '-'
              }`,
            size: 'sm',
            wrap: true,
          },

          {
            type: 'text',
            text:
              `สี: ${vehicle.color || '-'}`,
            size: 'sm',
            wrap: true,
          },

          {
            type: 'text',
            text:
              `ระดับเฝ้าระวัง: ${
                watchLevel?.name || '-'
              }`,
            size: 'sm',
            wrap: true,
          },

          {
            type: 'text',
            text:
              `หน่วยงาน: ${agency?.name || '-'}`,
            size: 'sm',
            wrap: true,
          },

          {
            type: 'text',
            text:
              `ผู้ขอเพิ่มรถ: ${
                vehicle.requested_by || '-'
              }`,
            size: 'sm',
            wrap: true,
          },

          {
            type: 'separator',
          },

          {
            type: 'text',
            text: 'รายละเอียด',
            weight: 'bold',
            size: 'sm',
          },

          {
            type: 'text',
            text: vehicle.detail || '-',
            size: 'sm',
            color: '#555555',
            wrap: true,
          },
          {
            type: 'text',
            text: 'แผนเผชิญเหตุ',
            weight: 'bold',
            size: 'sm',
            margin: 'md',
          },
          {
            type: 'text',
            text: vehicle.response_plan || '-',
            size: 'sm',
            color: '#555555',
            wrap: true,
          },



          ],
          },

          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'separator',
                margin: 'md',
              },
              {
                type: 'text',
                text: 'เพิ่มรถเข้าระบบ กรุณาตรวจสอบ',
                align: 'center',
                weight: 'bold',
                size: 'lg',
                color: '#C9143C',
                margin: 'sm',
                wrap: true,
              },
            ],
            flex: 0,
          },

          },
          }

        const result = await liff.shareTargetPicker(
          [flexMessage],
          {
            isMultiple: true,
          }
        )

      if (result?.status === 'success') {
        setMessageType('success')
        setMessage('แชร์ข้อมูลเข้า LINE เรียบร้อยแล้ว')
      }
    } catch (error) {
      console.error(error)

      setMessageType('error')
      setMessage(
        `แชร์เข้า LINE ไม่สำเร็จ: ${
          error?.message || 'เกิดข้อผิดพลาด'
        }`
      )
    } finally {
      setSharingLine(false)
    }
  }

  const handleCloseCase = async () => {
    const confirmed = window.confirm(
      `ยืนยันปิดคดีรถทะเบียน ${fullPlate}?\n\nรถจะถูกนำออกจาก Blacklist แต่ข้อมูลทั้งหมดจะยังถูกเก็บไว้`
    )

    if (!confirmed) return

    setProcessing(true)

    const today = new Date()
      .toISOString()
      .slice(0, 10)

    const { error } = await supabase
      .from('vehicles')
      .update({
        case_status: 'closed',
        removed_date: today,
      })
      .eq('id', vehicle.id)

    if (error) {
      setMessageType('error')
      setMessage(error.message)
    } else {
      setMessageType('success')
      setMessage('ปิดคดีเรียบร้อยแล้ว')
      await loadVehicle()
    }

    setProcessing(false)
  }

  const handleReopenCase = async () => {
    const confirmed = window.confirm(
      `ยืนยันนำรถ ${fullPlate} กลับเข้าสู่ Blacklist?`
    )

    if (!confirmed) return

    setProcessing(true)

    const { error } = await supabase
      .from('vehicles')
      .update({
        case_status: 'open',
        removed_date: null,
      })
      .eq('id', vehicle.id)

    if (error) {
      setMessageType('error')
      setMessage(error.message)
    } else {
      setMessageType('success')
      setMessage('นำรถกลับเข้าสู่ Blacklist เรียบร้อยแล้ว')
      await loadVehicle()
    }

    setProcessing(false)
  }

  const handleDelete = async () => {
    if (
      deleteConfirm.trim() !==
      vehicle.plate_number.trim()
    ) {
      setMessageType('error')
      setMessage(
        'เลขทะเบียนที่พิมพ์ยืนยันไม่ถูกต้อง'
      )
      return
    }

    setProcessing(true)
    setMessage('')

    try {
      const imagePaths = [
        vehicle.image_path,
        vehicle.thumbnail_path,
        vehicle.template_image_path,
      ].filter(Boolean)

      const { error: deleteVehicleError } =
        await supabase
          .from('vehicles')
          .delete()
          .eq('id', vehicle.id)

      if (deleteVehicleError) {
        throw deleteVehicleError
      }

      if (imagePaths.length > 0) {
        const { error: storageError } =
          await supabase.storage
            .from('vehicle-images')
            .remove(imagePaths)

        if (storageError) {
          console.error(
            'ลบรูปจาก Storage ไม่สำเร็จ:',
            storageError
          )
        }
      }

      setShowDeleteModal(false)
      setDeleteConfirm('')
      setProcessing(false)

      onDeleted()
    } catch (error) {
      console.error(
        'ลบข้อมูลรถไม่สำเร็จ:',
        error
      )

      setMessageType('error')
      setMessage(
        error?.message ||
          'เกิดข้อผิดพลาดในการลบข้อมูล'
      )

      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="detail-loading">
        <div className="loader"></div>
        <p>กำลังโหลดข้อมูลรถ...</p>
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="detail-empty">
        ไม่พบข้อมูลรถ
      </div>
    )
  }

  const renderPlatePreview = () => {
    return (
      <div
        className={`detail-plate-preview ${
          isMotorcycleVehicle ? 'motorcycle' : 'standard'
        }`}
        style={{
          backgroundColor: plateTheme.bg,
          color: plateTheme.text,
          borderColor: plateTheme.border,
        }}
      >
        

        {isMotorcycleVehicle ? (
          <>
            <div className="detail-plate-line plate-line-letters">
              {vehicle?.plate_letters || '-'}
            </div>

            <div className="detail-plate-line plate-line-province">
              {vehicle?.province || '-'}
            </div>

            <div className="detail-plate-line plate-line-number">
              {vehicle?.plate_number || '-'}
            </div>
          </>
        ) : (
          <>
            <div className="detail-plate-line plate-line-main">
              {fullPlate || '-'}
            </div>

            <div className="detail-plate-line plate-line-province">
              {vehicle?.province || '-'}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="vehicle-detail-page">

    <button
      className="back-button"
      onClick={onBack}
    >
      ← กลับหน้ารายการ
    </button>

    <div className="detail-main-layout">

        {/* =========================
            LEFT : VEHICLE IMAGE
        ========================= */}

        <div className="detail-photo-panel">

            <div className="detail-panel-heading">

            <div>
              <div className="detail-image-title-row">
                <h3>รูปรถ</h3>

                <span
                  className={`image-source-badge-inline ${
                    hasTemplate ? 'template' : 'original'
                  }`}
                >
                  {hasTemplate ? 'TEMPLATE' : 'ORIGINAL'}
                </span>
              </div>

              <p>
                {hasTemplate
                  ? 'กำลังแสดงภาพ Template'
                  : 'ภาพหลักที่บันทึกไว้ในระบบ'}
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                alignItems: 'stretch',
              }}
            >
              {canManageTemplate && vehicleImageUrl && (
                <button
                  type="button"
                  className="open-image-button detail-action-button"
                  onClick={handleCreateTemplate}
                  disabled={creatingTemplate || deletingTemplate}
                >
                  {creatingTemplate
                    ? 'กำลังสร้าง...'
                    : hasTemplate
                      ? 'สร้าง Template ใหม่'
                      : 'สร้าง Template'}
                </button>
              )}

              {canManageTemplate && hasTemplate && (
                <button
                  type="button"
                  className="delete-action-button detail-action-button"
                  onClick={handleDeleteTemplate}
                  disabled={deletingTemplate || creatingTemplate}
                >
                  {deletingTemplate ? 'กำลังลบ...' : 'ลบ Template'}
                </button>
              )}

              {displayImageUrl && (
                <a
                  href={displayImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="open-image-button detail-action-button"
                >
                  เปิดภาพเต็ม
                </a>
              )}
            </div>
                

            </div>

            <div
                className={`detail-photo-frame ${
                  hasTemplate ? 'template-mode' : ''
                }`}
              >
                

                {displayImageUrl ? (
                  <img
                    src={displayImageUrl}
                    alt={`รถ ${fullPlate}`}
                    decoding="async"
                  />
                ) : (
                  <div className="detail-no-photo">
                    <span>🚗</span>

                    <strong>
                      ยังไม่มีรูปภาพ
                    </strong>
                  </div>
                )}
              </div>

              <div className="detail-photo-extra">

                <div className="photo-extra-card">
                  <span>ระดับเฝ้าระวัง</span>

                  <div
                    className={`watch-level-highlight ${getWatchLevelTheme(
                      watchLevel?.name
                    )}`}
                  >
                    {watchLevel?.name || '-'}
                  </div>
                </div>

                <div className="photo-extra-card">
                  <span>ผู้ขอเพิ่มเข้าระบบ</span>

                  <strong>
                    {vehicle.requested_by || '-'}
                  </strong>

                  {requester?.phone && (
                    <div className="detail-requester-phone">
                      📞 {formatPhone(requester.phone)}
                    </div>
                  )}

                </div>

              </div>

              {/* เหตุ / คดี */}

            

                <div className="secondary-section">

                <h3>ข้อมูลเหตุ / คดี</h3>

                <div className="secondary-grid">

                    <DetailItem
                      label="รายละเอียดเหตุ"
                      value={vehicle.detail}
                      className="case-detail-item"
                    />

                    <DetailItem
                      label="แผนเผชิญเหตุ"
                      value={vehicle.response_plan}
                      className="response-plan-item"
                    />

                    <DetailItem
                    label="เขต สภ."
                    value={vehicle.police_station}
                    />

                    <DetailItem
                    label="จังหวัดคดี"
                    value={vehicle.case_province}
                    />

                    <DetailItem
                    label="หน่วยงาน"
                    value={agency?.name}
                    />

                </div>

            </div>

        </div>{/* ปิด detail-photo-panel */}


        {/* =========================
            RIGHT : MAIN INFORMATION
        ========================= */}

        <div className="detail-right-panel">

           <div className={`detail-summary ${watchTheme}`}>

                <div className={`hero-badge vehicle-detail-badge ${watchTheme}`}>
                    VEHICLE DETAILS
                </div>

            <div className="detail-summary-top">

                <div>

                  <div className="detail-plate-block">
                    {renderPlatePreview()}

                    <div className="detail-car-name">
                      {[vehicle.brand, vehicle.model]
                        .filter(Boolean)
                        .join(' ') || 'ไม่ระบุยี่ห้อ / รุ่น'}
                    </div>
                  </div>  

                </div>

                <div className="detail-status-area">

                    <div
                        className={`summary-chip watch-level-chip ${getWatchLevelTheme(watchLevel?.name)}`}
                    >
                        <span>ระดับเฝ้าระวัง</span>
                        <strong>{watchLevel?.name || '-'}</strong>
                    </div>

                    <div
                        className={`summary-chip case-status ${
                        vehicle.case_status === 'closed'
                            ? 'closed'
                            : 'open'
                        }`}
                    >
                        <span>สถานะคดี</span>
                        <strong>
                        {vehicle.case_status === 'closed'
                            ? 'ปิดคดีแล้ว'
                            : 'ยังไม่ปิดคดี'}
                        </strong>
                    </div>

                </div>

            </div>

            </div>


            {/* ข้อมูลหลัก 3 กลุ่มอยู่กรอบเดียวกัน */}

            <div className="detail-core-info">

            <div className="core-section">

                <h3>ข้อมูลป้ายทะเบียน</h3>

                <div className="core-grid">

                <DetailItem
                    label="อักษรทะเบียน"
                    value={vehicle.plate_letters}
                />

                <DetailItem
                    label="เลขทะเบียน"
                    value={vehicle.plate_number}
                />

                <DetailItem
                    label="จังหวัดทะเบียน"
                    value={vehicle.province}
                />

                <DetailItem
                    label="ประเภทรถ"
                    value={vehicle.vehicle_type}
                />

                </div>

            </div>


            <div className="core-divider"></div>


            <div className="core-section">

                <h3>ลักษณะรถ</h3>

                <div className="core-grid">

                <DetailItem
                    label="ยี่ห้อ"
                    value={vehicle.brand}
                />

                <DetailItem
                    label="รุ่น"
                    value={vehicle.model}
                />

                <DetailItem
                    label="สี"
                    value={vehicle.color}
                />

                <DetailItem
                  label="ประเภทป้าย"
                  value={vehicle.plate_type}
                />

                </div>

            </div>


            <div className="core-divider"></div>


            <div className="core-section">

                <h3>ข้อมูลตัวรถ</h3>

                <div className="core-grid">

                <DetailItem
                    label="เลขเครื่อง"
                    value={vehicle.engine_number}
                />

                <DetailItem
                    label="เลขตัวถัง"
                    value={vehicle.chassis_number}
                />

                <DetailItem
                  label="ลักษณะอื่น ๆ"
                  value={vehicle.vehicle_description}
                />

                </div>

            </div>

            </div>

        </div>

        </div>


        {/* =========================
            OTHER INFORMATION
        ========================= */}

        <div className="detail-secondary-card">


        {/* ข้อมูลวันที่ */}

        <div className="secondary-section">

            <h3>ข้อมูลวันที่</h3>

            <div className="secondary-grid">

            <DetailItem
                label="วันที่แจ้งเข้าระบบ"
                value={formatDate(vehicle.report_date)}
            />

            <DetailItem
                label="วันที่รถหาย / วันที่เกิดเหตุ"
                value={formatDate(vehicle.incident_date)}
            />

            <DetailItem
                label="วันที่ออกจาก Blacklist"
                value={formatDate(vehicle.removed_date)}
            />

            </div>

        </div>


        <div className="secondary-divider"></div>

        {/* หมายเหตุ */}

        <div className="secondary-section">

            <h3>หมายเหตุ</h3>

            <div className="secondary-grid">

            <DetailItem
                label="หมายเหตุ"
                value={vehicle.note}
                wide
            />

            </div>

        </div>


        <div className="secondary-divider"></div>


        {/* ข้อมูลระบบ */}

        <div className="secondary-section">

            <h3>ข้อมูลระบบ</h3>

            <div className="secondary-grid">

            <DetailItem
                label="ศูนย์ผู้บันทึก"
                value={recordCenter?.name}
            />

            <DetailItem
                label="ผู้บันทึกข้อมูล"
                value={vehicle.created_member_name}
            />  

            <DetailItem
                label="บันทึกเข้าระบบโดย"
                value={
                  createdByUser?.username ||
                  createdByUser?.full_name ||
                  '-'
                }
            />

            <DetailItem
                label="วันที่สร้างรายการ"
                value={formatDateTime(vehicle.created_at)}
            />

            <DetailItem
                label="แก้ไขล่าสุด"
                value={formatDateTime(vehicle.updated_at)}
            />

            </div>

        </div>

        </div>


        {/* =========================
            MESSAGE
        ========================= */}

        {message && (
        <div className={`modern-alert ${messageType}`}>
            {message}
        </div>
        )}


        {/* =========================
            ACTION BUTTONS
        ========================= */}

        <div className="detail-actions">

        <div className="detail-actions-left">

          {['admin', 'supervisor', 'operator', 'center']
            .includes(profile?.role) && (
            <>
              <button
                className="edit-action-button"
                onClick={() => onEdit(vehicle.id)}
              >
                แก้ไขข้อมูล
              </button>

              <button
                className="line-share-button"
                onClick={handleShareLine}
                disabled={sharingLine}
              >
                {sharingLine
                  ? 'กำลังเปิด LINE...'
                  : 'แชร์เข้า LINE'}
              </button>
            </>
          )}

        </div>


        <div className="detail-actions-right">

            {vehicle.case_status === 'open' ? (

            <button
                className="close-case-button"
                onClick={handleCloseCase}
                disabled={processing}
            >
                ✓ ปิดคดี
            </button>

            ) : (

            <button
                className="reopen-case-button"
                onClick={handleReopenCase}
                disabled={processing}
            >
                เปิดคดีใหม่
            </button>

            )}

            {profile?.role === 'admin' && (

            <button
                className="delete-action-button"
                onClick={() => {
                setDeleteConfirm('')
                setShowDeleteModal(true)
                }}
                disabled={processing}
            >
                ลบข้อมูลถาวร
            </button>

            )}

        </div>

        </div>

      {showDeleteModal && (
        <div className="modal-overlay">

          <div className="delete-modal">

            <div className="delete-modal-icon">
              !
            </div>

            <h3>ยืนยันการลบข้อมูลถาวร</h3>

            <p>
              รถทะเบียน
              <strong> {fullPlate} {vehicle.province}</strong>
            </p>

            <div className="danger-box">
              การลบข้อมูลเป็นการลบ Record จริง
              และไม่สามารถย้อนกลับได้
            </div>

            <label className="delete-confirm-label">
              พิมพ์เลขทะเบียน
              <strong> {vehicle.plate_number} </strong>
              เพื่อยืนยัน
            </label>

            <input
              className="delete-confirm-input"
              value={deleteConfirm}
              onChange={(e) =>
                setDeleteConfirm(e.target.value)
              }
              placeholder={vehicle.plate_number}
              autoFocus
            />

            <div className="delete-modal-actions">

              <button
                className="cancel-modal-button"
                onClick={() =>
                  setShowDeleteModal(false)
                }
                disabled={processing}
              >
                ยกเลิก
              </button>

              <button
                className="confirm-delete-button"
                onClick={handleDelete}
                disabled={processing}
              >
                {processing
                  ? 'กำลังลบ...'
                  : 'ยืนยันลบข้อมูล'}
              </button>

            </div>

          </div>

        </div>
      )}

    </div>
  )
}

function DetailCard({
  title,
  children,
  wide = false,
}) {
  return (
    <div
      className={`detail-card ${
        wide ? 'wide' : ''
      }`}
    >
      <h3>{title}</h3>

      <div className="detail-card-grid">
        {children}
      </div>
    </div>
  )
}

function DetailItem({
  label,
  value,
  wide = false,
  className = '',
}) {
  return (
    <div
      className={`detail-item ${
        wide ? 'wide' : ''
      } ${className}`}
    >
      <span>{label}</span>

      <strong>
        {value || '-'}
      </strong>
    </div>
  )
}

export default VehicleDetail