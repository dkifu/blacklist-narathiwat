
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

function Users({ profile }) {
  const [centers, setCenters] = useState([])
  const [members, setMembers] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [watchLevels, setWatchLevels] = useState([])

  const [activeTab, setActiveTab] = useState('members')
  const [centerUsers, setCenterUsers] = useState([])
  const [loadingCenterUsers, setLoadingCenterUsers] = useState(false)

  const [showCenterUserForm, setShowCenterUserForm] = useState(false)
    const [savingCenterUser, setSavingCenterUser] = useState(false)
    const [editingCenterUserId, setEditingCenterUserId] = useState(null)

    const [passwordTarget, setPasswordTarget] = useState(null)
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [savingPassword, setSavingPassword] = useState(false)

    const [centerUserForm, setCenterUserForm] = useState({
        center_id: '',
        center_name: '',
        center_code: '',
        username: '',
        email: '',
        password: '',
    })

  const [selectedCenterId, setSelectedCenterId] =
    useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] =
    useState('success')

  const [showForm, setShowForm] = useState(false)

  const [memberForm, setMemberForm] = useState({
    id: null,
    center_id: '',
    name: '',
    rank: '',
    position: '',
  })

  const isAdmin = profile?.role === 'admin'
  const isCenterUser = profile?.role === 'center'

  // =========================================
  // LOAD
  // =========================================

  useEffect(() => {
    const start = async () => {
        await loadData()

        if (profile?.role === 'admin') {
        await loadCenterUsers()
        }
    }

    start()
    }, [profile?.id])

  const loadData = async () => {
    setLoading(true)
    setMessage('')

    const [
      centerResult,
      memberResult,
      vehicleResult,
      levelResult,
    ] = await Promise.all([
      supabase
        .from('centers')
        .select('*')
        .order('name'),

      supabase
        .from('center_members')
        .select('*')
        .order('name'),

      supabase
        .from('vehicles')
        .select(
          `
            id,
            created_center_id,
            created_member_id,
            watch_level_id,
            case_status
          `
        ),

      supabase
        .from('watch_levels')
        .select('*')
        .order('sort_order'),
    ])

    if (centerResult.error) {
      console.error(centerResult.error)
    }

    if (memberResult.error) {
      console.error(memberResult.error)
    }

    if (vehicleResult.error) {
      console.error(vehicleResult.error)
    }

    if (levelResult.error) {
      console.error(levelResult.error)
    }

    const centerData = centerResult.data || []

    setCenters(centerData)
    setMembers(memberResult.data || [])
    setVehicles(vehicleResult.data || [])
    setWatchLevels(levelResult.data || [])

    // User ศูนย์ = ใช้ศูนย์ตัวเองทันที
    if (isCenterUser && profile?.center_id) {
      setSelectedCenterId(
        String(profile.center_id)
      )
    }

    // Admin = เลือกศูนย์แรกเป็นค่าเริ่มต้น
    if (
      isAdmin &&
      !selectedCenterId &&
      centerData.length > 0
    ) {
      setSelectedCenterId(
        String(centerData[0].id)
      )
    }

    setLoading(false)
  }

  const loadCenterUsers = async () => {
    if (profile?.role !== 'admin') return

    setLoadingCenterUsers(true)

    const {
      data: sessionData,
      error: sessionError,
    } = await supabase.auth.getSession()

    if (
      sessionError ||
      !sessionData?.session?.access_token
    ) {
      showMessage(
        'error',
        'ไม่พบ Session สำหรับเรียกจัดการ User ศูนย์'
      )

      setLoadingCenterUsers(false)
      return
    }

    const { data, error } =
      await supabase.functions.invoke(
        'manage-center-users',
        {
          body: {
            action: 'list',
          },

          headers: {
            Authorization:
              `Bearer ${sessionData.session.access_token}`,
          },
        }
      )

    if (error) {
      console.error(error)

      let realMessage = error.message

      try {
        const errorBody =
          await error.context?.json()

        if (errorBody?.error) {
          realMessage = errorBody.error
        }
      } catch (parseError) {
        console.error(
          'อ่าน Edge Function Error ไม่สำเร็จ',
          parseError
        )
      }

      showMessage(
        'error',
        `โหลด User ศูนย์ไม่สำเร็จ: ${realMessage}`
      )

      setLoadingCenterUsers(false)
      return
    }

    if (data?.error) {
      showMessage(
        'error',
        data.error
      )

      setLoadingCenterUsers(false)
      return
    }

    setCenterUsers(data?.users || [])
    setLoadingCenterUsers(false)
  }

    // =========================================
    // CENTER USER FORM
    // =========================================

    const resetCenterUserForm = () => {
    setCenterUserForm({
        center_id: '',
        center_name: '',
        center_code: '',
        username: '',
        email: '',
        password: '',
    })

    setEditingCenterUserId(null)
    setShowCenterUserForm(false)
    }

    const openAddCenterUser = () => {
        setPasswordTarget(null)
        setEditingCenterUserId(null)
        setCenterUserForm({
            center_id: '',
            center_name: '',
            center_code: '',
            username: '',
            email: '',
            password: '',
        })

        setShowCenterUserForm(true)
        }

        const openAddUserForExistingCenter = (center) => {
            setPasswordTarget(null)
            setEditingCenterUserId(null)

            setCenterUserForm({
                center_id: String(center.center_id),
                center_name: center.center_name || '',
                center_code: center.center_code || '',
                username: '',
                email: '',
                password: '',
            })

            setShowCenterUserForm(true)

            window.scrollTo({
                top: 0,
                behavior: 'smooth',
            })
            }


            const openEditCenterUser = (center) => {
                setPasswordTarget(null)
                setEditingCenterUserId(center.user_id)

                setCenterUserForm({
                    center_id: String(center.center_id),
                    center_name: center.center_name || '',
                    center_code: center.center_code || '',
                    username: center.username || '',
                    email: center.email || '',
                    password: '',
                })

            setShowCenterUserForm(true)

            window.scrollTo({
                top: 0,
                behavior: 'smooth',
            })
            }

    const saveCenterUser = async (e) => {
        e.preventDefault()

        // สร้างศูนย์ใหม่
        if (
            !centerUserForm.center_id &&
            !centerUserForm.center_name.trim()
        ) {
            showMessage(
            'error',
            'กรุณาระบุชื่อศูนย์'
            )
            return
        }

        if (
            !centerUserForm.center_id &&
            !centerUserForm.center_code.trim()
        ) {
            showMessage(
            'error',
            'กรุณาระบุรหัสศูนย์'
            )
            return
        }

        if (!centerUserForm.username.trim()) {
            showMessage(
            'error',
            'กรุณาระบุ Username'
            )
            return
        }

        if (!centerUserForm.email.trim()) {
            showMessage(
            'error',
            'กรุณาระบุ Email'
            )
            return
        }

        if (
            !editingCenterUserId &&
            !centerUserForm.password
            ) {
            showMessage(
            'error',
            'กรุณาระบุ Password'
            )
            return
        }

        setSavingCenterUser(true)
        setMessage('')

        const { data, error } =
            await supabase.functions.invoke(
            'manage-center-users',
            {
                body: editingCenterUserId
                    ? {
                        action: 'update',

                        user_id: editingCenterUserId,

                        center_id:
                            Number(centerUserForm.center_id),

                        center_name:
                            centerUserForm.center_name.trim(),

                        center_code:
                            centerUserForm.center_code.trim(),

                        username:
                            centerUserForm.username.trim(),

                        email:
                            centerUserForm.email.trim(),
                        }
                    : {
                        action: 'create',

                        center_id:
                            centerUserForm.center_id
                            ? Number(centerUserForm.center_id)
                            : null,

                        center_name:
                            centerUserForm.center_name.trim(),

                        center_code:
                            centerUserForm.center_code.trim(),

                        username:
                            centerUserForm.username.trim(),

                        email:
                            centerUserForm.email.trim(),

                        password:
                            centerUserForm.password,
                        },
            }
            )

        if (error) {
            console.error(error)

            let errorMessage = error.message

            try {
                const errorBody =
                await error.context?.json()

                if (errorBody?.error) {
                errorMessage = errorBody.error
                }
            } catch (parseError) {
                console.error(
                'อ่านรายละเอียด Error ไม่สำเร็จ',
                parseError
                )
            }

            showMessage(
                'error',
                `สร้างไม่สำเร็จ: ${errorMessage}`
            )

            setSavingCenterUser(false)
            return
            }

        if (data?.error) {
            showMessage(
            'error',
            data.error
            )

            setSavingCenterUser(false)
            return
        }

        showMessage(
            'success',
            editingCenterUserId
                ? 'แก้ไขศูนย์และ User เรียบร้อยแล้ว'
                : centerUserForm.center_id
                ? 'สร้าง User ให้ศูนย์เรียบร้อยแล้ว'
                : 'สร้างศูนย์และ User เรียบร้อยแล้ว'
            )

        resetCenterUserForm()

        await loadCenterUsers()
        await loadData()

        setSavingCenterUser(false)
        }

        const toggleCenterUser = async (center) => {
            const newActive = !center.active

            const confirmText = newActive
                ? `ต้องการเปิดใช้งาน "${center.center_name}" ใช่หรือไม่ ?`
                : `ต้องการปิดใช้งาน "${center.center_name}" ใช่หรือไม่ ?`

            if (!window.confirm(confirmText)) {
                return
            }

            setMessage('')

            const { data, error } =
                await supabase.functions.invoke(
                'manage-center-users',
                {
                    body: {
                    action: 'set_active',
                    center_id: Number(center.center_id),
                    user_id: center.user_id,
                    active: newActive,
                    },
                }
                )

            if (error) {
                console.error(error)

                showMessage(
                'error',
                `${
                    newActive
                    ? 'เปิดใช้งาน'
                    : 'ปิดใช้งาน'
                }ไม่สำเร็จ: ${error.message}`
                )

                return
            }

            if (data?.error) {
                showMessage(
                'error',
                data.error
                )

                return
            }

            showMessage(
                'success',
                newActive
                ? 'เปิดใช้งานศูนย์และ User เรียบร้อยแล้ว'
                : 'ปิดใช้งานศูนย์และ User เรียบร้อยแล้ว'
            )

            await loadCenterUsers()
            await loadData()
        }

        const openPasswordForm = (center) => {
            setPasswordTarget(center)
            setNewPassword('')
            setConfirmPassword('')
            setShowCenterUserForm(false)

            window.scrollTo({
                top: 0,
                behavior: 'smooth',
            })
            }


            const closePasswordForm = () => {
            setPasswordTarget(null)
            setNewPassword('')
            setConfirmPassword('')
            }


            const saveCenterPassword = async (e) => {
            e.preventDefault()

            if (!passwordTarget?.user_id) {
                showMessage(
                'error',
                'ไม่พบ User ที่ต้องการเปลี่ยน Password'
                )
                return
            }

            if (newPassword.length < 6) {
                showMessage(
                'error',
                'Password ต้องมีอย่างน้อย 6 ตัวอักษร'
                )
                return
            }

            if (newPassword !== confirmPassword) {
                showMessage(
                'error',
                'Password และยืนยัน Password ไม่ตรงกัน'
                )
                return
            }

            setSavingPassword(true)
            setMessage('')

            const { data, error } =
                await supabase.functions.invoke(
                'manage-center-users',
                {
                    body: {
                    action: 'password',
                    user_id: passwordTarget.user_id,
                    password: newPassword,
                    },
                }
                )

            if (error) {
                console.error(error)

                showMessage(
                'error',
                `เปลี่ยน Password ไม่สำเร็จ: ${error.message}`
                )

                setSavingPassword(false)
                return
            }

            if (data?.error) {
                showMessage(
                'error',
                data.error
                )

                setSavingPassword(false)
                return
            }

            showMessage(
                'success',
                `เปลี่ยน Password ของ ${passwordTarget.center_name} เรียบร้อยแล้ว`
            )

            closePasswordForm()
            setSavingPassword(false)
        }

        const deleteCenterUser = async (center) => {
            if (!isAdmin) return

            const input = window.prompt(
                `ต้องการลบ "${center.center_name}" ถาวร\n\n` +
                `การลบนี้จะลบ User Login ของศูนย์ด้วย\n\n` +
                `พิมพ์ชื่อศูนย์ "${center.center_name}" เพื่อยืนยัน`
            )

            if (input === null) {
                return
            }

            if (input !== center.center_name) {
                window.alert(
                'ชื่อศูนย์ที่พิมพ์ไม่ตรง ยกเลิกการลบ'
                )
                return
            }

            setMessage('')

            const { data, error } =
                await supabase.functions.invoke(
                'manage-center-users',
                {
                    body: {
                    action: 'delete',
                    center_id: Number(center.center_id),
                    user_id: center.user_id || null,
                    },
                }
                )

            if (error) {
                console.error(error)

                let errorMessage = error.message

                try {
                    const errorBody = await error.context?.json()

                    if (errorBody?.error) {
                    errorMessage = errorBody.error
                    }
                } catch (parseError) {
                    console.error(
                    'อ่านรายละเอียด Error ไม่สำเร็จ',
                    parseError
                    )
                }

                showMessage(
                    'error',
                    errorMessage
                )

                return
            }

            if (data?.error) {
                showMessage(
                'error',
                data.error
                )
                return
            }

            showMessage(
                'success',
                `ลบ ${center.center_name} ถาวรเรียบร้อยแล้ว`
            )

            setPasswordTarget(null)
            resetCenterUserForm()

            await loadCenterUsers()
            await loadData()
            }

  // =========================================
  // FILTER MEMBERS
  // =========================================

  const filteredMembers = useMemo(() => {
    if (!selectedCenterId) return []

    return members.filter(
      (member) =>
        String(member.center_id) ===
        String(selectedCenterId)
    )
  }, [members, selectedCenterId])

  const selectedCenter = centers.find(
    (center) =>
      String(center.id) ===
      String(selectedCenterId)
  )

  // =========================================
  // STATS
  // =========================================

  const getMemberStats = (memberId) => {
    const memberVehicles = vehicles.filter(
      (vehicle) =>
        String(vehicle.created_member_id) ===
        String(memberId)
    )

    const stats = {
      total: memberVehicles.length,
      open: 0,
      closed: 0,
      levels: {},
    }

    memberVehicles.forEach((vehicle) => {
      if (vehicle.case_status === 'closed') {
        stats.closed += 1
      } else {
        stats.open += 1
      }

      const level = watchLevels.find(
        (item) =>
          String(item.id) ===
          String(vehicle.watch_level_id)
      )

      const levelName =
        level?.name || 'ไม่ระบุระดับ'

      stats.levels[levelName] =
        (stats.levels[levelName] || 0) + 1
    })

    return stats
  }

  // =========================================
  // FORM
  // =========================================

  const resetForm = () => {
    setMemberForm({
      id: null,
      center_id: selectedCenterId,
      name: '',
      rank: '',
      position: '',
    })

    setShowForm(false)
  }

  const openAddMember = () => {
    if (!selectedCenterId) {
      showMessage(
        'error',
        'กรุณาเลือกศูนย์ก่อน'
      )
      return
    }

    setMemberForm({
      id: null,
      center_id: selectedCenterId,
      name: '',
      rank: '',
      position: '',
    })

    setShowForm(true)
  }

  const editMember = (member) => {
    setMemberForm({
      id: member.id,
      center_id: String(member.center_id),
      name: member.name || '',
      rank: member.rank || '',
      position: member.position || '',
    })

    setShowForm(true)

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  const showMessage = (type, text) => {
    setMessageType(type)
    setMessage(text)
  }

  const saveMember = async (e) => {
    e.preventDefault()

    const name = memberForm.name.trim()

    if (!name) {
      showMessage(
        'error',
        'กรุณาระบุชื่อสมาชิก'
      )
      return
    }

    if (!memberForm.center_id) {
      showMessage(
        'error',
        'กรุณาระบุศูนย์'
      )
      return
    }

    setSaving(true)
    setMessage('')

    const memberData = {
      center_id: Number(
        memberForm.center_id
      ),

      name,

      rank:
        memberForm.rank.trim() || null,

      position:
        memberForm.position.trim() || null,
    }

    let error

    if (memberForm.id) {
      const result = await supabase
        .from('center_members')
        .update(memberData)
        .eq('id', memberForm.id)

      error = result.error
    } else {
      const result = await supabase
        .from('center_members')
        .insert({
          ...memberData,
          active: true,
        })

      error = result.error
    }

    if (error) {
      console.error(error)

      showMessage(
        'error',
        `บันทึกไม่สำเร็จ: ${error.message}`
      )

      setSaving(false)
      return
    }

    showMessage(
      'success',
      memberForm.id
        ? 'แก้ไขสมาชิกเรียบร้อยแล้ว'
        : 'เพิ่มสมาชิกเรียบร้อยแล้ว'
    )

    resetForm()
    await loadData()

    setSaving(false)
  }

  // =========================================
  // ACTIVE / INACTIVE
  // =========================================

  const toggleMember = async (member) => {
    const newActive = !member.active

    const confirmText = newActive
      ? `เปิดใช้งาน "${member.name}" ?`
      : `ปิดใช้งาน "${member.name}" ?`

    if (!window.confirm(confirmText)) return

    const { error } = await supabase
      .from('center_members')
      .update({
        active: newActive,
      })
      .eq('id', member.id)

    if (error) {
      showMessage(
        'error',
        error.message
      )
      return
    }

    showMessage(
      'success',
      newActive
        ? 'เปิดใช้งานสมาชิกแล้ว'
        : 'ปิดใช้งานสมาชิกแล้ว'
    )

    await loadData()
  }

  // =========================================
  // DELETE - ADMIN ONLY
  // =========================================

  const deleteMember = async (member) => {
    if (!isAdmin) return

    const input = window.prompt(
      `หากต้องการลบ "${member.name}" ถาวร\n\nพิมพ์ชื่อสมาชิกเพื่อยืนยัน`
    )

    if (input !== member.name) {
      if (input !== null) {
        window.alert(
          'ชื่อที่พิมพ์ไม่ตรง ยกเลิกการลบ'
        )
      }

      return
    }

    const { error } = await supabase
      .from('center_members')
      .delete()
      .eq('id', member.id)

    if (error) {
      showMessage(
        'error',
        `ลบไม่สำเร็จ: ${error.message}`
      )
      return
    }

    showMessage(
      'success',
      'ลบสมาชิกถาวรเรียบร้อยแล้ว'
    )

    await loadData()
  }

  // =========================================
  // LOADING
  // =========================================

  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลดข้อมูลผู้ใช้งาน...</p>
      </div>
    )
  }

  // =========================================
  // PAGE
  // =========================================

  return (
    <div className="users-page">

      {/* HEADER */}

      <div className="users-header">

        <div>
          <div className="hero-badge">
            USER MANAGEMENT
          </div>

          <h2>ผู้ใช้งาน</h2>

          <p>
            จัดการ User ศูนย์ สมาชิกประจำศูนย์
            และตรวจสอบสถิติการบันทึกรถ
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={async () => {
            await loadData()

            if (isAdmin) {
                await loadCenterUsers()
            }
            }}
        >
          รีเฟรชข้อมูล
        </button>

      </div>

      {message && (
        <div
            className={`modern-alert ${messageType}`}
        >
            {message}
        </div>
        )}


        {isAdmin && (
        <div className="settings-tabs">

            <button
            className={
                activeTab === 'centerUsers'
                ? 'settings-tab active'
                : 'settings-tab'
            }
            onClick={() =>
                setActiveTab('centerUsers')
            }
            >
            จัดการศูนย์
            </button>

            <button
            className={
                activeTab === 'members'
                ? 'settings-tab active'
                : 'settings-tab'
            }
            onClick={() =>
                setActiveTab('members')
            }
            >
            สมาชิกประจำศูนย์
            </button>

        </div>
        )}

{isAdmin && activeTab === 'centerUsers' && (
  <div className="users-member-card">

    <div className="users-member-heading">
      <div>
        <h3>จัดการศูนย์</h3>
        <p>
          User สำหรับ Login ประจำแต่ละศูนย์
        </p>
      </div>

      <button
        className="primary-button"
        type="button"
        onClick={openAddCenterUser}
      >
        + เพิ่มศูนย์
      </button>
    </div>

    {showCenterUserForm && (
        <div className="users-form-card">

            <div className="section-title-row">
            <div>
                <h3>
                {editingCenterUserId
                    ? 'แก้ไขศูนย์และ User'
                    : centerUserForm.center_id
                    ? 'สร้าง User ให้ศูนย์เดิม'
                    : 'เพิ่มศูนย์'}
                </h3>

                <p>
                {centerUserForm.center_id
                    ? `${centerUserForm.center_name} • ${centerUserForm.center_code}`
                    : 'สร้างศูนย์และบัญชี Login พร้อมกัน'}
                </p>
            </div>
            </div>


            <form
            className="modern-grid grid-3"
            onSubmit={saveCenterUser}
            autoComplete="off"
            >

            {/* ชื่อศูนย์ */}

            <div className="modern-field">
                <label>
                ชื่อศูนย์
                <span className="req"> *</span>
                </label>

                <input
                value={centerUserForm.center_name}
                onChange={(e) =>
                    setCenterUserForm((prev) => ({
                    ...prev,
                    center_name: e.target.value,
                    }))
                }
                placeholder="เช่น ศูนย์ปัตตานี"
                disabled={
                    Boolean(centerUserForm.center_id) &&
                    !editingCenterUserId
                }
                required={!centerUserForm.center_id}
                autoComplete="off"
                />
            </div>


            {/* รหัสศูนย์ */}

            <div className="modern-field">
                <label>
                รหัสศูนย์
                <span className="req"> *</span>
                </label>

                <input
                value={centerUserForm.center_code}
                onChange={(e) =>
                    setCenterUserForm((prev) => ({
                    ...prev,
                    center_code: e.target.value.toUpperCase(),
                    }))
                }
                placeholder="เช่น PTN"
                disabled={
                    Boolean(centerUserForm.center_id) &&
                    !editingCenterUserId
                }
                required={!centerUserForm.center_id}
                maxLength={10}
                autoComplete="off"
                />
            </div>


            {/* Username */}

            <div className="modern-field">
                <label>
                Username
                <span className="req"> *</span>
                </label>

                <input
                value={centerUserForm.username}
                onChange={(e) =>
                    setCenterUserForm((prev) => ({
                    ...prev,
                    username: e.target.value,
                    }))
                }
                placeholder="เช่น pattani"
                required
                autoComplete="off"
                />
            </div>


            {/* Email */}

            <div className="modern-field">
                <label>
                Email
                <span className="req"> *</span>
                </label>

                <input
                type="email"
                value={centerUserForm.email}
                onChange={(e) =>
                    setCenterUserForm((prev) => ({
                    ...prev,
                    email: e.target.value,
                    }))
                }
                placeholder="เช่น pattani@naracctv.co.th"
                required
                autoComplete="off"
                />
            </div>


            {/* Password */}

            {!editingCenterUserId && (
            <div className="modern-field">
                <label>
                Password
                <span className="req"> *</span>
                </label>

                <input
                type="password"
                value={centerUserForm.password}
                onChange={(e) =>
                    setCenterUserForm((prev) => ({
                    ...prev,
                    password: e.target.value,
                    }))
                }
                placeholder="อย่างน้อย 6 ตัวอักษร"
                minLength={6}
                required
                autoComplete="new-password"
                />
            </div>
            )}


            {/* ปุ่ม */}

            <div className="users-form-actions">

                <button
                type="button"
                className="secondary-button"
                onClick={resetCenterUserForm}
                >
                ยกเลิก
                </button>

                <button
                type="submit"
                className="primary-button"
                disabled={savingCenterUser}
                >
                {savingCenterUser
                    ? 'กำลังบันทึก...'
                    : editingCenterUserId
                        ? 'บันทึกการแก้ไข'
                        : centerUserForm.center_id
                        ? 'สร้าง User ศูนย์'
                        : 'สร้างศูนย์'}
                </button>

            </div>

            </form>

        </div>
        )}

        {passwordTarget && (
            <div className="users-form-card">

                <div className="section-title-row">
                <div>
                    <h3>เปลี่ยน Password</h3>

                    <p>
                    {passwordTarget.center_name}
                    {' • '}
                    {passwordTarget.username}
                    </p>
                </div>
                </div>

                <form
                className="modern-grid grid-3"
                onSubmit={saveCenterPassword}
                autoComplete="off"
                >

                <div className="modern-field">
                    <label>
                    Password ใหม่
                    <span className="req"> *</span>
                    </label>

                    <input
                    type="password"
                    value={newPassword}
                    onChange={(e) =>
                        setNewPassword(e.target.value)
                    }
                    minLength={6}
                    placeholder="อย่างน้อย 6 ตัวอักษร"
                    required
                    autoComplete="new-password"
                    />
                </div>

                <div className="modern-field">
                    <label>
                    ยืนยัน Password
                    <span className="req"> *</span>
                    </label>

                    <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) =>
                        setConfirmPassword(e.target.value)
                    }
                    minLength={6}
                    placeholder="กรอก Password ใหม่อีกครั้ง"
                    required
                    autoComplete="new-password"
                    />
                </div>

                <div className="users-form-actions">

                    <button
                    type="button"
                    className="secondary-button"
                    onClick={closePasswordForm}
                    >
                    ยกเลิก
                    </button>

                    <button
                    type="submit"
                    className="primary-button"
                    disabled={savingPassword}
                    >
                    {savingPassword
                        ? 'กำลังเปลี่ยน...'
                        : 'เปลี่ยน Password'}
                    </button>

                </div>

                </form>

            </div>
            )}

    {loadingCenterUsers ? (

    <div className="users-empty">
        กำลังโหลดข้อมูลศูนย์...
    </div>

    ) : centerUsers.length === 0 ? (

    <div className="users-empty">
        ยังไม่มีศูนย์ในระบบ
    </div>

    ) : (

    <div className="settings-list">

        {centerUsers.map((center) => (

        <div
            className={`settings-row ${
            !center.center_active
                ? 'inactive'
                : ''
            }`}
            key={center.center_id}
        >

            {/* ข้อมูลศูนย์ */}

            <div>

            <strong>
                {center.center_name || '-'}
            </strong>

            <small>
                รหัสศูนย์: {center.center_code || '-'}
            </small>


            {center.has_user ? (
                <>
                <small>
                    Username: {center.username || '-'}
                </small>

                <small>
                    Email: {center.email || '-'}
                </small>

                <span
                    className={
                    center.active
                        ? 'settings-status active'
                        : 'settings-status inactive'
                    }
                >
                    {center.active
                    ? 'ใช้งาน'
                    : 'ปิดใช้งาน'}
                </span>
                </>
            ) : (
                <span className="settings-status inactive">
                ยังไม่มี User
                </span>
            )}

            </div>


            {/* ปุ่ม */}

            <div className="settings-row-actions">

            {!center.has_user ? (

                <>
                    <button
                        type="button"
                        className="primary-button"
                        onClick={() =>
                        openAddUserForExistingCenter(center)
                        }
                    >
                        + สร้าง User
                    </button>

                    <button
                        type="button"
                        className="member-delete-button"
                        onClick={() =>
                        deleteCenterUser(center)
                        }
                    >
                        ลบถาวร
                    </button>
                </>

            ) : (
                <>
                <button
                    type="button"
                    className="settings-edit-button"
                    onClick={() =>
                        openEditCenterUser(center)
                    }
                    >
                    แก้ไข
                </button>

                <button
                        type="button"
                        className="settings-edit-button"
                        onClick={() =>
                            openPasswordForm(center)
                        }
                        >
                        เปลี่ยน Password
                    </button>

                <button
                    type="button"
                    className={
                        center.active
                        ? 'settings-disable-button'
                        : 'settings-enable-button'
                    }
                    onClick={() =>
                        toggleCenterUser(center)
                    }
                    >
                    {center.active
                        ? 'ปิดใช้งาน'
                        : 'เปิดใช้งาน'}
                    </button>

                <button
                    type="button"
                    className="member-delete-button"
                    onClick={() =>
                        deleteCenterUser(center)
                    }
                    >
                    ลบถาวร
                </button>
                </>
            )}

            </div>

        </div>

        ))}

    </div>

    )}

  </div>
)}



