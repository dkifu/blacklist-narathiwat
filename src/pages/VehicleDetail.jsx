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

    if (data.image_path) {
      const signedImageUrl =
        await createVehicleImageUrl(
          data.image_path,
          3600
        )

      setVehicleImageUrl(
        signedImageUrl
      )
    } else {
      setVehicleImageUrl('')
    }

    // รถ + รูปพร้อมแล้วค่อยเปิดหน้า
    setLoading(false)

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

        if (vehicle.image_path) {
          const { data } = supabase.storage
            .from('vehicle-images')
            .getPublicUrl(vehicle.image_path)

          imageUrl = data?.publicUrl || null
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
                <h3>รูปรถ</h3>

                <p>
                ภาพหลักที่บันทึกไว้ในระบบ
                </p>
            </div>

            {vehicleImageUrl && (
              <a
                href={vehicleImageUrl}
                target="_blank"
                rel="noreferrer"
                className="open-image-button"
              >
                เปิดภาพเต็ม
              </a>
            )}
                

            </div>

            <div className="detail-photo-frame">

            {vehicleImageUrl ? (
              <img
                src={vehicleImageUrl}
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
                    wide
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
                    <h2 className="detail-main-plate">
                        {fullPlate || '-'}
                    </h2>

                    <div className="detail-main-province">
                        {vehicle.province || '-'}
                    </div>

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
                    label="ลักษณะอื่น ๆ"
                    value={vehicle.vehicle_description}
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
}) {
  return (
    <div
      className={`detail-item ${
        wide ? 'wide' : ''
      }`}
    >
      <span>{label}</span>

      <strong>
        {value || '-'}
      </strong>
    </div>
  )
}

export default VehicleDetail