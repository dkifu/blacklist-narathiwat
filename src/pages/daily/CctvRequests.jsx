// CCTV_REQUESTS_HARD_DELETE_V2
// CCTV_REQUESTS_CASE_ACTIONS_V1
// CCTV_REQUESTS_LPR_FIELDS_BOTTOM_V2
// CCTV_REQUESTS_LPR_MONTHLY_V1
// CCTV_REQUESTS_MANUAL_CASE_V4
// CCTV_REQUESTS_FORM_V3_20261109
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCw, UploadCloud, Download, Send, Save, Pencil, FileImage, FileText,
  Video, Trash2, Search, UserPlus, ArrowLeft, Camera, FileArchive, CheckCircle2 } from 'lucide-react'
import * as tus from 'tus-js-client'
import html2canvas from 'html2canvas'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import './CctvRequests.css'
import CctvLprMonthlyReport from './CctvLprMonthlyReport'

const BUCKET = 'cctv-request-assets'
const LIMIT = 200 * 1024 * 1024
const CENTER_NAMES = { 1:'นราธิวาส',2:'ปัตตานี',4:'หาดใหญ่',7:'ตากใบ',8:'สุไหง-โกลก',9:'เบตง' }

// CCTV_REQUESTS_LPR_MONTHLY_V1: LPA/AI classification and Thai registration provinces.
const LPA_AI_SUBTYPES = ['LPR', 'FACE ID', 'IVA', 'อื่นๆ']
const LPR_PROVINCES = ['กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พะเยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี','อุตรดิตถ์','อุทัยธานี','อุบลราชธานี']
const newLprSelections = () => ({ plate:'', face:'', overview:'' })

const SHIFTS = { morning:'กะเช้า', afternoon:'กะบ่าย', night:'กะดึก' }
const EVENT_TYPES = [
  { value: 1, label: 'เหตุการณ์ความไม่สงบ' },
  { value: 2, label: 'อุบัติเหตุ' },
  { value: 3, label: 'อาชญากรรม' },
  { value: 4, label: 'LPA/AI' },
]
const REPORT_COLUMNS = [
  'เลขเคส','วันที่ข้อมูล','เวลา','เจ้าหน้าที่ Operator','ประเภทเหตุ','รหัสเหตุ',
  'วันที่เกิดเหตุ','เวลาเกิดเหตุ','ที่มา alarm','IP Address','Lat','Long','CCTV แห่งชาติ',
]
const todayTH = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})
const nowTH = () => new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false})
const shiftNow = () => { const h = Number(nowTH().slice(0,2)); return h < 8 ? 'night' : h < 16 ? 'morning' : 'afternoon' }
const monthAfter = month => { const [y,m] = month.split('-').map(Number); return `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m+1).padStart(2,'0')}-01` }
const readableSize = n => n < 1048576 ? `${(n/1024).toFixed(0)} KB` : `${(n/1048576).toFixed(1)} MB`
const caseLabel = c => {
  if (c?.case_reference) return c.case_reference
  return c?.case_number != null
    ? `CR-${String(c.case_number).padStart(6,'0')}` // legacy fallback only
    : 'ยังไม่มีเลขเคส'
}
const errMessage = e => e?.message || String(e) || 'เกิดข้อผิดพลาด'
const blankForm = (centerId) => ({
  center_id: centerId, report_date: todayTH(), shift:shiftNow(), network_type:'general', camera_ip:'',
  record_date:todayTH(),record_time:nowTH(),operator_name:'',event_type_code:'',alarm_source:'ใบคำร้อง',
  event_date:todayTH(),event_time:nowTH(),event_description:'',national_cctv_unit:'',case_reference:'',
})

const fileType = file => {
  if (file.type === 'application/pdf') return 'pdf'

  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return 'image'

  if (
    [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-matroska',
      'video/x-msvideo',
      'video/avi'
    ].includes(file.type) ||
    /\.avi$/i.test(file.name)
  ) return 'video'

  return null
}

const exportRow = c => [caseLabel(c),c.record_date||'',c.record_time||'',c.operator_name||'',
  EVENT_TYPES.find(t => t.value === Number(c.event_type_code))?.label || '',c.event_type_code||'',
  c.event_date||'',c.event_time||'',c.alarm_source||'',c.camera_ip||'',
  c.latitude ?? '',c.longitude ?? '',c.national_cctv_unit||'']
const safeName = name => String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,120)

async function uploadObject(file, path, onProgress) {
  const { data:{session}, error:sessionError } = await supabase.auth.getSession()
  if (sessionError || !session?.access_token) throw new Error('กรุณาเข้าสู่ระบบใหม่')
  const url = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/,'')
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('ไม่พบการตั้งค่า Supabase')
  return new Promise((resolve,reject) => {
    const task = new tus.Upload(file, {
      endpoint: `${url}/storage/v1/upload/resumable`,
      uploadDataDuringCreation: true,
      retryDelays: [0,3000,5000,10000,20000],
      chunkSize: 6 * 1024 * 1024,
      headers: { authorization:`Bearer ${session.access_token}`, apikey:key },
      metadata: { bucketName:BUCKET, objectName:path, contentType:file.type, cacheControl:'3600' },
      removeFingerprintOnSuccess:true,
      onProgress: (uploaded,total) => onProgress(Math.round((uploaded / total)*100)),
      onError: reject,
      onSuccess: resolve,
    })
    task.start()
  })
}

async function lookupActiveCameraByIP(centerId, rawIP) {
  const ip = String(rawIP || '').trim()
  if (!ip) return null
  const { data, error } = await supabase.from('camera_inventory')
    .select('id,name,ip,service_box,latitude,longitude,network_type')
    .eq('center_id',Number(centerId)).eq('ip',ip).eq('is_active',true).limit(3)
  if (error) throw error
  if (!data?.length) throw new Error('ไม่พบ IP ในทะเบียนกล้องที่เปิดใช้งานของศูนย์นี้')
  if (data.length > 1) throw new Error('IP ซ้ำระหว่างประเภทเครือข่ายของศูนย์นี้ กรุณาตรวจสอบทะเบียนกล้องก่อนบันทึก')
  return data[0]
}

function Field({label,required=false,children}) {
  return <label className="cr-field"><span>{label}{required && ' *'}</span>{children}</label>
}

