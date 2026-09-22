import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { POLICE_STATIONS_BY_PROVINCE } from '../data/policeStations'

const THAI_PROVINCES = [
  'กรุงเทพมหานคร',
  'กระบี่',
  'กาญจนบุรี',
  'กาฬสินธุ์',
  'กำแพงเพชร',
  'ขอนแก่น',
  'จันทบุรี',
  'ฉะเชิงเทรา',
  'ชลบุรี',
  'ชัยนาท',
  'ชัยภูมิ',
  'ชุมพร',
  'เชียงราย',
  'เชียงใหม่',
  'ตรัง',
  'ตราด',
  'ตาก',
  'นครนายก',
  'นครปฐม',
  'นครพนม',
  'นครราชสีมา',
  'นครศรีธรรมราช',
  'นครสวรรค์',
  'นนทบุรี',
  'นราธิวาส',
  'น่าน',
  'บึงกาฬ',
  'บุรีรัมย์',
  'ปทุมธานี',
  'ประจวบคีรีขันธ์',
  'ปราจีนบุรี',
  'ปัตตานี',
  'พระนครศรีอยุธยา',
  'พะเยา',
  'พังงา',
  'พัทลุง',
  'พิจิตร',
  'พิษณุโลก',
  'เพชรบุรี',
  'เพชรบูรณ์',
  'แพร่',
  'ภูเก็ต',
  'มหาสารคาม',
  'มุกดาหาร',
  'แม่ฮ่องสอน',
  'ยโสธร',
  'ยะลา',
  'ร้อยเอ็ด',
  'ระนอง',
  'ระยอง',
  'ราชบุรี',
  'ลพบุรี',
  'ลำปาง',
  'ลำพูน',
  'เลย',
  'ศรีสะเกษ',
  'สกลนคร',
  'สงขลา',
  'สตูล',
  'สมุทรปราการ',
  'สมุทรสงคราม',
  'สมุทรสาคร',
  'สระแก้ว',
  'สระบุรี',
  'สิงห์บุรี',
  'สุโขทัย',
  'สุพรรณบุรี',
  'สุราษฎร์ธานี',
  'สุรินทร์',
  'หนองคาย',
  'หนองบัวลำภู',
  'อ่างทอง',
  'อำนาจเจริญ',
  'อุดรธานี',
  'อุตรดิตถ์',
  'อุทัยธานี',
  'อุบลราชธานี',

  // เพิ่มตามที่พี่ต้องการ
  'เบตง',
]

const CASE_PROVINCES = [
  'นราธิวาส',
  'ปัตตานี',
  'ยะลา',
  'สงขลา',
]

const VEHICLE_TYPES = [
  'รถจักรยานยนต์',
  'รถจักรยานยนต์พ่วงข้าง',
  'รถยนต์เก๋ง',
  'รถกระบะ',
  'รถตู้',
  'รถบรรทุก 6 ล้อ',
  'รถบรรทุก 10 ล้อ',
  'รถพ่วง / กึ่งพ่วง',
  'รถโดยสาร / รถบัส',
  'รถแท็กซี่ / รถรับจ้าง',
  'รถสามล้อ / ตุ๊กตุ๊ก',
  'รถเกษตร / รถแทรกเตอร์',
  'รถฉุกเฉิน / รถราชการ',
  'อื่น ๆ',
]

