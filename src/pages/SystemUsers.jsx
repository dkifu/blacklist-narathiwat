import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'


function SystemUsers({ profile }) {

  const [users, setUsers] =
    useState([])

  const [centers, setCenters] =
    useState([])

  const [loading, setLoading] =
    useState(true)

  const [saving, setSaving] =
    useState(false)

  const [message, setMessage] =
    useState('')

  const [
    messageType,
    setMessageType,
  ] = useState('success')


  const [showForm, setShowForm] =
    useState(false)

  const [
    editingUserId,
    setEditingUserId,
  ] = useState(null)


  const [form, setForm] =
    useState({
      full_name: '',
      username: '',
      email: '',
      password: '',
      role: 'supervisor',
      center_id: '',
    })


  const [
    passwordTarget,
    setPasswordTarget,
  ] = useState(null)

  const [
    newPassword,
    setNewPassword,
  ] = useState('')

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState('')

  const [
    savingPassword,
    setSavingPassword,
  ] = useState(false)


  const isAdmin =
    profile?.role === 'admin'


  // =========================================
  // MESSAGE
  // =========================================

  const showMessage = (
    type,
    text
  ) => {

    setMessageType(type)
    setMessage(text)

  }


  // =========================================
  // CALL EDGE FUNCTION
  // =========================================

  const callSystemUsers =
    async (body) => {

      const {
        data: sessionData,
        error: sessionError,
      } =
        await supabase
          .auth
          .getSession()


      const accessToken =
        sessionData
          ?.session
          ?.access_token


      if (
        sessionError ||
        !accessToken
      ) {
        throw new Error(
          'ไม่พบ Session สำหรับจัดการผู้ใช้งาน'
        )
      }


      const {
        data,
        error,
      } =
        await supabase
          .functions
          .invoke(
            'manage-system-users',
            {
              body,

              headers: {
                Authorization:
                  `Bearer ${accessToken}`,
              },
            }
          )


      if (error) {

        let realMessage =
          error.message


        try {

          const errorBody =
            await error
              .context
              ?.json()


          if (
            errorBody?.error
          ) {
            realMessage =
              errorBody.error
          }

        } catch (
          parseError
        ) {

          console.error(
            'อ่าน Edge Function Error ไม่สำเร็จ',
            parseError
          )

        }


        throw new Error(
          realMessage
        )

      }


      if (data?.error) {
        throw new Error(
          data.error
        )
      }


      return data

    }


  // =========================================
  // LOAD DATA
  // =========================================

  const loadData =
    async () => {

      if (!isAdmin) {
        setLoading(false)
        return
      }


      setLoading(true)
      setMessage('')


      try {

        const [
          userResult,
          centerResult,
        ] =
          await Promise.all([

            callSystemUsers({
              action: 'list',
            }),

            supabase
              .from('centers')
              .select(
                'id, name, code, active'
              )
              .eq(
                'active',
                true
              )
              .order('name'),

          ])


        if (
          centerResult.error
        ) {
          throw centerResult.error
        }


        setUsers(
          userResult?.users ||
          []
        )


        setCenters(
          centerResult.data ||
          []
        )


      } catch (error) {

        console.error(error)

        showMessage(
          'error',
          error?.message ||
          'โหลดข้อมูลไม่สำเร็จ'
        )

      } finally {

        setLoading(false)

      }

    }


  useEffect(() => {

    if (isAdmin) {
      loadData()
    } else {
      setLoading(false)
    }

  }, [
    profile?.id,
    profile?.role,
  ])


  // =========================================
  // FORM
  // =========================================

  const resetForm = () => {

    setForm({
      full_name: '',
      username: '',
      email: '',
      password: '',
      role: 'supervisor',
      center_id: '',
    })

    setEditingUserId(null)
    setShowForm(false)

  }


  const openAddUser = () => {

    setPasswordTarget(null)

    setEditingUserId(null)

    setForm({
      full_name: '',
      username: '',
      email: '',
      password: '',
      role: 'supervisor',
      center_id: '',
    })

    setShowForm(true)

  }


  const openEditUser = (
    user
  ) => {

    setPasswordTarget(null)

    setEditingUserId(
      user.id
    )

    setForm({
      full_name:
        user.full_name || '',

      username:
        user.username || '',

      email:
        user.email?.endsWith('@blacklist.example.com')
            ? ''
            : user.email || '',

      password: '',

      role:
        user.role ||
        'supervisor',

      center_id:
        user.center_id
          ? String(
              user.center_id
            )
          : '',
    })


    setShowForm(true)


    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })

  }


  const handleRoleChange =
    (value) => {

      setForm(
        (prev) => ({
          ...prev,

          role: value,

          center_id:
            value ===
            'supervisor'
              ? ''
              : prev.center_id,
        })
      )

    }


  const saveUser =
    async (e) => {

      e.preventDefault()


      if (
        !form.full_name.trim()
      ) {
        showMessage(
          'error',
          'กรุณาระบุชื่อผู้ใช้งาน'
        )
        return
      }


      if (
        !form.username.trim()
      ) {
        showMessage(
          'error',
          'กรุณาระบุ Username'
        )
        return
      }


      


      if (
        !editingUserId &&
        form.password.length < 6
      ) {
        showMessage(
          'error',
          'Password ต้องมีอย่างน้อย 6 ตัวอักษร'
        )
        return
      }


      setSaving(true)
      setMessage('')


      try {

        const body =
          editingUserId
            ? {
                action:
                  'update',

                user_id:
                  editingUserId,

                full_name:
                  form.full_name
                    .trim(),

                username:
                  form.username
                    .trim(),

                email:
                  form.email
                    .trim(),

                role:
                  form.role,

                center_id:
                  form.role ===
                    'operator' &&
                  form.center_id
                    ? Number(
                        form.center_id
                      )
                    : null,
              }
            : {
                action:
                  'create',

                full_name:
                  form.full_name
                    .trim(),

                username:
                  form.username
                    .trim(),

                email:
                  form.email
                    .trim(),

                password:
                  form.password,

                role:
                  form.role,

                center_id:
                  form.role ===
                    'operator' &&
                  form.center_id
                    ? Number(
                        form.center_id
                      )
                    : null,
              }


        await callSystemUsers(
          body
        )


        showMessage(
          'success',
          editingUserId
            ? 'แก้ไขผู้ใช้งานเรียบร้อยแล้ว'
            : 'สร้างผู้ใช้งานเรียบร้อยแล้ว'
        )


        resetForm()

        await loadData()


      } catch (error) {

        console.error(error)

        showMessage(
          'error',
          error?.message ||
          'บันทึกไม่สำเร็จ'
        )

      } finally {

        setSaving(false)

      }

    }


  // =========================================
  // PASSWORD
  // =========================================

  const openPasswordForm =
    (user) => {

      setShowForm(false)

      setPasswordTarget(
        user
      )

      setNewPassword('')
      setConfirmPassword('')


      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      })

    }


  const closePasswordForm =
    () => {

      setPasswordTarget(null)
      setNewPassword('')
      setConfirmPassword('')

    }


  const savePassword =
    async (e) => {

      e.preventDefault()


      if (
        !passwordTarget?.id
      ) {
        return
      }


      if (
        newPassword.length < 6
      ) {

        showMessage(
          'error',
          'Password ต้องมีอย่างน้อย 6 ตัวอักษร'
        )

        return

      }


      if (
        newPassword !==
        confirmPassword
      ) {

        showMessage(
          'error',
          'Password และยืนยัน Password ไม่ตรงกัน'
        )

        return

      }


      setSavingPassword(true)
      setMessage('')


      try {

        await callSystemUsers({
          action:
            'password',

          user_id:
            passwordTarget.id,

          password:
            newPassword,
        })


        showMessage(
          'success',
          `เปลี่ยน Password ของ ${passwordTarget.username} เรียบร้อยแล้ว`
        )


        closePasswordForm()


      } catch (error) {

        console.error(error)

        showMessage(
          'error',
          error?.message ||
          'เปลี่ยน Password ไม่สำเร็จ'
        )

      } finally {

        setSavingPassword(false)

      }

    }


  // =========================================
  // ACTIVE
  // =========================================

  const toggleUser =
    async (user) => {

      const newActive =
        !user.active


      const confirmText =
        newActive
          ? `ต้องการเปิดใช้งาน "${user.username}" ใช่หรือไม่ ?`
          : `ต้องการปิดใช้งาน "${user.username}" ใช่หรือไม่ ?`


      if (
        !window.confirm(
          confirmText
        )
      ) {
        return
      }


      setMessage('')


      try {

        await callSystemUsers({
          action:
            'set_active',

          user_id:
            user.id,

          active:
            newActive,
        })


        showMessage(
          'success',
          newActive
            ? 'เปิดใช้งาน User เรียบร้อยแล้ว'
            : 'ปิดใช้งาน User เรียบร้อยแล้ว'
        )


        await loadData()


      } catch (error) {

        console.error(error)

        showMessage(
          'error',
          error?.message ||
          'เปลี่ยนสถานะไม่สำเร็จ'
        )

      }

    }


  // =========================================
  // DELETE
  // =========================================

  const deleteUser =
    async (user) => {

      const input =
        window.prompt(
          `ต้องการลบ User "${user.username}" ถาวร\n\n` +
          `พิมพ์ Username "${user.username}" เพื่อยืนยัน`
        )


      if (input === null) {
        return
      }


      if (
        input !==
        user.username
      ) {

        window.alert(
          'Username ที่พิมพ์ไม่ตรง ยกเลิกการลบ'
        )

        return

      }


      setMessage('')


      try {

        await callSystemUsers({
          action:
            'delete',

          user_id:
            user.id,
        })


        showMessage(
          'success',
          `ลบ User "${user.username}" เรียบร้อยแล้ว`
        )


        await loadData()


      } catch (error) {

        console.error(error)

        showMessage(
          'error',
          error?.message ||
          'ลบ User ไม่สำเร็จ'
        )

      }

    }


  // =========================================
  // COUNTS
  // =========================================

  const supervisorCount =
    useMemo(
      () =>
        users.filter(
          (item) =>
            item.role ===
            'supervisor'
        ).length,
      [users]
    )


  const operatorCount =
    useMemo(
      () =>
        users.filter(
          (item) =>
            item.role ===
            'operator'
        ).length,
      [users]
    )


  // =========================================
  // ACCESS
  // =========================================

  if (!isAdmin) {

    return (
      <div className="settings-denied">
        ไม่มีสิทธิ์เข้าถึงหน้านี้
      </div>
    )

  }


  if (loading) {

    return (
      <div className="vehicle-list-loading">

        <div className="loader">
        </div>

        <p>
          กำลังโหลดผู้ใช้งานระบบ...
        </p>

      </div>
    )

  }


  // =========================================
  // PAGE
  // =========================================

  return (

    <div className="users-page">


      <div className="users-header">

        <div>

          <div className="hero-badge">
            SYSTEM USER MANAGEMENT
          </div>

          <h2>
            ผู้ใช้งานระบบ
          </h2>

          <p>
            จัดการบัญชี Supervisor และ Operator
          </p>

        </div>


        <button
          type="button"
          className="refresh-button"
          onClick={loadData}
        >
          รีเฟรชข้อมูล
        </button>

      </div>


      {message && (

        <div
          className={
            `modern-alert ${messageType}`
          }
        >
          {message}
        </div>

      )}


      <div className="list-stat-grid">

        <div className="list-stat-card">

          <span>
            ผู้ใช้งานทั้งหมด
          </span>

          <strong>
            {users.length}
          </strong>

          <small>
            บัญชี
          </small>

        </div>


        <div className="list-stat-card">

          <span>
            Supervisor
          </span>

          <strong>
            {supervisorCount}
          </strong>

          <small>
            บัญชี
          </small>

        </div>


        <div className="list-stat-card">

          <span>
            Operator
          </span>

          <strong>
            {operatorCount}
          </strong>

          <small>
            บัญชี
          </small>

        </div>


        <div className="list-stat-card">

          <span>
            เปิดใช้งาน
          </span>

          <strong>
            {
              users.filter(
                (user) =>
                  user.active !==
                  false
              ).length
            }
          </strong>

          <small>
            บัญชี
          </small>

        </div>

      </div>


      <div className="users-toolbar">

        <div className="users-center-info">

          <span>
            การจัดการบัญชี
          </span>

          <strong>
            Supervisor / Operator
          </strong>

        </div>


        <button
          type="button"
          className="primary-button"
          onClick={openAddUser}
        >
          + เพิ่มผู้ใช้งาน
        </button>

      </div>


      {showForm && (

        <div className="users-form-card">

          <div className="section-title-row">

            <div>

              <h3>
                {
                  editingUserId
                    ? 'แก้ไขผู้ใช้งาน'
                    : 'เพิ่มผู้ใช้งานระบบ'
                }
              </h3>

              <p>
                กำหนด Role และขอบเขตศูนย์ที่สามารถใช้งาน
              </p>

            </div>

          </div>


          <form
            className="modern-grid grid-3"
            onSubmit={saveUser}
            autoComplete="off"
          >

            <div className="modern-field">

              <label>
                ชื่อ - นามสกุล
                <span className="req">
                  {' '}*
                </span>
              </label>

              <input
                value={
                  form.full_name
                }
                onChange={(e) =>
                  setForm(
                    (prev) => ({
                      ...prev,
                      full_name:
                        e.target
                          .value,
                    })
                  )
                }
                placeholder="ชื่อ - นามสกุล"
                required
              />

            </div>


            <div className="modern-field">

              <label>
                Username
                <span className="req">
                  {' '}*
                </span>
              </label>

              <input
                value={
                  form.username
                }
                onChange={(e) =>
                  setForm(
                    (prev) => ({
                      ...prev,
                      username:
                        e.target
                          .value,
                    })
                  )
                }
                placeholder="เช่น supervisor01"
                required
                autoComplete="off"
              />

            </div>


            <div className="modern-field">

              <label>
                Email
                <span style={{ color: '#7f8da5' }}>
                    {' '}(ไม่บังคับ)
                </span>
              </label>

              <input
                type="email"
                value={
                  form.email
                }
                onChange={(e) =>
                  setForm(
                    (prev) => ({
                      ...prev,
                      email:
                        e.target
                          .value,
                    })
                  )
                }
                placeholder="example@email.com"
                
                autoComplete="off"
              />

            </div>


            {!editingUserId && (

              <div className="modern-field">

                <label>
                  Password
                  <span className="req">
                    {' '}*
                  </span>
                </label>

                <input
                  type="password"
                  value={
                    form.password
                  }
                  onChange={(e) =>
                    setForm(
                      (prev) => ({
                        ...prev,
                        password:
                          e.target
                            .value,
                      })
                    )
                  }
                  minLength={6}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  required
                  autoComplete="new-password"
                />

              </div>

            )}


            <div className="modern-field">

              <label>
                Role
                <span className="req">
                  {' '}*
                </span>
              </label>

              <select
                value={
                  form.role
                }
                onChange={(e) =>
                  handleRoleChange(
                    e.target.value
                  )
                }
              >

                <option value="supervisor">
                  Supervisor
                </option>

                <option value="operator">
                  Operator
                </option>

              </select>

            </div>


            {
              form.role ===
                'operator' && (

                <div className="modern-field">

                  <label>
                    ศูนย์
                  </label>

                  <select
                    value={
                      form.center_id
                    }
                    onChange={(e) =>
                      setForm(
                        (prev) => ({
                          ...prev,

                          center_id:
                            e.target
                              .value,
                        })
                      )
                    }
                  >

                    <option value="">
                      -- ไม่จำกัดศูนย์ --
                    </option>

                    {
                      centers.map(
                        (center) => (

                          <option
                            key={
                              center.id
                            }
                            value={
                              center.id
                            }
                          >
                            {center.name}
                            {
                              center.code
                                ? ` (${center.code})`
                                : ''
                            }
                          </option>

                        )
                      )
                    }

                  </select>

                </div>

              )
            }


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
                {
                  saving
                    ? 'กำลังบันทึก...'
                    : editingUserId
                    ? 'บันทึกการแก้ไข'
                    : 'สร้างผู้ใช้งาน'
                }
              </button>

            </div>

          </form>

        </div>

      )}


      {passwordTarget && (

        <div className="users-form-card">

          <div className="section-title-row">

            <div>

              <h3>
                เปลี่ยน Password
              </h3>

              <p>
                {passwordTarget.full_name}
                {' • '}
                {passwordTarget.username}
              </p>

            </div>

          </div>


          <form
            className="modern-grid grid-3"
            onSubmit={savePassword}
            autoComplete="off"
          >

            <div className="modern-field">

              <label>
                Password ใหม่
                <span className="req">
                  {' '}*
                </span>
              </label>

              <input
                type="password"
                value={
                  newPassword
                }
                onChange={(e) =>
                  setNewPassword(
                    e.target.value
                  )
                }
                minLength={6}
                required
                autoComplete="new-password"
              />

            </div>


            <div className="modern-field">

              <label>
                ยืนยัน Password
                <span className="req">
                  {' '}*
                </span>
              </label>

              <input
                type="password"
                value={
                  confirmPassword
                }
                onChange={(e) =>
                  setConfirmPassword(
                    e.target.value
                  )
                }
                minLength={6}
                required
                autoComplete="new-password"
              />

            </div>


            <div className="users-form-actions">

              <button
                type="button"
                className="secondary-button"
                onClick={
                  closePasswordForm
                }
              >
                ยกเลิก
              </button>


              <button
                type="submit"
                className="primary-button"
                disabled={
                  savingPassword
                }
              >
                {
                  savingPassword
                    ? 'กำลังบันทึก...'
                    : 'เปลี่ยน Password'
                }
              </button>

            </div>

          </form>

        </div>

      )}


      <div className="users-member-card">

        <div className="users-member-heading">

          <div>

            <h3>
              ผู้ใช้งานระบบ
            </h3>

            <p>
              ทั้งหมด {users.length} บัญชี
            </p>

          </div>

        </div>


        {
          users.length === 0
            ? (

              <div className="users-empty">
                ยังไม่มี Supervisor หรือ Operator
              </div>

            )
            : (

              <div className="member-grid">

                {
                  users.map(
                    (user) => {

                      const center =
                        centers.find(
                          (item) =>
                            String(
                              item.id
                            ) ===
                            String(
                              user.center_id
                            )
                        )


                      return (

                        <div
                          className={
                            `member-card ${
                              user.active ===
                                false
                                ? 'inactive'
                                : ''
                            }`
                          }
                          key={
                            user.id
                          }
                        >

                          <div className="member-card-header">

                            <div className="member-avatar">

                              {
                                user.full_name
                                  ?.charAt(0)
                                  ?.toUpperCase() ||
                                'U'
                              }

                            </div>


                            <div className="member-name">

                              <strong>
                                {
                                  user.full_name ||
                                  '-'
                                }
                              </strong>

                              <span>
                                @{user.username}
                              </span>

                            </div>


                            <div
                              className={
                                user.active !==
                                  false
                                  ? 'settings-status active'
                                  : 'settings-status inactive'
                              }
                            >
                              {
                                user.active !==
                                  false
                                  ? 'ใช้งาน'
                                  : 'ปิดใช้งาน'
                              }
                            </div>

                          </div>


                          <div className="member-stats">

                            <div className="member-stat-item">

                              <span>
                                Role
                              </span>

                              <strong>
                                {
                                  user.role ===
                                    'supervisor'
                                    ? 'Supervisor'
                                    : 'Operator'
                                }
                              </strong>

                            </div>


                            <div className="member-stat-item">

                              <span>
                                ขอบเขต
                              </span>

                              <strong>
                                {
                                  user.role ===
                                    'supervisor'
                                    ? 'ทุกศูนย์'
                                    : user.center_id
                                    ? center?.name ||
                                      'ศูนย์ที่กำหนด'
                                    : 'ทุกศูนย์'
                                }
                              </strong>

                            </div>

                          </div>


                          <div className="member-stat-item">

                            <span>
                              Email
                            </span>

                            <strong>
                              {
                                user.email?.endsWith('@blacklist.example.com')
                                    ? 'ไม่ระบุ'
                                    : user.email || 'ไม่ระบุ'
                              }
                            </strong>

                          </div>


                          <div className="member-actions">

                            <button
                              type="button"
                              className="settings-edit-button"
                              onClick={() =>
                                openEditUser(
                                  user
                                )
                              }
                            >
                              แก้ไข
                            </button>


                            <button
                              type="button"
                              className="settings-edit-button"
                              onClick={() =>
                                openPasswordForm(
                                  user
                                )
                              }
                            >
                              Password
                            </button>


                            <button
                              type="button"
                              className={
                                user.active !==
                                  false
                                  ? 'settings-disable-button'
                                  : 'settings-enable-button'
                              }
                              onClick={() =>
                                toggleUser(
                                  user
                                )
                              }
                            >
                              {
                                user.active !==
                                  false
                                  ? 'ปิด'
                                  : 'เปิด'
                              }
                            </button>


                            <button
                              type="button"
                              className="member-delete-button"
                              onClick={() =>
                                deleteUser(
                                  user
                                )
                              }
                            >
                              ลบ
                            </button>

                          </div>

                        </div>

                      )

                    }
                  )
                }

              </div>

            )
        }

      </div>

    </div>

  )

}


export default SystemUsers