export default function CctvRequests({profile}) {
  const role = profile?.role
  const manager = role === 'admin' || role === 'supervisor'
  const central = role === 'center' && Number(profile?.center_id) === 10
  const canEdit = manager || (['center','operator'].includes(role) && [1,2,4,7,8,9].includes(Number(profile?.center_id)))
  const [center,setCenter] = useState(manager ? 1 : Number(profile?.center_id))
  const [month,setMonth] = useState(todayTH().slice(0,7))
  const [cases,setCases] = useState([])
  const [officers,setOfficers] = useState([])
  const [operatorMembers,setOperatorMembers] = useState([])
  const [active,setActive] = useState(null)
  const [form,setForm] = useState(() => blankForm(manager ? 1 : Number(profile?.center_id)))
  const [caseFiles,setCaseFiles] = useState([])
  const [lpaSubtype,setLpaSubtype] = useState('')
  const [plateLetters,setPlateLetters] = useState('')
  const [plateNumber,setPlateNumber] = useState('')
  const [plateProvince,setPlateProvince] = useState('')
  const [lprSelections,setLprSelections] = useState(newLprSelections)
  const [lprSavedSelections,setLprSavedSelections] = useState(newLprSelections)
  const [lprRefresh,setLprRefresh] = useState(0)
  // CCTV_REQUESTS_IMAGE_PREVIEW_V1: private image thumbnails and viewer
  const [evidenceThumbs, setEvidenceThumbs] = useState({})
  const [evidenceViewerId, setEvidenceViewerId] = useState(null)
  const [evidenceZoom, setEvidenceZoom] = useState(false)
  const [officerIds,setOfficerIds] = useState([])
  const [newOfficer,setNewOfficer] = useState(false)
  const [officerForm,setOfficerForm] = useState({rank_name:'',full_name:'',position_name:'',affiliation:'',phone_number:''})
  const [camera,setCamera] = useState(null)
  const [busy,setBusy] = useState('')
  const [progress,setProgress] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const [search,setSearch] = useState('')
  const [selectedImage,setSelectedImage] = useState(null)
  const [previewUrl,setPreviewUrl] = useState('')
  const lprReportRef = useRef(null)
  const saved = Boolean(active?.id)
  const readOnly = active?.status === 'submitted' || !canEdit
  const canGenerateLpr = saved && !readOnly && Number(form.event_type_code) === 4 && lpaSubtype === 'LPR' && ['plate','face','overview'].every(k=>Boolean(lprSelections[k])) && new Set(Object.values(lprSelections)).size === 3 && ['plate','face','overview'].every(k=>lprSelections[k]===lprSavedSelections[k])
  const setField = (k,v) => setForm(f=>({...f,[k]:v}))

  const reload = useCallback(async () => {
    if (!canEdit) return
    setError('')
    try {
      const [caseResult,officerResult,memberResult] = await Promise.all([
        supabase.from('cctv_request_cases').select('*').eq('center_id',center)
          .gte('report_date',`${month}-01`).lt('report_date',monthAfter(month))
          .order('created_at',{ascending:false}).limit(500),
        supabase.from('cctv_request_officers').select('*').eq('center_id',center)
          .eq('is_active',true).order('full_name').limit(500),
        // Existing member registry from Users.jsx; no new table is required.
        supabase.from('center_members').select('id,name,rank,center_id,active')
          .eq('center_id',center).eq('active',true).order('name').limit(1000),
      ])
      if (caseResult.error) throw caseResult.error
      if (officerResult.error) throw officerResult.error
      if (memberResult.error) throw memberResult.error
      setCases(caseResult.data||[])
      setOfficers(officerResult.data||[])
      setOperatorMembers(memberResult.data||[])
    } catch(e) { setError(errMessage(e)) }
  },[canEdit,center,month])
  useEffect(()=>{ reload() },[reload])
  useEffect(()=>{ if(!active) setForm(blankForm(center)) },[center,active])
  useEffect(()=>{ if (!selectedImage) {setPreviewUrl('');return}
    let url = ''; let cancelled=false
    supabase.storage.from(BUCKET).download(selectedImage.storage_path).then(({data,error:downloadError})=>{
      if(cancelled||downloadError||!data)return
      url=URL.createObjectURL(data); setPreviewUrl(url)
    })
    return ()=>{cancelled=true; if(url)URL.revokeObjectURL(url)}
  },[selectedImage])

  // Download images using the signed-in user's Storage permissions (no public bucket).
  useEffect(() => {
    let cancelled = false
    const objectUrls = []
    setEvidenceThumbs({})
    for (const file of caseFiles) {
      if (file.file_type !== 'image' && file.file_type !== 'lpr_report') continue
      supabase.storage.from(BUCKET).download(file.storage_path)
        .then(({ data, error: downloadError }) => {
          if (downloadError || !data || cancelled) return
          const url = URL.createObjectURL(data)
          if (cancelled) { URL.revokeObjectURL(url); return }
          objectUrls.push(url)
          setEvidenceThumbs(prev => ({ ...prev, [file.id]: url }))
        })
        .catch(() => {}) // Keep the existing icon if a preview is unavailable.
    }
    return () => {
      cancelled = true
      objectUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [caseFiles])

  // Keyboard: Esc closes, left/right moves between attached photos.
  useEffect(() => {
    if (!evidenceViewerId) return
    const onPreviewKey = e => {
      if (e.key === 'Escape') {
        setEvidenceViewerId(null)
        setEvidenceZoom(false)
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const images = caseFiles.filter(f => f.file_type === 'image' || f.file_type === 'lpr_report')
      if (images.length < 2) return
      const i = images.findIndex(f => f.id === evidenceViewerId)
      if (i < 0) return
      const step = e.key === 'ArrowRight' ? 1 : -1
      setEvidenceViewerId(images[(i + step + images.length) % images.length].id)
      setEvidenceZoom(false)
    }
    window.addEventListener('keydown', onPreviewKey)
    return () => window.removeEventListener('keydown', onPreviewKey)
  }, [caseFiles, evidenceViewerId])

  const openCase = async c => {
    setError('');setMessage('');setActive(c);setCamera(null)
    setForm({...blankForm(c.center_id),...c,event_type_code:c.event_type_code||''})
    setCaseFiles([]);setOfficerIds([]);setSelectedImage(null)
    setLpaSubtype('');setPlateLetters('');setPlateNumber('');setPlateProvince('')
    setLprSelections(newLprSelections());setLprSavedSelections(newLprSelections())

    try {
      const [files,related,lpaDetails] = await Promise.all([
        supabase.from('cctv_request_files').select('*').eq('case_id',c.id).order('created_at'),
        supabase.from('cctv_request_case_officers').select('officer_id').eq('case_id',c.id),
        supabase.from('cctv_request_lpa_ai_details').select('*').eq('case_id',c.id).maybeSingle(),
      ])
      if(files.error) throw files.error
      if(related.error) throw related.error
      if(lpaDetails.error) throw lpaDetails.error
      const d = lpaDetails.data
      setLpaSubtype(d?.subtype || '')
      setPlateLetters(d?.plate_letters || '')
      setPlateNumber(d?.plate_number || '')
      setPlateProvince(d?.plate_province || '')
      const picks = {
        plate:d?.plate_image_id || '',
        face:d?.face_image_id || '',
        overview:d?.overview_image_id || '',
      }
      setLprSelections(picks)
      setLprSavedSelections({...picks})

      setCaseFiles(files.data||[])
      setOfficerIds(
        (related.data || [])
          .slice(0, 1)
          .map(x => x.officer_id)
      )
      if(c.camera_inventory_id){
        const {data:cam} = await supabase.from('camera_inventory')
          .select('id,name,ip,service_box,latitude,longitude,network_type')
          .eq('id',c.camera_inventory_id).maybeSingle()
        if(cam){setCamera(cam);setForm(f=>({...f,network_type:cam.network_type}))}
      }
    } catch(e){setError(errMessage(e))}
  }
  // CCTV_REQUESTS_HARD_DELETE_V2: permanent deletion for authorized drafts only.
  const removeDraftCase = async c => {
    if (!c?.id || c.status !== 'draft' || busy) return
    if (!window.confirm(
      `ลบเคสแบบร่าง ${caseLabel(c)} พร้อมไฟล์หลักฐานทั้งหมดอย่างถาวร?\n` +
      'การลบนี้ย้อนกลับไม่ได้ และจะลบประวัติที่ผูกกับเคสนี้ด้วย'
    )) return

    setBusy('case-remove')
    setError('')
    setMessage('')
    let storageDeletionStarted = false
    try {
      // Fail before touching evidence if SQL migration or user permission is missing.
      const { data:canDelete, error:checkError } = await supabase.rpc(
        'cctv_request_check_delete_draft', { p_case_id:c.id }
      )
      if (checkError) throw checkError
      if (canDelete !== true) throw new Error('ไม่มีสิทธิ์ลบเคสแบบร่างนี้')

      // Find every Storage object under this case, including unregistered uploads.
      // The current storage layout is <case UUID>/<file UUID>.<extension>.
      const paths = []
      let offset = 0
      while (true) {
        const { data:entries, error:listError } = await supabase.storage
          .from(BUCKET).list(c.id, { limit:1000, offset })
        if (listError) throw listError
        const batch = entries || []
        for (const item of batch) {
          if (item.name && item.id !== null) paths.push(`${c.id}/${item.name}`)
        }
        if (batch.length < 1000) break
        offset += batch.length
      }

      for (let i=0; i<paths.length; i+=100) {
        const { error:storageError } = await supabase.storage
          .from(BUCKET).remove(paths.slice(i,i+100))
        if (storageError) throw storageError
        storageDeletionStarted = true
      }

      const { data:remaining, error:verifyError } = await supabase.storage
        .from(BUCKET).list(c.id, { limit:1 })
      if (verifyError) throw verifyError
      if (remaining?.length) throw new Error('ยังมีวัตถุใน Storage ของเคสนี้ กรุณาตรวจสอบก่อนลบเคส')

      const { error:deleteError } = await supabase.rpc(
        'cctv_request_delete_draft', { p_case_id:c.id }
      )
      if (deleteError) throw deleteError
      await reload()
      setMessage(`ลบเคส ${caseLabel(c)} พร้อมหลักฐานทั้งหมดอย่างถาวรแล้ว`)
    } catch (e) {
      setError(storageDeletionStarted
        ? `การลบยังไม่สมบูรณ์ (ไฟล์บางส่วนอาจถูกลบแล้ว): ${errMessage(e)} กรุณาตรวจสอบก่อนลองใหม่`
        : errMessage(e))
    } finally {
      setBusy('')
    }
  }

  const newCase = () => {setActive({status:'draft'});setForm(blankForm(center));setCaseFiles([]);setOfficerIds([]);setCamera(null);setError('');setMessage('');setSelectedImage(null);setLpaSubtype('');setPlateLetters('');setPlateNumber('');setPlateProvince('');setLprSelections(newLprSelections());setLprSavedSelections(newLprSelections())}
  const findCamera = async () => {
    setCamera(null)
    setError('')
    if(!form.camera_ip?.trim()) return
    try {
      const found = await lookupActiveCameraByIP(form.center_id, form.camera_ip)
      setCamera(found)
      setField('network_type', found.network_type)
      setMessage(found.latitude==null||found.longitude==null
        ? 'พบกล้อง แต่ข้อมูลพิกัดยังไม่ครบ'
        : 'พบกล้องและพิกัดในทะเบียนแล้ว')
    } catch(e) { setError(errMessage(e)) }
  }
  const saveCase = async () => {
    if(readOnly)return null
    const manualNumber = String(form.case_reference || '').trim()
    if (!/^[0-9]{1,9}\/[0-9]{1,15}$/.test(manualNumber) ||
        manualNumber.split('/').some(part => !Number(part))) {
      setError('กรุณากรอกเลขเคสเป็น เลขรายเดือน/เลขสะสม เช่น 01/00125 (ทั้งสองส่วนต้องมากกว่า 0)')
      return null
    }
    if (Number(form.event_type_code) === 4 && !lpaSubtype) {
      setError('กรุณาเลือกหัวข้อย่อย LPA/AI ก่อนบันทึก'); return null
    }
    if (Number(form.event_type_code) === 4 && lpaSubtype === 'LPR') {
      if (!plateLetters.trim() || !/^[0-9]{1,7}$/.test(plateNumber.trim()) || !plateProvince) {
        setError('กรุณากรอกหมวดอักษร เลขทะเบียน (ตัวเลข) และจังหวัดให้ครบ'); return null
      }
      const chosen = Object.values(lprSelections).filter(Boolean)
      if (new Set(chosen).size !== chosen.length) {
        setError('ภาพทะเบียน / FACE / Overview ต้องไม่เป็นไฟล์เดียวกัน'); return null
      }
    }
    setBusy('save');setError('');setMessage('')
    try {
      // Resolve network on every save as well; don't depend on an input blur event.
      const cameraIP = String(form.camera_ip || '').trim()
      const matchedCamera = cameraIP
        ? await lookupActiveCameraByIP(form.center_id, cameraIP)
        : null
      if (matchedCamera) {
        setCamera(matchedCamera)
        setField('network_type', matchedCamera.network_type)
      }
      const payload={
        p_case_reference:manualNumber,
        p_case_id:active?.id||null,p_center_id:Number(form.center_id),p_report_date:form.report_date,
        p_shift:form.shift||shiftNow(),p_network_type:matchedCamera?.network_type||null,
        p_camera_ip:cameraIP||null,
        p_record_date:form.record_date||form.report_date||todayTH(),p_record_time:form.record_time||null,
        p_operator_name:form.operator_name||null,
        p_event_type_code:form.event_type_code?Number(form.event_type_code):null,
        p_alarm_source:(Number(form.event_type_code) === 4 && lpaSubtype === 'LPR') ? 'LPR' : (form.alarm_source||null),p_event_date:form.event_date||null,
        p_event_time:form.event_time||null,p_event_description:form.event_description||null,
        p_national_cctv_unit:form.national_cctv_unit||null,
      }
      const {data:id,error:saveError}=await supabase.rpc('cctv_request_save_draft_manual',payload)
      if(saveError)throw saveError
      // Store subtype and each sighting's 3 image references independently of other cases.
      const { error:lpaSaveError } = await supabase.rpc('cctv_request_save_lpa_ai', {
        p_case_id:id,
        p_subtype:Number(form.event_type_code) === 4 ? lpaSubtype : null,
        p_plate_letters:lpaSubtype === 'LPR' ? plateLetters : null,
        p_plate_number:lpaSubtype === 'LPR' ? plateNumber : null,
        p_plate_province:lpaSubtype === 'LPR' ? plateProvince : null,
        p_plate_image_id:lpaSubtype === 'LPR' ? (lprSelections.plate || null) : null,
        p_face_image_id:lpaSubtype === 'LPR' ? (lprSelections.face || null) : null,
        p_overview_image_id:lpaSubtype === 'LPR' ? (lprSelections.overview || null) : null,
      })
      if(lpaSaveError) throw lpaSaveError
      setLprSavedSelections({...lprSelections})
      setLprRefresh(n=>n+1)

      const {error:officerError}=await supabase.rpc('cctv_request_set_case_officers',{
        p_case_id: id,
        p_officer_ids: officerIds.slice(0, 1),
      })
      if(officerError)throw officerError
      const {data:updated,error:loadError}=await supabase.from('cctv_request_cases')
        .select('*').eq('id',id).single()
      if(loadError)throw loadError
      setActive(updated)
      setForm(f=>({...f,...updated,network_type:f.network_type,event_type_code:updated.event_type_code||''}))
      setMessage(`บันทึกแบบร่าง ${caseLabel(updated)} สำเร็จ`)
      await reload()
      return updated
    } catch(e){setError(errMessage(e));return null}
    finally{setBusy('')}
  }
  const addOfficer = async () => {
    if(!officerForm.full_name.trim()) {setError('กรอกชื่อ-สกุลก่อนค่ะ');return}
    setBusy('officer');setError('')
    try{
      const {data:id,error:addError}=await supabase.rpc('cctv_request_save_officer',{
        p_center_id:Number(form.center_id),p_full_name:officerForm.full_name,
        p_rank_name:officerForm.rank_name||null,p_position_name:officerForm.position_name||null,
        p_affiliation:officerForm.affiliation||null,p_phone_number:officerForm.phone_number||null,
      })
      if(addError)throw addError
      setOfficerIds([id]);setNewOfficer(false)
      setOfficerForm({rank_name:'',full_name:'',position_name:'',affiliation:'',phone_number:''})
      await reload()
      setMessage('เพิ่มเจ้าหน้าที่ในทะเบียนและเลือกให้เคสแล้ว กดบันทึกแบบร่างเพื่อยืนยันการผูกเคส')
    }catch(e){setError(errMessage(e))}
    finally{setBusy('')}
  }
  const performUpload = async (file,type) => {
    if(!active?.id || active.status !== 'draft')throw new Error('กรุณาบันทึกแบบร่างก่อนแนบหลักฐาน')
    if(!type) throw new Error('รองรับ PDF / JPG / PNG / WEBP / MP4 / MOV / WEBM / MKV เท่านั้น')
    const used=caseFiles.reduce((n,f)=>n+Number(f.file_size_bytes),0)
    if(!file.size || file.size+used>LIMIT)throw new Error(`ไฟล์รวมเกิน 200 MiB (เหลือ ${readableSize(LIMIT-used)})`)
    
    
    const extension = (
      file.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] || ''
    ).toLowerCase()

    const path = `${active.id}/${crypto.randomUUID()}${extension}`


    let uploaded=false
    try{
      await uploadObject(file,path,setProgress);uploaded=true
      const {error:regError}=await supabase.rpc('cctv_request_register_file',{
        p_case_id:active.id,p_storage_path:path,p_file_type:type,p_file_name:file.name,
      })
      if(regError)throw regError
    }catch(e){
      if(uploaded)await supabase.storage.from(BUCKET).remove([path]).catch(()=>{})
      throw e
    }
  }
  
  const attachFiles = async source => {
    const files = [
      ...(source?.target?.files ?? source ?? [])
    ]

    if (source?.target?.type === 'file') {
      source.target.value = ''
    }

    if(!files.length)return
    if(files.some(f=>!fileType(f))) {setError('พบไฟล์ชนิดที่ไม่รองรับ');return}
    const pendingBytes=files.reduce((n,f)=>n+f.size,0)
    if(caseFiles.reduce((n,f)=>n+Number(f.file_size_bytes),0)+pendingBytes>LIMIT) {
      setError('ขนาดรวมของไฟล์ที่เลือกและหลักฐานเดิมเกิน 200 MiB');return
    }
    setBusy('upload');setError('');setProgress(0)
    try{
      for(const file of files)await performUpload(file,fileType(file))
      const {data,error:readError}=await supabase.from('cctv_request_files')
        .select('*').eq('case_id',active.id).order('created_at')
      if(readError)throw readError
      setCaseFiles(data||[]);setMessage('อัปโหลดหลักฐานสำเร็จ')
    }catch(e){setError(errMessage(e));
      // Refresh even if some files succeeded before a later file failed.
      const {data}=await supabase.from('cctv_request_files').select('*').eq('case_id',active.id)
      if(data)setCaseFiles(data)
    }finally{setBusy('');setProgress(0)}
  }
  const removeFile = async f => {
    if(!window.confirm(`ลบหลักฐาน ${f.file_name} ?`))return
    setBusy('delete');setError('')
    try{
      const {data:path,error:removeError}=await supabase.rpc('cctv_request_unregister_file',{
        p_file_id:f.id,
      })
      if(removeError)throw removeError
      const {error:storageError}=await supabase.storage.from(BUCKET).remove([path])
      if(storageError)setMessage('ลบรายการแล้ว แต่ยังลบไฟล์ Storage ไม่สำเร็จ: โปรดแจ้งผู้ดูแล')
      setCaseFiles(items=>items.filter(x=>x.id!==f.id))
      setLprSelections(prev=>Object.fromEntries(Object.entries(prev).map(([k,v])=>[k,v===f.id?'':v])))
      setLprSavedSelections(prev=>Object.fromEntries(Object.entries(prev).map(([k,v])=>[k,v===f.id?'':v])))
      setLprRefresh(n=>n+1)
      if(selectedImage?.id===f.id)setSelectedImage(null)
    }catch(e){setError(errMessage(e))}
    finally{setBusy('')}
  }
  const downloadFile = async f => {
    setBusy('download');setError('')
    try{
      const {data,error:downloadError}=await supabase.storage.from(BUCKET).download(f.storage_path)
      if(downloadError)throw downloadError
      saveBlob(data,f.file_name)
    }catch(e){setError(errMessage(e))}
    finally{setBusy('')}
  }
  const saveBlob = (blob,name) => {
    const url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url;a.download=safeName(name);document.body.appendChild(a);a.click();a.remove()
    setTimeout(()=>URL.revokeObjectURL(url),60000)
  }
  const lprImage = async () => {
    if(!active?.id){setError('บันทึกเคสก่อนสร้างภาพรายงาน LPR');return}
    if(!lprReportRef.current)return
    if(!canGenerateLpr){setError('เลือกภาพทั้ง 3 ช่องและบันทึกแบบร่างก่อนสร้างรายงาน LPR');return}
    setBusy('report');setError('')
    try{
      const canvas=await html2canvas(lprReportRef.current,{scale:2,backgroundColor:'#ffffff',useCORS:true})
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
      if(!blob)throw new Error('สร้างภาพรายงานไม่สำเร็จ')
      const file=new File([blob],`LPR_${safeName(caseLabel(active))}.png`,{type:'image/png'})
      await performUpload(file,'lpr_report')
      const {data}=await supabase.from('cctv_request_files').select('*').eq('case_id',active.id).order('created_at')
      setCaseFiles(data||[]);setMessage('สร้างและแนบภาพรายงาน LPR แล้ว')
    }catch(e){setError(errMessage(e))}
    finally{setBusy('')}
  }
  const submit = async () => {
    if(!saved || readOnly)return
    if(!window.confirm(`ยืนยันส่งเคส ${caseLabel(active)}? หลังส่งจะแก้ไขไม่ได้`))return
    setBusy('submit');setError('')
    try{
      const {error:submitError}=await supabase.rpc('cctv_request_submit_case_manual',{p_case_id:active.id})
      if(submitError)throw submitError
      setActive(c=>({...c,status:'submitted'}));setMessage('ส่งเคสเรียบร้อยแล้ว')
      await reload()
    }catch(e){setError(errMessage(e))}
    finally{setBusy('')}
  }
  const downloadZip = async items => {
    if(!items.length){setError('ไม่มีเคสสำหรับดาวน์โหลด');return}
    setBusy('zip');setError('')
    try{
      const zip=new JSZip(), wb=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet([
        REPORT_COLUMNS,...items.map(exportRow),
      ])
      XLSX.utils.book_append_sheet(wb,sheet,'CCTV REQUESTS')
      zip.file('summary.xlsx',XLSX.write(wb,{type:'array',bookType:'xlsx'}))
      let total=0
      for(const c of items){
        const {data:files,error:loadError}=await supabase.from('cctv_request_files').select('*').eq('case_id',c.id)
        if(loadError)throw loadError
        total+=(files||[]).reduce((sum,f)=>sum+Number(f.file_size_bytes),0)
        // Keep large monthly exports out of the browser heap (server-side streaming is a later phase).
        if(total>500*1024*1024)throw new Error('เดือนนี้มีหลักฐานเกิน 500 MiB กรุณาแบ่งช่วงส่งออกหรือใช้บริการ ZIP แบบสตรีมบนเซิร์ฟเวอร์')
        const folder=zip.folder(safeName(caseLabel(c)))
        folder.file('case.json',JSON.stringify(c,null,2))
        for(const f of files||[]){
          const {data:blob,error:dErr}=await supabase.storage.from(BUCKET).download(f.storage_path)
          if(dErr)throw dErr
          folder.file(`${f.id.slice(0,8)}_${safeName(f.file_name)}`,blob)
        }
      }
      const archive=await zip.generateAsync({type:'blob',compression:'STORE'})
      saveBlob(archive,items.length===1?`${caseLabel(items[0])}.zip`:`CCTV_REQUESTS_${month}.zip`)
      setMessage('จัดเตรียม ZIP สำเร็จ')
    }catch(e){setError(errMessage(e))}
    finally{setBusy('')}
  }
  const visibleCases=useMemo(()=>cases.filter(c=>
    [caseLabel(c),c.camera_ip,c.operator_name,c.event_description].some(v=>
      String(v||'').toLowerCase().includes(search.toLowerCase()))
  ),[cases,search])
  const fileBytes=caseFiles.reduce((n,f)=>n+Number(f.file_size_bytes),0)
  const evidenceImages = caseFiles.filter(f => f.file_type === 'image' || f.file_type === 'lpr_report')
  const evidenceIndex = evidenceImages.findIndex(f => f.id === evidenceViewerId)
  const evidenceSelected = evidenceIndex >= 0 ? evidenceImages[evidenceIndex] : null
  const moveEvidence = direction => {
    if (!evidenceImages.length) return
    const next = (evidenceIndex + direction + evidenceImages.length) % evidenceImages.length
    setEvidenceViewerId(evidenceImages[next].id)
    setEvidenceZoom(false)
  }

  const selectedOfficerNames=officers.filter(o=>officerIds.includes(o.id))

  if(central) return <div className="cr-wrap"><div className="cr-panel">บัญชี ศชต. ดูได้เฉพาะแดชบอร์ดยอดรวมที่งานชั่วโมงที่ 8 ไม่สามารถเปิดรายละเอียดเคสหรือหลักฐานรายศูนย์ได้</div></div>
  if(!canEdit)return <div className="cr-wrap"><div className="cr-error">บัญชีนี้ไม่ได้รับสิทธิ์จัดการ CCTV REQUESTS</div></div>

  return <div className="cr-wrap">
    
    <div className="cr-toolbar">
      <div className="cr-toolbar-info">
        <span className="cr-eyebrow">
          CCTV REQUESTS / CASE MANAGEMENT
        </span>

        <h2>ข้อมูลใบคำร้องขอดูภาพ</h2>

        <p>
          จัดการใบคำร้อง บันทึกหลักฐาน
          และติดตามสถานะการส่งเคส CCTV
        </p>
      </div>

      <div className="cr-actions">
        {active && (
          <button
            className="cr-btn"
            onClick={() => {
              setActive(null)
              setMessage('')
              setError('')
              reload()
            }}
          >
            <ArrowLeft size={16} />
            กลับรายการ
          </button>
        )}

        {!active && (
          <button
            className="cr-btn cr-primary"
            onClick={newCase}
          >
            <Plus size={17} />
            สร้างเคสใหม่
          </button>
        )}
      </div>
    </div>

    {error && <div className="cr-error" role="alert">{error}</div>}
    {message && <div className="cr-note">{message}</div>}

    {!active ? <>
      <div className="cr-panel cr-filters">
        {manager && <Field label="ศูนย์"><select value={center} onChange={e=>setCenter(Number(e.target.value))}>{Object.entries(CENTER_NAMES).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field>}
        <Field label="เดือน"><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></Field>
        <Field label="ค้นหา"><div className="cr-input-icon"><Search size={16}/><input placeholder="เลขเคส / IP / Operator" value={search} onChange={e=>setSearch(e.target.value)}/></div></Field>
        <button className="cr-btn" onClick={reload}><RefreshCw size={15}/> รีเฟรช</button>
        <button className="cr-btn" disabled={!cases.length||Boolean(busy)} onClick={()=>downloadZip(cases)}><FileArchive size={15}/> ZIP รายเดือน</button>
      </div>
      <div className="cr-metrics">
        <div><span>เคสทั้งหมด</span><strong>{cases.length}</strong></div>
        <div><span>ส่งแล้ว</span><strong>{cases.filter(c=>c.status==='submitted').length}</strong></div>
        <div><span>แบบร่าง</span><strong>{cases.filter(c=>c.status==='draft').length}</strong></div>
        <div><span>เคส LPR</span><strong>{cases.filter(c=>c.alarm_source==='LPR').length}</strong></div>
      </div>
      <div className="cr-panel cr-table-wrap"><table className="cr-table"><thead><tr><th>เลขเคส</th><th>วันที่ข้อมูล</th><th>กล้อง / IP</th><th>ที่มา</th><th>สถานะ</th><th></th></tr></thead><tbody>
        {visibleCases.map(c=><tr key={c.id}><td><b>{caseLabel(c)}</b></td><td>{c.report_date}<br/><small>{SHIFTS[c.shift]}</small></td>
          <td>{c.camera_name||'-'}<br/><small>{c.camera_ip||'-'}</small></td><td>{c.alarm_source||'-'}</td>
          <td><span className={`cr-status cr-${c.status}`}>{c.status==='submitted'?'ส่งแล้ว':c.status==='draft'?'แบบร่าง':'ยกเลิก'}</span></td>
          <td>
            <div className="cr-case-row-actions">
              {c.status === 'draft' ? <>
                <button type="button" className="cr-btn"
                  disabled={Boolean(busy)} onClick={()=>openCase(c)}
                  title="เปิดเคสแบบร่างเพื่อแก้ไข">
                  <Pencil size={15}/> แก้ไข
                </button>
                <button type="button" className="cr-btn cr-case-danger"
                  disabled={Boolean(busy)} onClick={()=>removeDraftCase(c)}
                  title="ลบเคสแบบร่างและหลักฐานทั้งหมดอย่างถาวร">
                  <Trash2 size={15}/> ลบ
                </button>
              </> : (
                <button type="button" className="cr-btn"
                  disabled={Boolean(busy)} onClick={()=>openCase(c)}>
                  เปิดเคส
                </button>
              )}
            </div>
          </td></tr>)}
        {!visibleCases.length&&<tr><td colSpan="6" className="cr-empty">ยังไม่มีข้อมูลในช่วงที่เลือก</td></tr>}
      </tbody></table></div>
      {cases.length>=500&&<div className="cr-warning">แสดงสูงสุด 500 เคสต่อศูนย์/เดือน ควรแบ่งช่วงก่อนส่งออกข้อมูล</div>}
    </> : <>
      <div className="cr-panel cr-heading"><div><b>{saved?caseLabel(active):'สร้างเคสใหม่'}</b><span className={`cr-status cr-${active.status}`}>{active.status==='submitted'?'ส่งแล้ว':'แบบร่าง'}</span></div>

        <div className="cr-header-case">
          <Field label="เลขเคส (รายเดือน / สะสม)" required>
            <input
              name="case_reference"
              type="text"
              autoComplete="off"
              placeholder="เช่น 01/00125"
              maxLength={25}
              disabled={readOnly}
              value={form.case_reference || ''}
              onChange={e => setField('case_reference', e.target.value)}
            />
          </Field>
        </div>

        <div className="cr-actions"><button className="cr-btn" disabled={!saved||Boolean(busy)} onClick={()=>downloadZip([active])}><Download size={16}/> ZIP รายเคส</button>
          {!readOnly && <><button className="cr-btn" disabled={Boolean(busy)} onClick={saveCase}><Save size={16}/> บันทึกแบบร่าง</button>
          <button className="cr-btn cr-primary" disabled={!saved||Boolean(busy)} onClick={submit}><Send size={16}/> ส่งเคส</button></>}
        </div>
      </div>
      <div className="cr-panel"><h3>1. ข้อมูลเหตุการณ์</h3><div className="cr-grid">
        <Field label="ศูนย์"><select value={form.center_id} disabled>{Object.entries(CENTER_NAMES).map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></Field>

       
        

        <Field label="Operator" required>
          <select disabled={readOnly} value={form.operator_name||''}
            onChange={e=>setField('operator_name',e.target.value)}>
            <option value="">เลือก Operator ผู้ทำเคส</option>
            {form.operator_name && !operatorMembers.some(m=>m.name===form.operator_name) &&
              <option value={form.operator_name}>{form.operator_name} (ข้อมูลเดิม)</option>}
            {operatorMembers.map(m=><option key={m.id} value={m.name}>
              {[m.rank,m.name].filter(Boolean).join(' ')}
            </option>)}
          </select>
        </Field>


        <Field label="ที่มา Alarm" required><select disabled={readOnly} value={form.alarm_source||''} onChange={e=>setField('alarm_source',e.target.value)}><option value="ใบคำร้อง">ใบคำร้อง</option><option value="LPR">LPR</option></select></Field>
        <Field label="วันที่เขียนคำร้อง" required><input type="date" disabled={readOnly} value={form.record_date||''} onChange={e=>setField('record_date',e.target.value)}/></Field>

        <Field label="เวลาเขียนคำร้อง" required><input type="time" disabled={readOnly} value={form.record_time||''} onChange={e=>setField('record_time',e.target.value)}/></Field>
        <Field label="ประเภทเหตุ" required><select disabled={readOnly} value={form.event_type_code||''} onChange={e=>setField('event_type_code',e.target.value)}><option value="">เลือกประเภทเหตุ</option>{EVENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>



        
        <Field label="วันที่เกิดเหตุ" required><input type="date" disabled={readOnly} value={form.event_date||''} onChange={e=>setField('event_date',e.target.value)}/></Field>
        <Field label="เวลาเกิดเหตุ" required><input type="time" disabled={readOnly} value={form.event_time||''} onChange={e=>setField('event_time',e.target.value)}/></Field>
        <Field label="CCTV แห่งชาติ" required><select disabled={readOnly} value={form.national_cctv_unit||''} onChange={e=>setField('national_cctv_unit',e.target.value)}><option value="">เลือกประเภท</option>{['ป้องกันปราบปราม','สืบสวนสอบสวน','จราจร'].map(n=><option key={n}>{n}</option>)}</select></Field>

        <Field label="IP Address กล้อง" required><div className="cr-input-icon"><input disabled={readOnly} value={form.camera_ip||''} onChange={e=>{setField('camera_ip',e.target.value);setCamera(null)}} onBlur={findCamera} placeholder="10.x.x.x"/>{!readOnly&&<button type="button" title="ค้นหากล้อง" onClick={findCamera}><Camera size={16}/></button>}</div></Field>
        <Field label="พิกัดจากทะเบียนกล้อง"><div className="cr-coordinates">Lat {camera?.latitude ?? form.latitude ?? '-'} · Long {camera?.longitude ?? form.longitude ?? '-'}</div></Field>
        <Field label="รายละเอียดเหตุการณ์"><textarea disabled={readOnly} rows="3" value={form.event_description||''} onChange={e=>setField('event_description',e.target.value)}/></Field>
      </div>{camera&&<div className="cr-note">กล้อง: {camera.name} / {camera.service_box||'-'} {camera.latitude==null||camera.longitude==null?' — พิกัดยังไม่ครบ':''}</div>}

      {Number(form.event_type_code) === 4 && (
        <div className="cr-lpr-bottom-fields" style={{marginTop:16}}>
          <div className="cr-grid">
        {Number(form.event_type_code) === 4 && (
          <Field label="หัวข้อย่อย LPA/AI" required>
            <select value={lpaSubtype} disabled={readOnly} onChange={e => {
              setLpaSubtype(e.target.value)
              if (e.target.value === 'LPR') setField('alarm_source', 'LPR')
            }}>
              <option value="">เลือกหัวข้อย่อย</option>
              {LPA_AI_SUBTYPES.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
        )}
        {Number(form.event_type_code) === 4 && lpaSubtype === 'LPR' && <>
          <Field label="หมวดอักษรทะเบียน" required>
            <input value={plateLetters} disabled={readOnly} maxLength={20}
              placeholder="เช่น ขฌ" onChange={e=>setPlateLetters(e.target.value)}/>
          </Field>
          <Field label="เลขทะเบียนรถ" required>
            <input value={plateNumber} disabled={readOnly} maxLength={7}
              inputMode="numeric" placeholder="เช่น 1120"
              onChange={e=>setPlateNumber(e.target.value)}/>
          </Field>
          <Field label="จังหวัดทะเบียน" required>
            <select value={plateProvince} disabled={readOnly} onChange={e=>setPlateProvince(e.target.value)}>
              <option value="">เลือกจังหวัด</option>
              {LPR_PROVINCES.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </>}
          </div>
        </div>
      )}
</div>
      <div className="cr-panel"><div className="cr-section-head"><h3>2. เจ้าหน้าที่ผู้ขอ ({officerIds.length})</h3>{!readOnly&&<button className="cr-btn" onClick={()=>setNewOfficer(v=>!v)}><UserPlus size={16}/> เพิ่มเจ้าหน้าที่</button>}</div>
      
        
      <div className="cr-officers">
        {officers.map(o => (
          <label key={o.id} className="cr-officer">
            <input
              type="radio"
              name="request-officer"
              disabled={readOnly}
              checked={officerIds.includes(o.id)}
              onChange={() => setOfficerIds([o.id])}
            />

            <span>
              <b>
                {o.rank_name || ''} {o.full_name}
              </b>

              <small>
                {o.position_name || '-'} ·{' '}
                {o.affiliation || '-'} ·{' '}
                {o.phone_number || '-'}
              </small>
            </span>
          </label>
        ))}
      </div>

                
        {!officers.length&&<p className="cr-muted">ยังไม่มีรายชื่อในทะเบียนของศูนย์นี้</p>}
        {newOfficer&&!readOnly&&<div className="cr-officer-add cr-grid">{[['rank_name','ยศ'],['full_name','ชื่อ-สกุล'],['position_name','ตำแหน่ง'],['affiliation','สังกัด'],['phone_number','เบอร์โทร']].map(([key,label])=><Field key={key} label={label}><input value={officerForm[key]} onChange={e=>setOfficerForm(v=>({...v,[key]:e.target.value}))}/></Field>)}<button className="cr-btn cr-primary" disabled={Boolean(busy)} onClick={addOfficer}><Plus size={16}/> บันทึกเจ้าหน้าที่</button></div>}
        {readOnly&&active.officers_snapshot?.length>0&&<p className="cr-muted">ข้อมูลผู้ขอขณะส่งเคส: {active.officers_snapshot.map(x=>`${x.rank_name||''} ${x.full_name}`).join(', ')}</p>}
      </div>
      <div className="cr-panel"><div className="cr-section-head"><h3>3. หลักฐานแนบเคส</h3><b>{readableSize(fileBytes)} / 200 MiB</b></div>
        <div className="cr-usage"><div style={{width:`${Math.min(100,(fileBytes/LIMIT)*100)}%`}}/></div>
        {!saved&&<p className="cr-muted">บันทึกแบบร่างก่อน จึงจะแนบไฟล์ได้</p>}
        
        
        {saved && !readOnly && (
          <label
            className={`cr-upload ${isDragging ? 'cr-dragging' : ''}`}
            onDragEnter={e => {
              e.preventDefault()
              if (!busy) setIsDragging(true)
            }}
            onDragOver={e => {
              e.preventDefault()
              e.dataTransfer.dropEffect = busy ? 'none' : 'copy'
              if (!busy) setIsDragging(true)
            }}
            onDragLeave={e => {
              e.preventDefault()
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setIsDragging(false)
              }
            }}
            onDrop={e => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragging(false)
              if (busy) return
              attachFiles(Array.from(e.dataTransfer.files))
            }}
          >
            <UploadCloud size={30} className="cr-upload-icon" />

            <strong>
              {isDragging ? 'วางไฟล์เพื่ออัปโหลด' : 'ลากไฟล์มาวางที่นี่'}
            </strong>

            <span className="cr-upload-desc">
              หรือเลือกไฟล์จากเครื่อง
            </span>

            <span className="cr-upload-picker">
              <Plus size={17} />
              เลือกไฟล์
            </span>

            <span className="cr-upload-types">
              PDF · JPG · PNG · WEBP · MP4 · MOV · WEBM · MKV
              (รวมไม่เกิน 200 MiB)
            </span>

            <input
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska"
              disabled={Boolean(busy)}
              onChange={attachFiles}
            />
          </label>
        )}


        {busy==='upload'&&<p className="cr-muted">กำลังอัปโหลด {progress}%</p>}

        {error && (
          <div className="cr-error" role="alert">
            <strong>แนบหลักฐานไม่สำเร็จ</strong>
            <div>{error}</div>
          </div>
        )}

        <div className="cr-files">{[...caseFiles]
          .sort((a, b) => {
            const order = {
              image: 0,
              lpr_report: 0,
              video: 1,
              pdf: 2
            }

            return (order[a.file_type] ?? 9) - (order[b.file_type] ?? 9)
          })
          .map(f =>
        <div className="cr-file" key={f.id}>{(f.file_type === 'image' || f.file_type === 'lpr_report') ? (
          <button type="button" className="cr-evidence-thumb"
            onClick={() => { setEvidenceViewerId(f.id); setEvidenceZoom(false) }}
            title="คลิกดูภาพขนาดใหญ่" aria-label={`ดูภาพ ${f.file_name}`}>
            {evidenceThumbs[f.id]
              ? <img src={evidenceThumbs[f.id]} alt={f.file_name} loading="lazy" />
              : <FileImage size={22} />}
          </button>
        ) : f.file_type === 'video' ? <Video/> : <FileText/>}<div><b>{f.file_name}</b><small>{f.file_type} · {readableSize(f.file_size_bytes)}</small></div>
          
          <button className="cr-btn" disabled={Boolean(busy)} onClick={()=>downloadFile(f)} title="ดาวน์โหลด"><Download size={16}/></button>
          {!readOnly&&<button className="cr-btn" disabled={Boolean(busy)} onClick={()=>removeFile(f)} title="ลบ"><Trash2 size={16}/></button>}
        </div>)}</div>
      </div>
            {Number(form.event_type_code) === 4 && lpaSubtype === 'LPR' && (
        <CctvLprMonthlyReport
          supabase={supabase} bucket={BUCKET}
          active={active} caseFiles={caseFiles} evidenceThumbs={evidenceThumbs}
          selections={lprSelections} setSelections={setLprSelections}
          reportRef={lprReportRef} onGenerate={lprImage}
          canGenerate={canGenerateLpr} readOnly={readOnly}
          busy={busy} refreshKey={lprRefresh}
          centerNames={CENTER_NAMES}
        />
      )}

      {evidenceSelected && (
        <div className="cr-evidence-overlay" onMouseDown={() => setEvidenceViewerId(null)}>
          <section className="cr-evidence-dialog" role="dialog" aria-modal="true"
            aria-label="ดูภาพหลักฐาน" onMouseDown={e => e.stopPropagation()}>
            <div className="cr-evidence-head">
              <div className="cr-evidence-title">
                <strong>ภาพหลักฐาน</strong>
                <small title={evidenceSelected.file_name}>{evidenceSelected.file_name}</small>
              </div>
              <div className="cr-evidence-controls">
                <button type="button" className="cr-btn" onClick={() => setEvidenceZoom(v => !v)}>
                  {evidenceZoom ? 'ย่อภาพ' : 'ขยายภาพ'}
                </button>
                <button type="button" className="cr-btn" onClick={() => {setEvidenceViewerId(null); setEvidenceZoom(false)}}>
                  ปิด ✕
                </button>
              </div>
            </div>
            <div className={`cr-evidence-stage ${evidenceZoom ? 'cr-evidence-zoom' : ''}`}>
              {evidenceThumbs[evidenceSelected.id]
                ? <img src={evidenceThumbs[evidenceSelected.id]} alt={evidenceSelected.file_name} />
                : <span className="cr-muted">กำลังโหลดภาพหลักฐาน...</span>}
            </div>
            <div className="cr-evidence-footer">
              <button type="button" className="cr-btn" disabled={evidenceImages.length < 2}
                onClick={() => moveEvidence(-1)}>‹ ก่อนหน้า</button>
              <span>{evidenceIndex + 1} / {evidenceImages.length}</span>
              <button type="button" className="cr-btn" disabled={evidenceImages.length < 2}
                onClick={() => moveEvidence(1)}>ถัดไป ›</button>
            </div>
          </section>
        </div>
      )}

      <div className="cr-bottom-actions">{!readOnly&&<><button className="cr-btn" disabled={Boolean(busy)} onClick={saveCase}><Save size={16}/> บันทึกแบบร่าง</button><button className="cr-btn cr-primary" disabled={!saved||Boolean(busy)} onClick={submit}><CheckCircle2 size={16}/> ส่งเคส</button></>}</div>
    </>}
  </div>
}