function AddVehicle({
  vehicleId = null,
  onSaved,
  onCancel,
  profile,
}) {
  const [vehicleBrands, setVehicleBrands] = useState([])
  const [vehicleModels, setVehicleModels] = useState([])
  const [watchLevels, setWatchLevels] = useState([])
  const [agencies, setAgencies] = useState([])
  const [requesters, setRequesters] = useState([])
  const [requesterAgencies, setRequesterAgencies] = useState([])

  const [centers, setCenters] = useState([])
  const [centerMembers, setCenterMembers] = useState([])

  const [recordCenterId, setRecordCenterId] = useState('')
  const [recordMemberId, setRecordMemberId] = useState('')
  const [recordMemberName, setRecordMemberName] = useState('')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')

  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [existingImagePath, setExistingImagePath] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const isEditMode = Boolean(vehicleId)

  const getTodayDate = () => {
  const now = new Date()

  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60 * 1000
  )

  return localDate.toISOString().split('T')[0]
}

  const getImageUrl = async (path) => {
    if (!path) return ''

    const { data, error } = await supabase.storage
      .from('vehicle-images')
      .createSignedUrl(path, 3600)

    if (error) {
      console.error(
        'ไม่สามารถสร้าง Signed URL ได้:',
        error
      )

      return ''
    }

    return data?.signedUrl || ''
  }

  const processImageFile = (file) => {
    if (!file) return false

    if (!isImageFile(file)) {
      setMessageType('error')
      setMessage('กรุณาเลือกไฟล์รูปภาพเท่านั้น')
      return false
    }

    const maxSize = 5 * 1024 * 1024

    if (file.size > maxSize) {
      setMessageType('error')
      setMessage('ขนาดรูปต้องไม่เกิน 5 MB')
      return false
    }

    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setMessage('')

    return true
  }

  const isImageFile = (file) => {
    if (!file) return false

    // ตรวจ MIME type
    if (file.type?.startsWith('image/')) {
      return true
    }

    // LINE บางครั้งไม่ส่ง MIME type มา
    const fileName = file.name?.toLowerCase() || ''

    return (
      fileName.endsWith('.jpg') ||
      fileName.endsWith('.jpeg') ||
      fileName.endsWith('.png') ||
      fileName.endsWith('.webp') ||
      fileName.endsWith('.gif') ||
      fileName.endsWith('.bmp')
    )
  }

  const createThumbnailBlob = (file) => {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('ไม่พบไฟล์รูปภาพ'))
        return
      }

      const objectUrl = URL.createObjectURL(file)
      const image = new Image()

      image.onload = () => {
        try {
          const MAX_SIZE = 480

          let width = image.naturalWidth
          let height = image.naturalHeight

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
            URL.revokeObjectURL(objectUrl)
            reject(
              new Error('ไม่สามารถสร้าง Canvas ได้')
            )
            return
          }

          ctx.drawImage(
            image,
            0,
            0,
            width,
            height
          )

          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(objectUrl)

              if (!blob) {
                reject(
                  new Error(
                    'ไม่สามารถสร้าง Thumbnail ได้'
                  )
                )
                return
              }

              resolve(blob)
            },
            'image/webp',
            0.72
          )
        } catch (error) {
          URL.revokeObjectURL(objectUrl)
          reject(error)
        }
      }

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl)

        reject(
          new Error('ไม่สามารถอ่านไฟล์รูปภาพได้')
        )
      }

      image.src = objectUrl
    })
  }

  const compressMainImage = async (file) => {
    if (!file) return null

    const imageUrl = URL.createObjectURL(file)

    try {
      const img = new Image()

      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = imageUrl
      })

      const canvas =
        document.createElement('canvas')

      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      const ctx = canvas.getContext('2d')

      if (!ctx) {
        return file
      }

      ctx.drawImage(
        img,
        0,
        0,
        canvas.width,
        canvas.height
      )

      const blob = await new Promise((resolve) => {
        canvas.toBlob(
          resolve,
          'image/webp',
          0.85
        )
      })

      if (!blob) {
        return file
      }

      // ถ้าบีบแล้วใหญ่กว่าเดิม
      // ใช้ไฟล์ต้นฉบับแทน
      if (blob.size >= file.size) {
        return file
      }

      return new File(
        [blob],
        'main.webp',
        {
          type: 'image/webp',
          lastModified: Date.now(),
        }
      )
    } finally {
      URL.revokeObjectURL(imageUrl)
    }
  }

  const processImageUrl = async (url) => {
    if (!url) return false

    try {
      const response = await fetch(url)

      if (!response.ok) {
        return false
      }

      const blob = await response.blob()

      if (!blob.type.startsWith('image/')) {
        return false
      }

      const extension =
        blob.type.split('/')[1] || 'jpg'

      const file = new File(
        [blob],
        `line-image-${Date.now()}.${extension}`,
        {
          type: blob.type,
        }
      )

      return processImageFile(file)
    } catch (error) {
      console.error(
        'ไม่สามารถโหลดรูปจาก URL ได้',
        error
      )

      return false
    }
  }


  const handleImageChange = (e) => {
    const file = e.target.files?.[0]
    processImageFile(file)
  }

  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()

    dragCounter.current += 1

    if (dragCounter.current === 1) {
      setIsDragging(true)
    }
  }


  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()

    e.dataTransfer.dropEffect = 'copy'
  }


  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()

    dragCounter.current -= 1

    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()

    dragCounter.current = 0
    setIsDragging(false)

    const dataTransfer = e.dataTransfer

    // =========================================
    // 1. กรณี LINE / Windows ส่งมาเป็น File
    // =========================================

    const files = Array.from(
      dataTransfer.files || []
    )

    const imageFile = files.find((file) =>
      isImageFile(file)
    )

    if (imageFile) {
      processImageFile(imageFile)
      return
    }


    // =========================================
    // 2. ลองอ่านจาก DataTransfer.items
    // =========================================

    const items = Array.from(
      dataTransfer.items || []
    )

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()

       if (
          file &&
          isImageFile(file)
        ) {
          processImageFile(file)
          return
        }
      }
    }


    // =========================================
    // 3. LINE อาจส่งมาเป็น HTML <img>
    // =========================================

    const html =
      dataTransfer.getData('text/html')

    if (html) {
      const parser = new DOMParser()

      const doc = parser.parseFromString(
        html,
        'text/html'
      )

      const img = doc.querySelector('img')

      const imageUrl =
        img?.getAttribute('src')

      if (imageUrl) {
        const success =
          await processImageUrl(imageUrl)

        if (success) return
      }
    }


    // =========================================
    // 4. LINE อาจส่ง URL ของรูป
    // =========================================

    const uri =
      dataTransfer.getData('text/uri-list') ||
      dataTransfer.getData('text/plain')

    if (
      uri &&
      (
        uri.startsWith('http://') ||
        uri.startsWith('https://') ||
        uri.startsWith('data:image/')
      )
    ) {
      const success =
        await processImageUrl(uri.trim())

      if (success) return
    }


    // =========================================
    // รับจาก LINE ไม่ได้
    // =========================================

    setMessageType('error')
    setMessage(
      'ไม่สามารถรับรูปที่ลากมาจาก LINE ได้ ลองคัดลอกรูปแล้วกด Ctrl + V บริเวณช่องรูปภาพ'
    )
  }

  const handleImagePaste = (e) => {
    const files = Array.from(
      e.clipboardData?.files || []
    )

    const imageFile = files.find((file) =>
      file.type.startsWith('image/')
    )

    if (!imageFile) {
      return
    }

    e.preventDefault()

    processImageFile(imageFile)
  }

  /* =========================================
   ป้องกัน Browser เปิดไฟล์/รูปเมื่อ Drop
  ========================================= */

  useEffect(() => {
    const preventBrowserDrop = (e) => {
      e.preventDefault()
    }

    window.addEventListener(
      'dragover',
      preventBrowserDrop
    )

    window.addEventListener(
      'drop',
      preventBrowserDrop
    )

    return () => {
      window.removeEventListener(
        'dragover',
        preventBrowserDrop
      )

      window.removeEventListener(
        'drop',
        preventBrowserDrop
      )
    }
  }, [])

  const [loadingVehicle, setLoadingVehicle] =
    useState(false)

  const [form, setForm] = useState({
    report_date: getTodayDate(),
    incident_date: getTodayDate(),

    plate_letters: '',
    plate_number: '',
    province: '',

    vehicle_type: '',
    brand: '',
    model: '',
    color: '',
    vehicle_description: '',

    engine_number: '',
    chassis_number: '',

    agency_id: '',
    police_station: '',
    case_province: '',

    detail: '',
    watch_level_id: '',

    requested_by_id: '',
    requested_by: '',
    note: '',
  })

  useEffect(() => {
    const start = async () => {
      await loadOptions()

      if (vehicleId) {
        await loadVehicle()
      }
    }

  start()
}, [vehicleId])

  const loadVehicle = async () => {
    setLoadingVehicle(true)

    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single()

    if (error) {
      console.error(error)

      setMessageType('error')
      setMessage(
        `ไม่สามารถโหลดข้อมูลรถได้: ${error.message}`
      )

      setLoadingVehicle(false)
      return
    }

    setForm({
      report_date: data.report_date || '',
      incident_date: data.incident_date || '',

      plate_letters: data.plate_letters || '',
      plate_number: data.plate_number || '',
      province: data.province || '',

      vehicle_type: data.vehicle_type || '',
      brand: data.brand || '',
      model: data.model || '',
      color: data.color || '',
      vehicle_description:
        data.vehicle_description || '',

      engine_number: data.engine_number || '',
      chassis_number: data.chassis_number || '',

      agency_id:
        data.agency_id?.toString() || '',

      police_station:
        data.police_station || '',

      case_province:
        data.case_province || '',

      detail: data.detail || '',

      watch_level_id:
        data.watch_level_id?.toString() || '',

      requested_by_id:
        data.requested_by_id?.toString() || '',

      requested_by:
        data.requested_by || '',

      note: data.note || '',
    })

    setRecordCenterId(
      data.created_center_id?.toString() || ''
    )

    setRecordMemberId(
      data.created_member_id?.toString() || ''
    )

    setRecordMemberName(
      data.created_member_name || ''
    )

    await loadModelsForBrand(
      data.brand || '',
      data.vehicle_type || ''
    )

    setExistingImagePath(
      data.image_path || ''
    )

    if (data.image_path) {
      const signedImageUrl =
        await getImageUrl(data.image_path)

      setImagePreview(
        signedImageUrl
      )
    } else {
      setImagePreview('')
    }
    setLoadingVehicle(false)
  }

  const loadOptions = async () => {
    const [
      levelResult,
      agencyResult,
      brandResult,
      requesterResult,
      requesterAgencyResult,
      centerResult,
      memberResult,
    ] = await Promise.all([

      supabase
        .from('watch_levels')
        .select('*')
        .eq('active', true)
        .order('sort_order'),

      supabase
        .from('agencies')
        .select('*')
        .eq('active', true)
        .order('name'),

      supabase
        .from('vehicle_brands')
        .select('id, name')
        .eq('active', true)
        .order('name'),

      supabase
        .from('requesters')
        .select('*')
        .eq('active', true)
        .order('name'),

      supabase
        .from('requester_agencies')
        .select('requester_id, agency_id'),  

      supabase
        .from('centers')
        .select('id, name, code')
        .eq('active', true)
        .order('name'),

      supabase
        .from('center_members')
        .select(`
          id,
          center_id,
          name,
          rank,
          position
        `)
        .eq('active', true)
        .order('name'),
    ])

    if (levelResult.error) {
      console.error(levelResult.error)
    }

    if (agencyResult.error) {
      console.error(agencyResult.error)
    }

    if (brandResult.error) {
      console.error(brandResult.error)
    }

    if (requesterResult.error) {
      console.error(requesterResult.error)
    }

    if (requesterAgencyResult.error) {
      console.error(requesterAgencyResult.error)
    }

    if (centerResult.error) {
      console.error(centerResult.error)
    }

    if (memberResult.error) {
      console.error(memberResult.error)
    }

    setWatchLevels(levelResult.data || [])
    setAgencies(agencyResult.data || [])
    setVehicleBrands(brandResult.data || [])
    setRequesters(requesterResult.data || [])

    setRequesterAgencies(
      requesterAgencyResult.data || []
    )

    setCenters(centerResult.data || [])
    setCenterMembers(memberResult.data || [])

    // User ศูนย์ = ใช้ศูนย์ของตัวเองอัตโนมัติ
    if (
      !vehicleId &&
      profile?.role === 'center' &&
      profile?.center_id
    ) {
      setRecordCenterId(
        String(profile.center_id)
      )
    }
  }

  const loadModelsForBrand = async (
    brandName,
    vehicleType = ''
  ) => {
    if (!brandName?.trim()) {
      setVehicleModels([])
      return
    }

    const { data: brandData, error: brandError } =
      await supabase
        .from('vehicle_brands')
        .select('id')
        .ilike('name', brandName.trim())
        .limit(1)
        .maybeSingle()

    if (brandError) {
      console.error(brandError)
      setVehicleModels([])
      return
    }

    if (!brandData) {
      setVehicleModels([])
      return
    }

    let query = supabase
      .from('vehicle_models')
      .select('id, name, vehicle_group')
      .eq('brand_id', brandData.id)
      .eq('active', true)

    // ถ้าเป็นมอเตอร์ไซค์ ให้เอาเฉพาะรุ่นมอเตอร์ไซค์
    if (vehicleType === 'รถจักรยานยนต์') {
      query = query.eq(
        'vehicle_group',
        'motorcycle'
      )
    } else {
      // รถประเภทอื่น ไม่เอารุ่นมอเตอร์ไซค์มาปน
      query = query.neq(
        'vehicle_group',
        'motorcycle'
      )
    }

    const { data, error } = await query
      .order('sort_order')
      .order('name')

    if (error) {
      console.error(error)
      setVehicleModels([])
      return
    }

    setVehicleModels(data || [])
  }

  const handleChange = (e) => {
      const { name, value } = e.target

      setForm((prev) => ({
        ...prev,
        [name]: value,
      }))
    }

    const handleAgencyChange = (e) => {
      const agencyId = e.target.value

      setForm((prev) => ({
        ...prev,
        agency_id: agencyId,
        requested_by_id: '',
        requested_by: '',
      }))
    }

    const handleRequesterChange = (e) => {
      const requesterId = e.target.value

      const requester = requesters.find(
        (item) => String(item.id) === String(requesterId)
      )

      const requesterName = requester
        ? [requester.rank, requester.name]
            .filter(Boolean)
            .join(' ')
        : ''

      setForm((prev) => ({
        ...prev,
        requested_by_id: requesterId,
        requested_by: requesterName,
      }))
    }

    const handleCaseProvinceChange = (e) => {
      const value = e.target.value

      setForm((prev) => ({
        ...prev,
        case_province: value,

        // เปลี่ยนจังหวัดแล้ว ล้าง สภ. เดิม
        police_station: '',
      }))
    }

    const handleBrandChange = async (e) => {
    const value = e.target.value

    setForm((prev) => ({
      ...prev,
      brand: value,
      model: '',
    }))

    await loadModelsForBrand(
      value,
      form.vehicle_type
    )
  }

  const handleVehicleTypeChange = async (e) => {
    const value = e.target.value

    setForm((prev) => ({
      ...prev,
      vehicle_type: value,
      model: '',
    }))

    if (form.brand) {
      await loadModelsForBrand(
        form.brand,
        value
      )
    }
  }

  const resetForm = () => {
    setForm({
      report_date: getTodayDate(),
      incident_date: getTodayDate(),

      plate_letters: '',
      plate_number: '',
      province: '',

      vehicle_type: '',
      brand: '',
      model: '',
      color: '',
      vehicle_description: '',

      engine_number: '',
      chassis_number: '',

      agency_id: '',
      police_station: '',
      case_province: '',

      detail: '',
      watch_level_id: '',

          requested_by_id: '',
          requested_by: '',
          note: '',
        })

        setRecordMemberId('')
        setRecordMemberName('')

        if (profile?.role === 'center' && profile?.center_id) {
          setRecordCenterId(String(profile.center_id))
        } else {
          setRecordCenterId('')
        }
      }
  

  const handleSubmit = async (e) => {
    e.preventDefault()

    setMessage('')

    // ตรวจข้อมูลผู้บันทึก
    {
      if (!recordCenterId) {
        setMessageType('error')
        setMessage('กรุณาระบุศูนย์ผู้บันทึก')
        return
      }

      if (!recordMemberId) {
        setMessageType('error')
        setMessage('กรุณาเลือกผู้บันทึกข้อมูล')
        return
      }

      const selectedMember = centerMembers.find(
        (member) =>
          String(member.id) === String(recordMemberId) &&
          String(member.center_id) === String(recordCenterId)
      )

      if (!selectedMember) {
        setMessageType('error')
        setMessage('ข้อมูลผู้บันทึกไม่ตรงกับศูนย์ที่เลือก')
        return
      }

      if (!profile?.id) {
        setMessageType('error')
        setMessage('ไม่พบข้อมูล User ที่กำลังเข้าสู่ระบบ')
        return
      }
    }

    setSaving(true)
    setMessage('')

    const vehicleData = {
      ...form,

      report_date:
        form.report_date || null,

      incident_date:
        form.incident_date || null,

      agency_id:
        form.agency_id
          ? Number(form.agency_id)
          : null,

      watch_level_id:
        form.watch_level_id
          ? Number(form.watch_level_id)
          : null,

      requested_by_id:
        form.requested_by_id
          ? Number(form.requested_by_id)
          : null,
    }

    let savedVehicleId = vehicleId

    // =========================
    // EDIT
    // =========================

    if (isEditMode) {

      const { error } = await supabase
      .from('vehicles')
      .update({
        ...vehicleData,

        created_center_id:
          recordCenterId
            ? Number(recordCenterId)
            : null,

        created_member_id:
          recordMemberId
            ? Number(recordMemberId)
            : null,

        created_member_name:
          recordMemberName || null,
      })
      .eq('id', vehicleId)

      if (error) {
        console.error(error)

        setMessageType('error')
        setMessage(
          `เกิดข้อผิดพลาด: ${error.message}`
        )

        setSaving(false)
        return
      }

    }

    // =========================
    // CREATE
    // =========================

    else {

      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          ...vehicleData,
          case_status: 'open',

          created_center_id:
            recordCenterId
              ? Number(recordCenterId)
              : null,

          created_member_id:
            recordMemberId
              ? Number(recordMemberId)
              : null,

          created_member_name:
            recordMemberName || null,

          created_by_user_id:
            profile?.id || null,
        })
        .select('id')
        .single()

      if (error) {
        console.error(error)

        setMessageType('error')
        setMessage(
          `เกิดข้อผิดพลาด: ${error.message}`
        )

        setSaving(false)
        return
      }

      savedVehicleId = data.id
    }

    // =========================
    // UPLOAD IMAGE
    // =========================

    if (imageFile && savedVehicleId) {
      const imagePath =
        `${savedVehicleId}/main`

      const thumbnailPath =
        `${savedVehicleId}/thumbnail.webp`

      let thumbnailBlob

      try {
        thumbnailBlob =
          await createThumbnailBlob(imageFile)
      } catch (thumbnailError) {
        console.error(
          'Thumbnail error:',
          thumbnailError
        )

        setMessageType('error')

        setMessage(
          `บันทึกข้อมูลรถแล้ว แต่สร้าง Thumbnail ไม่สำเร็จ: ${thumbnailError.message}`
        )

        setSaving(false)
        return
      }

      let compressedMain = imageFile

      try {
        compressedMain =
          await compressMainImage(imageFile)
      } catch (compressError) {
        console.error(
          'Main image compression error:',
          compressError
        )

        // ถ้าบีบไม่ได้ ใช้ไฟล์ต้นฉบับแทน
        compressedMain = imageFile
      }

      // Upload รูปต้นฉบับ + Thumbnail พร้อมกัน
      const [
        originalUpload,
        thumbnailUpload,
      ] = await Promise.all([
        supabase.storage
          .from('vehicle-images')
          .upload(
            imagePath,
            compressedMain,
            {
              upsert: true,
              contentType:
                compressedMain.type || 'image/jpeg',
              cacheControl: '3600',
            }
          )
          ,

        supabase.storage
          .from('vehicle-images')
          .upload(
            thumbnailPath,
            thumbnailBlob,
            {
              upsert: true,
              contentType: 'image/webp',
              cacheControl: '3600',
            }
          ),
      ])

      if (originalUpload.error) {
        console.error(
          'Original upload error:',
          originalUpload.error
        )

        setMessageType('error')

        setMessage(
          `บันทึกข้อมูลรถแล้ว แต่ Upload รูปต้นฉบับไม่สำเร็จ: ${originalUpload.error.message}`
        )

        setSaving(false)
        return
      }

      if (thumbnailUpload.error) {
        console.error(
          'Thumbnail upload error:',
          thumbnailUpload.error
        )

        setMessageType('error')

        setMessage(
          `Upload รูปต้นฉบับสำเร็จ แต่ Upload Thumbnail ไม่สำเร็จ: ${thumbnailUpload.error.message}`
        )

        setSaving(false)
        return
      }

      const { error: imageDbError } =
        await supabase
          .from('vehicles')
          .update({
            image_path: imagePath,
            thumbnail_path: thumbnailPath,
          })
          .eq('id', savedVehicleId)

      if (imageDbError) {
        console.error(imageDbError)

        setMessageType('error')

        setMessage(
          `Upload รูปสำเร็จ แต่บันทึก path รูปไม่สำเร็จ: ${imageDbError.message}`
        )

        setSaving(false)
        return
      }
    }

    setMessageType('success')

    setMessage(
      isEditMode
        ? 'บันทึกการแก้ไขเรียบร้อยแล้ว'
        : 'บันทึกข้อมูลรถเรียบร้อยแล้ว'
    )

    setSaving(false)

    if (isEditMode) {

      if (onSaved) {
        setTimeout(() => {
          onSaved()
        }, 1500)
      }

    } else {

      resetForm()

      setImageFile(null)
      setImagePreview('')
      setExistingImagePath('')

      if (onSaved) {
        onSaved()
      }
    }
  }

  const selectedWatchLevel =
    watchLevels.find(
      (item) => String(item.id) === String(form.watch_level_id)
    )?.name || '-'

  const casePoliceStations =
    POLICE_STATIONS_BY_PROVINCE[
      form.case_province
    ] || []

  const selectedAgency =
    agencies.find(
      (item) => String(item.id) === String(form.agency_id)
    )?.name || '-'

  const requesterIdsForAgency = new Set(
    requesterAgencies
      .filter(
        (item) =>
          String(item.agency_id) ===
          String(form.agency_id)
      )
      .map((item) =>
        String(item.requester_id)
      )
  )

  const filteredRequesters = requesters.filter(
    (requester) =>
      requesterIdsForAgency.has(
        String(requester.id)
      )
  )

    const filteredCenterMembers = centerMembers.filter(
    (member) =>
      String(member.center_id) ===
      String(recordCenterId)
  )

  const selectedRecordCenter = centers.find(
    (center) =>
      String(center.id) ===
      String(recordCenterId)
  )

  const handleRecordCenterChange = (e) => {
    const centerId = e.target.value

    setRecordCenterId(centerId)

    // เปลี่ยนศูนย์ ต้องล้างสมาชิกเดิม
    setRecordMemberId('')
    setRecordMemberName('')
  }

  const handleRecordMemberChange = (e) => {
    const memberId = e.target.value

    const member = centerMembers.find(
      (item) =>
        String(item.id) ===
        String(memberId)
    )

    const memberName = member
      ? [member.rank, member.name]
          .filter(Boolean)
          .join(' ')
      : ''

    setRecordMemberId(memberId)
    setRecordMemberName(memberName)
  }

  if (loadingVehicle) {
    return (
      <div className="detail-loading">
        <div className="loader"></div>
        <p>กำลังโหลดข้อมูลรถ...</p>
      </div>
    )
  }

  return (
    <div className="vehicle-page">
      <div className="vehicle-hero">
        <div className="vehicle-hero-left">
          <div className="hero-badge">
            {isEditMode
              ? 'EDIT VEHICLE'
              : 'BLACKLIST FORM'}
          </div>
          <h2>
            {isEditMode
              ? 'แก้ไขข้อมูลรถที่บันทึกอยู่ในระบบ'
              : 'บันทึกข้อมูลรถเข้าสู่ระบบเฝ้าระวัง พร้อมรายละเอียดทะเบียน ลักษณะรถ ข้อมูลคดี และหน่วยงานที่เกี่ยวข้อง'}
          </h2>
          <p>
            บันทึกข้อมูลรถเข้าสู่ระบบเฝ้าระวัง พร้อมรายละเอียดทะเบียน
            ลักษณะรถ ข้อมูลคดี และหน่วยงานที่เกี่ยวข้อง
          </p>
        </div>

        <div className="vehicle-hero-right">
          <div className="mini-summary">
            <div className="mini-summary-item">
              <span>ระดับเฝ้าระวัง</span>
              <strong>{selectedWatchLevel}</strong>
            </div>

            <div className="mini-summary-item">
              <span>หน่วยงาน</span>
              <strong>{selectedAgency}</strong>
            </div>

            <div className="mini-summary-item">
              <span>ทะเบียน</span>
              <strong>
                {(form.plate_letters || '-') + ' ' + (form.plate_number || '-')}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <form className="vehicle-form-modern" onSubmit={handleSubmit}>
        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>ข้อมูลวันที่</h3>
              <p>ระบุวันที่แจ้งเข้าระบบและวันที่เกิดเหตุ</p>
            </div>
          </div>

          <div className="modern-grid grid-2">
            <div className="modern-field">
              <label>วันที่แจ้งเข้าระบบ</label>
              <input
                type="date"
                name="report_date"
                value={form.report_date}
                onChange={handleChange}
              />
            </div>

            <div className="modern-field">
              <label>วันที่รถหาย / วันที่เกิดเหตุ</label>
              <input
                type="date"
                name="incident_date"
                value={form.incident_date}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>ข้อมูลทะเบียน</h3>
              <p>ระบุเลขทะเบียนและจังหวัดทะเบียนของรถ</p>
            </div>
          </div>

          <div className="modern-grid grid-3">
            <div className="modern-field">
              <label>หมวดอักษร</label>
              <input
                name="plate_letters"
                value={form.plate_letters}
                onChange={handleChange}
                placeholder="เช่น 1ขอ"
              />
            </div>

            <div className="modern-field">
              <label>เลขทะเบียน <span className="req">*</span></label>
              <input
                name="plate_number"
                value={form.plate_number}
                onChange={handleChange}
                placeholder="เช่น 6780"
                required
              />
            </div>

            <div className="modern-field">
              <label>
                หมวดจังหวัด <span className="req">*</span>
              </label>

              <input
                type="text"
                name="province"
                list="thai-provinces"
                value={form.province}
                onChange={handleChange}
                placeholder="พิมพ์หรือเลือกจังหวัด"
                autoComplete="off"
                required
              />

              <datalist id="thai-provinces">
                {THAI_PROVINCES.map((province) => (
                  <option
                    key={province}
                    value={province}
                  />
                ))}
              </datalist>
            </div>
          </div>
        </div>

        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>ลักษณะรถ</h3>
              <p>ระบุรายละเอียดทั่วไปของตัวรถ</p>
            </div>
          </div>

          <div className="modern-grid grid-2">
            <div className="modern-field">
              <label>ประเภทรถ</label>

              <select
                name="vehicle_type"
                value={form.vehicle_type}
                onChange={handleVehicleTypeChange}
              >
                <option value="">-- เลือกประเภทรถ --</option>

                {VEHICLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="modern-field">
              <label>ยี่ห้อ</label>

              <input
                type="text"
                name="brand"
                list="vehicle-brand-list"
                value={form.brand}
                onChange={handleBrandChange}
                placeholder="พิมพ์หรือเลือกยี่ห้อ"
                autoComplete="off"
              />

              <datalist id="vehicle-brand-list">
                {vehicleBrands.map((brand) => (
                  <option
                    key={brand.id}
                    value={brand.name}
                  />
                ))}
              </datalist>
            </div>

            <div className="modern-field">
              <label>รุ่น</label>

              <input
                type="text"
                name="model"
                list="vehicle-model-list"
                value={form.model}
                onChange={handleChange}
                placeholder={
                  form.brand
                    ? 'พิมพ์หรือเลือกรุ่น'
                    : 'เลือกยี่ห้อก่อน'
                }
                autoComplete="off"
                disabled={!form.brand}
              />

              <datalist id="vehicle-model-list">
                {vehicleModels.map((model) => (
                  <option
                    key={model.id}
                    value={model.name}
                  />
                ))}
              </datalist>
            </div>

            <div className="modern-field">
              <label>สีรถ</label>
              <input
                name="color"
                value={form.color}
                onChange={handleChange}
                placeholder="ขาว / ดำ / น้ำเงิน"
              />
            </div>

            <div className="modern-field full">
              <label>ลักษณะอื่น ๆ</label>
              <input
                name="vehicle_description"
                value={form.vehicle_description}
                onChange={handleChange}
                placeholder="เช่น 4 ประตู / ล้อแม็ก / ติดสติ๊กเกอร์"
              />
            </div>
          </div>
        </div>

        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>ข้อมูลตัวรถ</h3>
              <p>เลขเครื่องและเลขตัวถัง (ถ้ามี)</p>
            </div>
          </div>

          <div className="modern-grid grid-2">
            <div className="modern-field">
              <label>เลขเครื่อง</label>
              <input
                name="engine_number"
                value={form.engine_number}
                onChange={handleChange}
                placeholder="กรอกเลขเครื่อง"
              />
            </div>

            <div className="modern-field">
              <label>เลขตัวถัง</label>
              <input
                name="chassis_number"
                value={form.chassis_number}
                onChange={handleChange}
                placeholder="กรอกเลขตัวถัง"
              />
            </div>
          </div>
        </div>

        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>ข้อมูลเหตุ / คดี</h3>
              <p>รายละเอียดเหตุ สภ. และจังหวัดที่เกี่ยวข้อง</p>
            </div>
          </div>

          <div className="modern-grid grid-2">
            <div className="modern-field full">
              <label>รายละเอียดเหตุ</label>
              <textarea
                name="detail"
                value={form.detail}
                onChange={handleChange}
                rows="4"
                placeholder="ระบุรายละเอียดเหตุ / คดี"
              />
            </div>

            <div className="modern-field">
              <label>เขต สภ.</label>

              <input
                type="text"
                name="police_station"
                list="police-stations"
                value={form.police_station}
                onChange={handleChange}
                placeholder={
                  form.case_province
                    ? 'พิมพ์หรือเลือก สภ.'
                    : 'เลือกจังหวัดคดีก่อน'
                }
                autoComplete="off"
                disabled={!form.case_province}
              />

              <datalist id="police-stations">
                {casePoliceStations.map((station) => (
                  <option
                    key={station}
                    value={station}
                  />
                ))}
              </datalist>
            </div>

            <div className="modern-field">
              <label>จังหวัด</label>

              <input
                type="text"
                name="case_province"
                list="case-provinces"
                value={form.case_province}
                onChange={handleCaseProvinceChange}
                placeholder="พิมพ์หรือเลือกจังหวัด"
                autoComplete="off"
              />

              <datalist id="case-provinces">
                {CASE_PROVINCES.map((province) => (
                  <option
                    key={province}
                    value={province}
                  />
                ))}
              </datalist>
            </div>

          </div>
        </div>

        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>การเฝ้าระวัง</h3>
              <p>เลือกระดับเฝ้าระวังและหน่วยงานที่เกี่ยวข้อง</p>
            </div>
          </div>

          <div className="modern-grid grid-2">
            <div className="modern-field">
              <label>ระดับเฝ้าระวัง <span className="req">*</span></label>
              <select
                name="watch_level_id"
                value={form.watch_level_id}
                onChange={handleChange}
                required
              >
                <option value="">-- เลือกระดับเฝ้าระวัง --</option>
                {watchLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="modern-field">
              <label>หน่วยงาน</label>
              <select
                name="agency_id"
                value={form.agency_id}
                onChange={handleAgencyChange}
              >
                <option value="">-- เลือกหน่วยงาน --</option>
                {agencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="modern-field full">
              <label>ผู้ขอเพิ่มเข้าระบบ</label>

              <select
                name="requested_by_id"
                value={form.requested_by_id}
                onChange={handleRequesterChange}
                disabled={!form.agency_id}
              >
                <option value="">
                  {form.agency_id
                    ? '-- เลือกผู้ขอเพิ่มเข้าระบบ --'
                    : '-- เลือกหน่วยงานก่อน --'}
                </option>

                {filteredRequesters.map((requester) => (
                  <option
                    key={requester.id}
                    value={requester.id}
                  >
                    {[requester.rank, requester.name]
                      .filter(Boolean)
                      .join(' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>ข้อมูลผู้บันทึก</h3>
              <p>
                ระบุศูนย์และเจ้าหน้าที่ผู้บันทึกข้อมูลรถเข้าระบบ
              </p>
            </div>
          </div>

          <div className="modern-grid grid-2">

            <div className="modern-field">
              <label>
                ศูนย์ผู้บันทึก <span className="req">*</span>
              </label>

              {profile?.role === 'center' ? (
                <input
                  type="text"
                  value={
                    selectedRecordCenter?.name ||
                    profile?.agency ||
                    '-'
                  }
                  disabled
                />
              ) : (
                <select
                  value={recordCenterId}
                  onChange={handleRecordCenterChange}
                  required
                >
                  <option value="">
                    -- เลือกศูนย์ผู้บันทึก --
                  </option>

                  {centers.map((center) => (
                    <option
                      key={center.id}
                      value={center.id}
                    >
                      {center.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="modern-field">
              <label>
                ผู้บันทึกข้อมูล <span className="req">*</span>
              </label>

              <select
                value={recordMemberId}
                onChange={handleRecordMemberChange}
                disabled={!recordCenterId}
                required
              >
                <option value="">
                  {recordCenterId
                    ? '-- เลือกผู้บันทึกข้อมูล --'
                    : '-- เลือกศูนย์ก่อน --'}
                </option>

                {filteredCenterMembers.map((member) => (
                  <option
                    key={member.id}
                    value={member.id}
                  >
                    {[member.rank, member.name]
                      .filter(Boolean)
                      .join(' ')}
                  </option>
                ))}
              </select>
            </div>

          </div>
        </div>

        <div className="form-card">

          <div className="section-title-row">

            <div>
              <h3>รูปรถ</h3>

              <p>
                รูปหลักของรถ จำนวน 1 รูป
              </p>
            </div>

          </div>

          <div className="vehicle-image-upload">

            <div
              className={`image-preview-box ${
                isDragging ? 'dragging' : ''
              }`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={handleImagePaste}
              tabIndex={0}
            >

              {imagePreview ? (

                <img
                  src={imagePreview}
                  alt="Preview รถ"
                />

              ) : (

                <div className="empty-image-preview">
                  <span>🚗</span>

                  <strong>
                    ลากรูปมาวางที่นี่
                  </strong>

                  <small>
                    หรือกดเลือกรูปภาพ • JPG / PNG / WEBP ไม่เกิน 5 MB
                  </small>
                </div>

              )}

            </div>

            <div className="image-upload-controls">

              <label
                className="image-select-button"
              >
                {imagePreview
                  ? 'เปลี่ยนรูปภาพ'
                  : 'เลือกรูปภาพ'}

                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  hidden
                />

              </label>

              {imageFile && (

                <div className="selected-file-name">
                  {imageFile.name}
                </div>

              )}

              {isEditMode &&
                existingImagePath &&
                !imageFile && (

                  <div className="existing-image-note">
                    กำลังแสดงรูปที่บันทึกไว้ในระบบ
                  </div>

                )}

            </div>

          </div>

        </div>

        <div className="form-card">
          <div className="section-title-row">
            <div>
              <h3>หมายเหตุ</h3>
              <p>ข้อมูลเพิ่มเติมอื่น ๆ (ถ้ามี)</p>
            </div>
          </div>

          <div className="modern-grid grid-1">
            <div className="modern-field full">
              <label>หมายเหตุ</label>
              <textarea
                name="note"
                value={form.note}
                onChange={handleChange}
                rows="4"
                placeholder="ระบุหมายเหตุเพิ่มเติม"
              />
            </div>
          </div>
        </div>

        {message && (
          <div className={`modern-alert ${messageType}`}>
            {message}
          </div>
        )}

        <div className="form-submit-bar">

          {isEditMode ? (

            <button
              type="button"
              className="secondary-button"
              onClick={onCancel}
              disabled={saving}
            >
              ยกเลิก
            </button>

          ) : (

            <button
              type="button"
              className="secondary-button"
              onClick={resetForm}
              disabled={saving}
            >
              ล้างข้อมูล
            </button>

          )}

          <button
            type="submit"
            className="primary-button"
            disabled={saving || loadingVehicle}
          >

            {saving
              ? 'กำลังบันทึก...'
              : isEditMode
                ? 'บันทึกการแก้ไข'
                : 'บันทึกข้อมูลรถ'}

          </button>

        </div>
      </form>
    </div>
  )
}

export default AddVehicle