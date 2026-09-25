import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function Settings({ profile }) {
  const isAdmin = profile?.role === 'admin'
  const isCenter = profile?.role === 'center'

  const [activeTab, setActiveTab] = useState('agencies')

  const [agencies, setAgencies] = useState([])
  const [requesters, setRequesters] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')

  const formatPhone = (phone) => {
    if (!phone) return ''

    const digits = String(phone).replace(/\D/g, '')

    if (digits.length === 9 || digits.length === 10) {
      return `${digits.slice(0, -7)}-${digits.slice(-7)}`
    }

    return phone
  }

  // =========================
  // AGENCY FORM
  // =========================

  const [agencyForm, setAgencyForm] = useState({
    id: null,
    name: '',
  })

  // =========================
  // REQUESTER FORM
  // =========================

  const [requesterForm, setRequesterForm] = useState({
    id: null,
    name: '',
    rank: '',
    phone: '',
    agency_ids: [],
  })

  const [requesterAgencies, setRequesterAgencies] =
    useState([])

  const [openAgencyIds, setOpenAgencyIds] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  const showMessage = (type, text) => {
    setMessageType(type)
    setMessage(text)
  }

  // =========================
  // LOAD DATA
  // =========================

  const loadData = async () => {
    setLoading(true)
    setMessage('')

    const [
      agencyResult,
      requesterResult,
      requesterAgencyResult,
    ] = await Promise.all([

      supabase
        .from('agencies')
        .select('*')
        .order('name'),

      supabase
        .from('requesters')
        .select('*')
        .is('deleted_at', null)
        .order('name'),

      supabase
        .from('requester_agencies')
        .select('requester_id, agency_id'),

    ])

    if (agencyResult.error) {
      console.error(agencyResult.error)
      showMessage(
        'error',
        `โหลดหน่วยงานไม่สำเร็จ: ${agencyResult.error.message}`
      )
    }

    if (requesterResult.error) {
      console.error(requesterResult.error)
      showMessage(
        'error',
        `โหลดผู้ขอเพิ่มเข้าระบบไม่สำเร็จ: ${requesterResult.error.message}`
      )
    }

    if (requesterAgencyResult.error) {
      console.error(
        requesterAgencyResult.error
      )

      showMessage(
        'error',
        `โหลดความสัมพันธ์หน่วยงานไม่สำเร็จ: ${requesterAgencyResult.error.message}`
      )
    }

    setAgencies(agencyResult.data || [])
    setRequesters(requesterResult.data || [])

    setRequesterAgencies(
      requesterAgencyResult.data || []
    )

    setLoading(false)
  }

  // =========================
  // AGENCY
  // =========================

  const resetAgencyForm = () => {
    setAgencyForm({
      id: null,
      name: '',
    })
  }

  const editAgency = (agency) => {
    setAgencyForm({
      id: agency.id,
      name: agency.name || '',
    })
  }

  const saveAgency = async (e) => {
    e.preventDefault()

    const name = agencyForm.name.trim()

    if (!name) {
      showMessage('error', 'กรุณาระบุชื่อหน่วยงาน')
      return
    }

    setSaving(true)
    setMessage('')

    let error

    if (agencyForm.id) {
      const result = await supabase
        .from('agencies')
        .update({
          name,
        })
        .eq('id', agencyForm.id)

      error = result.error
    } else {
      const result = await supabase
        .from('agencies')
        .insert({
          name,
          active: true,
        })

      error = result.error
    }

    if (error) {
      console.error(error)
      showMessage(
        'error',
        `บันทึกหน่วยงานไม่สำเร็จ: ${error.message}`
      )
    } else {
      showMessage(
        'success',
        agencyForm.id
          ? 'แก้ไขหน่วยงานเรียบร้อยแล้ว'
          : 'เพิ่มหน่วยงานเรียบร้อยแล้ว'
      )

      resetAgencyForm()
      await loadData()
    }

    setSaving(false)
  }

  const toggleAgency = async (agency) => {
    const newActive = !agency.active

    const text = newActive
      ? `เปิดใช้งานหน่วยงาน "${agency.name}" ?`
      : `ปิดใช้งานหน่วยงาน "${agency.name}" ?`

    if (!window.confirm(text)) return

    let error

    if (isCenter) {
      const result = await supabase.rpc(
        'center_set_agency_active',
        {
          p_agency_id: agency.id,
          p_active: newActive,
        }
      )

      error = result.error
    } else {
      const result = await supabase
        .from('agencies')
        .update({
          active: newActive,
        })
        .eq('id', agency.id)

      error = result.error
    }

    if (error) {
      showMessage('error', error.message)
      return
    }

    showMessage(
      'success',
      newActive
        ? 'เปิดใช้งานหน่วยงานแล้ว'
        : 'ปิดใช้งานหน่วยงานแล้ว'
    )

    await loadData()
  }

  const deleteAgency = async (agency) => {
    const confirmed = window.confirm(
      `ยืนยันลบหน่วยงาน "${agency.name}" ถาวร?\n\nการลบไม่สามารถย้อนกลับได้`
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    const { error } = await supabase
      .from('agencies')
      .delete()
      .eq('id', agency.id)

    if (error) {
      console.error(error)

      showMessage(
        'error',
        `ลบหน่วยงานไม่สำเร็จ: ${error.message}`
      )

      setSaving(false)
      return
    }

    if (
      String(agencyForm.id) ===
      String(agency.id)
    ) {
      resetAgencyForm()
    }

    showMessage(
      'success',
      `ลบหน่วยงาน "${agency.name}" เรียบร้อยแล้ว`
    )

    await loadData()
    setSaving(false)
  }

  // =========================
  // REQUESTER
  // =========================

  const resetRequesterForm = () => {
    setRequesterForm({
      id: null,
      name: '',
      rank: '',
      phone: '',
      agency_ids: [],
    })
  }

  const editRequester = (requester) => {
    const agencyIds = requesterAgencies
      .filter(
        (item) =>
          String(item.requester_id) ===
          String(requester.id)
      )
      .map((item) =>
        String(item.agency_id)
      )

    setRequesterForm({
      id: requester.id,
      name: requester.name || '',
      rank: requester.rank || '',
      phone: requester.phone || '',
      agency_ids: agencyIds,
    })
  }

  const toggleRequesterAgency = (agencyId) => {
    const value = String(agencyId)

    setRequesterForm((prev) => {
      const exists =
        prev.agency_ids.includes(value)

      return {
        ...prev,
        agency_ids: exists
          ? prev.agency_ids.filter(
              (id) => id !== value
            )
          : [...prev.agency_ids, value],
      }
    })
  }

  const saveRequester = async (e) => {
    e.preventDefault()

    const name =
      requesterForm.name.trim()

    const phone =
      requesterForm.phone.trim()

    const agencyIds =
      requesterForm.agency_ids

    if (!name) {
      showMessage(
        'error',
        'กรุณาระบุชื่อผู้ขอเพิ่มเข้าระบบ'
      )
      return
    }

    if (agencyIds.length === 0) {
      showMessage(
        'error',
        'กรุณาเลือกอย่างน้อย 1 หน่วยงาน'
      )
      return
    }

    setSaving(true)
    setMessage('')

    try {
      let requesterId =
        requesterForm.id

      const firstAgencyId =
        agencyIds.length > 0
          ? Number(agencyIds[0])
          : null

      const requesterData = {
        name,
        rank:
          requesterForm.rank.trim() ||
          null,

        phone:
          phone || null,

        // เก็บไว้ชั่วคราว
        // เพื่อรองรับโค้ดหน้าเก่า
        agency_id:
          firstAgencyId,
      }

      // =========================
      // UPDATE REQUESTER
      // =========================

      if (requesterId) {
        const { error } =
          await supabase
            .from('requesters')
            .update(requesterData)
            .eq('id', requesterId)

        if (error) {
          throw error
        }
      }

      // =========================
      // CREATE REQUESTER
      // =========================

      else {
        const {
          data,
          error,
        } = await supabase
          .from('requesters')
          .insert({
            ...requesterData,
            active: true,
          })
          .select('id')
          .single()

        if (error) {
          throw error
        }

        requesterId = data.id
      }

      // =========================
      // ลบ Agency เก่า
      // =========================

      const {
        error: deleteAgencyError,
      } = await supabase
        .from('requester_agencies')
        .delete()
        .eq(
          'requester_id',
          requesterId
        )

      if (deleteAgencyError) {
        throw deleteAgencyError
      }

      // =========================
      // เพิ่ม Agency ชุดใหม่
      // =========================

      const agencyRows =
        agencyIds.map((agencyId) => ({
          requester_id:
            requesterId,

          agency_id:
            Number(agencyId),
        }))

      const {
        error: insertAgencyError,
      } = await supabase
        .from('requester_agencies')
        .insert(agencyRows)

      if (insertAgencyError) {
        throw insertAgencyError
      }

      showMessage(
        'success',
        requesterForm.id
          ? 'แก้ไขผู้ขอเพิ่มเข้าระบบเรียบร้อยแล้ว'
          : 'เพิ่มผู้ขอเพิ่มเข้าระบบเรียบร้อยแล้ว'
      )

      resetRequesterForm()

      await loadData()
    } catch (error) {
      console.error(error)

      showMessage(
        'error',
        `บันทึกข้อมูลไม่สำเร็จ: ${error.message}`
      )
    } finally {
      setSaving(false)
    }
  }

  const toggleRequester = async (requester) => {
    const newActive = !requester.active

    const text = newActive
      ? `เปิดใช้งาน "${requester.name}" ?`
      : `ปิดใช้งาน "${requester.name}" ?`

    if (!window.confirm(text)) return

    let error

      if (isCenter) {
        const result = await supabase.rpc(
          'center_set_requester_active',
          {
            p_requester_id: requester.id,
            p_active: newActive,
          }
        )

        error = result.error
      } else {
        const result = await supabase
          .from('requesters')
          .update({
            active: newActive,
          })
          .eq('id', requester.id)

        error = result.error
      }

    if (error) {
      showMessage('error', error.message)
      return
    }

    showMessage(
      'success',
      newActive
        ? 'เปิดใช้งานเรียบร้อยแล้ว'
        : 'ปิดใช้งานเรียบร้อยแล้ว'
    )

    await loadData()
  }

  const deleteRequester = async (requester) => {
    const fullName = [
      requester.rank,
      requester.name,
    ]
      .filter(Boolean)
      .join(' ')

    const confirmed = window.confirm(
      `ยืนยันลบ "${fullName}" ออกจากการใช้งาน?\n\nข้อมูลเก่าที่ยังอ้างอิงบุคคลนี้จะยังคงอยู่`
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    const { error } = await supabase
      .from('requesters')
      .update({
        active: false,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', requester.id)

    if (error) {
      console.error(error)

      showMessage(
        'error',
        `ลบข้อมูลไม่สำเร็จ: ${error.message}`
      )

      setSaving(false)
      return
    }

    if (
      String(requesterForm.id) ===
      String(requester.id)
    ) {
      resetRequesterForm()
    }

    showMessage(
      'success',
      `ลบ "${fullName}" ออกจากการใช้งานแล้ว`
    )

    await loadData()
    setSaving(false)
  }

  const getAgencyName = (agencyId) => {
    return (
      agencies.find(
        (agency) =>
          String(agency.id) === String(agencyId)
      )?.name || '-'
    )
  }

  const getRequesterAgencyNames = (requesterId) => {
    return requesterAgencies
      .filter(
        (item) =>
          String(item.requester_id) ===
          String(requesterId)
      )
      .map((item) =>
        agencies.find(
          (agency) =>
            String(agency.id) ===
            String(item.agency_id)
        )?.name
      )
      .filter(Boolean)
  }

  const toggleRequesterAgencyGroup = (agencyId) => {
    const value = String(agencyId)

    setOpenAgencyIds((prev) =>
      prev.includes(value)
        ? prev.filter((id) => id !== value)
        : [...prev, value]
    )
  }


  const getRequestersByAgency = (agencyId) => {
    const requesterIds = new Set(
      requesterAgencies
        .filter(
          (item) =>
            String(item.agency_id) ===
            String(agencyId)
        )
        .map((item) =>
          String(item.requester_id)
        )
    )

    return requesters.filter((requester) =>
      requesterIds.has(String(requester.id))
    )
  }

  // =========================
  // ADMIN ONLY
  // =========================

  if (
    profile?.role !== 'admin' &&
    profile?.role !== 'center'
  ) {
    return (
      <div className="settings-denied">
        ไม่มีสิทธิ์เข้าถึงหน้าตั้งค่าระบบ
      </div>
    )
  }

  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    )
  }

  return (
    <div className="settings-page">

      <div className="settings-header">
        <div>
          <div className="hero-badge">
            SYSTEM SETTINGS
          </div>

          <h2>ตั้งค่าระบบ</h2>

          <p>
            จัดการหน่วยงานและผู้ขอเพิ่มรถเข้าสู่ระบบ
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadData}
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


      {/* TABS */}

      <div className="settings-tabs">

        <button
          className={
            activeTab === 'agencies'
              ? 'settings-tab active'
              : 'settings-tab'
          }
          onClick={() =>
            setActiveTab('agencies')
          }
        >
          หน่วยงาน
        </button>

        <button
          className={
            activeTab === 'requesters'
              ? 'settings-tab active'
              : 'settings-tab'
          }
          onClick={() =>
            setActiveTab('requesters')
          }
        >
          ผู้ขอเพิ่มเข้าระบบ
        </button>

      </div>


      {/* =================================
          AGENCIES
      ================================= */}

      {activeTab === 'agencies' && (
        <div className="settings-layout">

          <div className="settings-form-card">

            <h3>
              {agencyForm.id
                ? 'แก้ไขหน่วยงาน'
                : 'เพิ่มหน่วยงาน'}
            </h3>

            <form onSubmit={saveAgency}>

              <div className="modern-field">
                <label>ชื่อหน่วยงาน</label>

                <input
                  value={agencyForm.name}
                  onChange={(e) =>
                    setAgencyForm((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  placeholder="ระบุชื่อหน่วยงาน"
                />
              </div>

              <div className="settings-form-actions">

                {agencyForm.id && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetAgencyForm}
                  >
                    ยกเลิก
                  </button>
                )}

                <button
                  className="primary-button"
                  disabled={saving}
                >
                  {agencyForm.id
                    ? 'บันทึกการแก้ไข'
                    : 'เพิ่มหน่วยงาน'}
                </button>

              </div>

            </form>

          </div>


          <div className="settings-list-card">

            <h3>
              รายการหน่วยงาน ({agencies.length})
            </h3>

            <div className="settings-list">

              {agencies.map((agency) => (
                <div
                  className={`settings-row ${
                    !agency.active
                      ? 'inactive'
                      : ''
                  }`}
                  key={agency.id}
                >

                  <div>
                    <strong>
                      {agency.name}
                    </strong>

                    <span
                      className={
                        agency.active
                          ? 'settings-status active'
                          : 'settings-status inactive'
                      }
                    >
                      {agency.active
                        ? 'ใช้งาน'
                        : 'ปิดใช้งาน'}
                    </span>
                  </div>

                <div className="settings-row-actions">

                  {isAdmin && (
                    <button
                      className="settings-edit-button"
                      onClick={() => editAgency(agency)}
                    >
                      แก้ไข
                    </button>
                  )}

                  <button
                    className={
                      agency.active
                        ? 'settings-disable-button'
                        : 'settings-enable-button'
                    }
                    onClick={() => toggleAgency(agency)}
                  >
                    {agency.active
                      ? 'ปิดใช้งาน'
                      : 'เปิดใช้งาน'}
                  </button>

                  {isAdmin && (
                    <button
                      className="settings-disable-button"
                      onClick={() => deleteAgency(agency)}
                      disabled={saving}
                    >
                      ลบถาวร
                    </button>
                  )}

                </div>  

                </div>
              ))}

            </div>

          </div>

        </div>
      )}


      {/* =================================
          REQUESTERS
      ================================= */}

      {activeTab === 'requesters' && (
        <div className="settings-layout">

          <div className="settings-form-card">

            <h3>
              {requesterForm.id
                ? 'แก้ไขผู้ขอเพิ่มเข้าระบบ'
                : 'เพิ่มผู้ขอเพิ่มเข้าระบบ'}
            </h3>

            <form onSubmit={saveRequester}>

             <div className="requester-basic-grid">

                <div className="modern-field">
                  <label>ยศ / ตำแหน่ง</label>

                  <input
                    value={requesterForm.rank}
                    onChange={(e) =>
                      setRequesterForm((prev) => ({
                        ...prev,
                        rank: e.target.value,
                      }))
                    }
                    placeholder="เช่น พ.ต.อ."
                  />
                </div>

                <div className="modern-field">
                  <label>ชื่อ - นามสกุล</label>

                  <input
                    value={requesterForm.name}
                    onChange={(e) =>
                      setRequesterForm((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    placeholder="ชื่อ - นามสกุล"
                  />
                </div>

              </div>

              <div className="modern-field">
                <label>เบอร์โทรศัพท์</label>

                <input
                  type="tel"
                  value={requesterForm.phone}
                  onChange={(e) =>
                    setRequesterForm((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                  placeholder="เช่น 081-234-5678"
                />
              </div>  


              <div className="modern-field">
                <label>
                  หน่วยงานที่เกี่ยวข้อง
                </label>

                <div className="requester-agency-options">
                  {agencies
                    .filter((agency) => agency.active)
                    .map((agency) => {
                      const checked =
                        requesterForm.agency_ids.includes(
                          String(agency.id)
                        )

                      return (
                        <label
                          key={agency.id}
                          className={`requester-agency-option ${
                            checked ? 'selected' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              toggleRequesterAgency(agency.id)
                            }
                          />

                          <span className="requester-agency-check">
                            {checked ? '✓' : ''}
                          </span>

                          <span className="requester-agency-text">
                            {agency.name}
                          </span>
                        </label>
                      )
                    })}
                </div>     
                {requesterForm.agency_ids.length > 0 && (
                  <div className="requester-selected-agencies">
                    {requesterForm.agency_ids.map((agencyId) => {
                      const agency = agencies.find(
                        (item) =>
                          String(item.id) === String(agencyId)
                      )

                      if (!agency) return null

                      return (
                        <span
                          key={agency.id}
                          className="requester-selected-chip"
                        >
                          {agency.name}
                        </span>
                      )
                    })}
                  </div>
                )}    
              </div>




              <div className="settings-form-actions">

                {requesterForm.id && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetRequesterForm}
                  >
                    ยกเลิก
                  </button>
                )}

                <button
                  className="primary-button"
                  disabled={saving}
                >
                  {requesterForm.id
                    ? 'บันทึกการแก้ไข'
                    : 'เพิ่มข้อมูล'}
                </button>

              </div>

            </form>

          </div>


          <div className="settings-list-card">

            <h3>
              ผู้ขอเพิ่มเข้าระบบ ({requesters.length})
            </h3>

            <div className="requester-agency-groups">

              {agencies.map((agency) => {
                const members =
                  getRequestersByAgency(agency.id)

                if (members.length === 0) {
                  return null
                }

                const isOpen =
                  openAgencyIds.includes(
                    String(agency.id)
                  )

                return (
                  <div
                    key={agency.id}
                    className={`requester-agency-group ${
                      isOpen ? 'open' : ''
                    }`}
                  >

                    <button
                      type="button"
                      className="requester-agency-group-header"
                      onClick={() =>
                        toggleRequesterAgencyGroup(
                          agency.id
                        )
                      }
                      aria-expanded={isOpen}
                    >

                      <span className="requester-group-title">
                        {agency.name}
                      </span>

                      <span className="requester-group-count">
                        {members.length} คน
                      </span>

                      <span className="requester-group-arrow">
                        {isOpen ? '▼' : '▶'}
                      </span>

                    </button>


                    {isOpen && (
                      <div className="requester-agency-group-content">

                        {members.map((requester) => (
                          <div
                            key={requester.id}
                            className={`requester-group-member ${
                              !requester.active
                                ? 'inactive'
                                : ''
                            }`}
                          >

                            <div className="requester-group-member-info">

                              <strong>
                                {[
                                  requester.rank,
                                  requester.name,
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              </strong>


                              <div className="requester-group-member-meta">

                                {requester.phone && (
                                  <span className="requester-phone">
                                    📞 {formatPhone(requester.phone)}
                                  </span>
                                )}

                                <span
                                  className={`settings-status-pill ${
                                    requester.active
                                      ? 'active'
                                      : 'inactive'
                                  }`}
                                >
                                  {requester.active
                                    ? 'ใช้งาน'
                                    : 'ปิดใช้งาน'}
                                </span>

                              </div>

                            </div>


                            <div className="settings-row-actions">

                              {isAdmin && (
                                <button
                                  className="settings-edit-button"
                                  onClick={() =>
                                    editRequester(requester)
                                  }
                                >
                                  แก้ไข
                                </button>
                              )}

                              <button
                                className={
                                  requester.active
                                    ? 'settings-disable-button'
                                    : 'settings-enable-button'
                                }
                                onClick={() =>
                                  toggleRequester(requester)
                                }
                              >
                                {requester.active
                                  ? 'ปิดใช้งาน'
                                  : 'เปิดใช้งาน'}
                              </button>

                              {isAdmin && (
                                <button
                                  className="settings-disable-button"
                                  onClick={() =>
                                    deleteRequester(requester)
                                  }
                                  disabled={saving}
                                >
                                  ลบออกจากระบบ
                                </button>
                              )}

                            </div>

                          </div>
                        ))}

                      </div>
                    )}

                  </div>
                )
              })}

            </div>

          </div>

        </div>
      )}

    </div>
  )
}

export default Settings