{activeTab === 'members' && (
  <>

{/* CENTER SELECT */}

<div className="users-toolbar">

        <div className="users-center-info">

          <span>ศูนย์ที่กำลังจัดการ</span>

          {isAdmin ? (

            <select
              value={selectedCenterId}
              onChange={(e) => {
                setSelectedCenterId(
                  e.target.value
                )

                setShowForm(false)
              }}
            >

              <option value="">
                -- เลือกศูนย์ --
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

          ) : (

            <strong>
              {selectedCenter?.name || '-'}
            </strong>

          )}

        </div>


        <button
          className="primary-button"
          onClick={openAddMember}
          disabled={!selectedCenterId}
        >
          + เพิ่มสมาชิก
        </button>

      </div>
      


      {/* MEMBER FORM */}

      {showForm && (
        <div className="users-form-card">

          <div className="section-title-row">

            <div>
              <h3>
                {memberForm.id
                  ? 'แก้ไขสมาชิก'
                  : 'เพิ่มสมาชิกประจำศูนย์'}
              </h3>

              <p>
                {selectedCenter?.name || ''}
              </p>
            </div>

          </div>


          <form
            className="modern-grid grid-3"
            onSubmit={saveMember}
          >

            <div className="modern-field">

              <label>
                ยศ / คำนำหน้า
              </label>

              <input
                value={memberForm.rank}
                onChange={(e) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    rank: e.target.value,
                  }))
                }
                placeholder="เช่น ด.ต."
              />

            </div>


            <div className="modern-field">

              <label>
                ชื่อ - นามสกุล
                <span className="req"> *</span>
              </label>

              <input
                value={memberForm.name}
                onChange={(e) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
                placeholder="ชื่อ - นามสกุล"
                required
              />

            </div>


            <div className="modern-field">

              <label>ตำแหน่ง</label>

              <input
                value={memberForm.position}
                onChange={(e) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    position: e.target.value,
                  }))
                }
                placeholder="เช่น เจ้าหน้าที่ประจำศูนย์"
              />

            </div>


            <div className="users-form-actions">

              <button
                type="button"
                className="secondary-button"
                onClick={resetForm}
              >
                ยกเลิก
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving
                  ? 'กำลังบันทึก...'
                  : memberForm.id
                    ? 'บันทึกการแก้ไข'
                    : 'เพิ่มสมาชิก'}
              </button>

            </div>

          </form>

        </div>
      )}


      {/* MEMBERS */}

      <div className="users-member-card">

        <div className="users-member-heading">

          <div>
            <h3>
              สมาชิกประจำ
              {selectedCenter
                ? ` ${selectedCenter.name}`
                : ''}
            </h3>

            <p>
              สมาชิกทั้งหมด {filteredMembers.length} คน
            </p>
          </div>

        </div>


        {filteredMembers.length === 0 ? (

          <div className="users-empty">
            ยังไม่มีสมาชิกในศูนย์นี้
          </div>

        ) : (

          <div className="member-grid">

            {filteredMembers.map((member) => {
              const stats =
                getMemberStats(member.id)

              return (
                <div
                  className={`member-card ${
                    !member.active
                      ? 'inactive'
                      : ''
                  }`}
                  key={member.id}
                >

                  {/* MEMBER HEADER */}

                  <div className="member-card-header">

                    <div className="member-avatar">

                      {member.name
                        ?.charAt(0)
                        ?.toUpperCase() || 'U'}

                    </div>


                    <div className="member-name">

                      <strong>
                        {[
                          member.rank,
                          member.name,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      </strong>

                      <span>
                        {member.position ||
                          'สมาชิกประจำศูนย์'}
                      </span>

                    </div>


                    <div
                      className={
                        member.active
                          ? 'settings-status active'
                          : 'settings-status inactive'
                      }
                    >
                      {member.active
                        ? 'ใช้งาน'
                        : 'ปิดใช้งาน'}
                    </div>

                  </div>


                  {/* TOTAL */}

                  <div className="member-total">

                    <span>
                      บันทึกรถทั้งหมด
                    </span>

                    <strong>
                      {stats.total}
                    </strong>

                    <small>คัน</small>

                  </div>


                  {/* WATCH LEVELS */}

                  <div className="member-stats">

                    {watchLevels.map(
                      (level) => (
                        <div
                          className="member-stat-item"
                          key={level.id}
                        >

                          <span>
                            {level.name}
                          </span>

                          <strong>
                            {stats.levels[
                              level.name
                            ] || 0}
                          </strong>

                        </div>
                      )
                    )}

                  </div>


                  {/* CASE STATUS */}

                  <div className="member-case-stats">

                    <div>
                      <span>
                        ยังไม่ปิดคดี
                      </span>

                      <strong>
                        {stats.open}
                      </strong>
                    </div>

                    <div>
                      <span>
                        ปิดคดีแล้ว
                      </span>

                      <strong>
                        {stats.closed}
                      </strong>
                    </div>

                  </div>


                  {/* ACTIONS */}

                  <div className="member-actions">

                    <button
                      className="settings-edit-button"
                      onClick={() =>
                        editMember(member)
                      }
                    >
                      แก้ไข
                    </button>

                    <button
                      className={
                        member.active
                          ? 'settings-disable-button'
                          : 'settings-enable-button'
                      }
                      onClick={() =>
                        toggleMember(member)
                      }
                    >
                      {member.active
                        ? 'ปิดใช้งาน'
                        : 'เปิดใช้งาน'}
                    </button>


                    {isAdmin && (
                      <button
                        className="member-delete-button"
                        onClick={() =>
                          deleteMember(member)
                        }
                      >
                        ลบถาวร
                      </button>
                    )}

                  </div>

                </div>
              )
            })}

          </div>

          

        )}

      </div>

        </>
    )}

    </div>
    
    
    
  )
}


export default Users