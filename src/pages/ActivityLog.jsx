import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

function ActivityLog({ profile }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const [selectedLog, setSelectedLog] = useState(null)

  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')

  const [referenceNames, setReferenceNames] = useState({
    agencies: {},
    watchLevels: {},
    requesters: {},
    centers: {},
    members: {},
 })

  useEffect(() => {
    loadLogs()
    loadReferenceNames()
  }, [])

  const loadLogs = async () => {
    setLoading(true)
    setErrorMessage('')

    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error(error)
      setErrorMessage(
        `ไม่สามารถโหลด Activity Log ได้: ${error.message}`
      )
      setLogs([])
      setLoading(false)
      return
    }

    setLogs(data || [])
    setLoading(false)
  }

  const loadReferenceNames = async () => {
    const [
        agencyResult,
        watchResult,
        requesterResult,
        centerResult,
        memberResult,
    ] = await Promise.all([
        supabase
        .from('agencies')
        .select('id, name'),

        supabase
        .from('watch_levels')
        .select('id, name'),

        supabase
        .from('requesters')
        .select('id, name, rank'),

        supabase
        .from('centers')
        .select('id, name'),

        supabase
        .from('center_members')
        .select('id, name'),
    ])

    const toMap = (items, getName) =>
        Object.fromEntries(
        (items || []).map((item) => [
            String(item.id),
            getName(item),
        ])
        )

    setReferenceNames({
        agencies: toMap(
        agencyResult.data,
        (item) => item.name
        ),

        watchLevels: toMap(
        watchResult.data,
        (item) => item.name
        ),

        requesters: toMap(
        requesterResult.data,
        (item) =>
            [item.rank, item.name]
            .filter(Boolean)
            .join(' ')
        ),

        centers: toMap(
        centerResult.data,
        (item) => item.name
        ),

        members: toMap(
        memberResult.data,
        (item) => item.name
        ),
    })
    }

  const formatDateTime = (value) => {
    if (!value) return '-'

    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(value))
  }

  const getActionLabel = (action) => {
    const labels = {
        // =========================
        // VEHICLE
        // =========================
        vehicle_created: 'เพิ่มรถ',
        vehicle_updated: 'แก้ไขข้อมูลรถ',
        vehicle_closed: 'ปิดคดี',
        vehicle_reopened: 'เปิดคดีอีกครั้ง',
        vehicle_deleted: 'ลบรถ',

        // =========================
        // CENTER
        // =========================
        center_created: 'เพิ่มศูนย์',
        center_updated: 'แก้ไขศูนย์',
        center_enabled: 'เปิดใช้งานศูนย์',
        center_disabled: 'ปิดใช้งานศูนย์',
        center_deleted: 'ลบศูนย์',

        // =========================
        // CENTER USER
        // =========================
        center_user_created: 'สร้าง User ศูนย์',
        center_user_updated: 'แก้ไข User ศูนย์',
        center_user_password_changed: 'เปลี่ยน Password',
        center_user_enabled: 'เปิดใช้งาน User ศูนย์',
        center_user_disabled: 'ปิดใช้งาน User ศูนย์',
        center_user_deleted: 'ลบ User ศูนย์',

        // =========================
        // CENTER MEMBER
        // =========================
        member_created: 'เพิ่มสมาชิกศูนย์',
        member_updated: 'แก้ไขสมาชิกศูนย์',
        member_enabled: 'เปิดใช้งานสมาชิก',
        member_disabled: 'ปิดใช้งานสมาชิก',
        member_deleted: 'ลบสมาชิกศูนย์',

        // =========================
        // AGENCY
        // =========================
        agency_created: 'เพิ่มหน่วยงาน',
        agency_updated: 'แก้ไขหน่วยงาน',
        agency_enabled: 'เปิดใช้งานหน่วยงาน',
        agency_disabled: 'ปิดใช้งานหน่วยงาน',
        agency_deleted: 'ลบหน่วยงาน',

        // =========================
        // REQUESTER
        // =========================
        requester_created: 'เพิ่มผู้ขอเพิ่มรถ',
        requester_updated: 'แก้ไขผู้ขอเพิ่มรถ',
        requester_enabled: 'เปิดใช้งานผู้ขอเพิ่มรถ',
        requester_disabled: 'ปิดใช้งานผู้ขอเพิ่มรถ',
        requester_deleted: 'ลบผู้ขอเพิ่มรถ',
    }

    return labels[action] || action
    }

  const getActionClass = (action) => {
    switch (action) {
        // เพิ่ม / สร้าง
        case 'vehicle_created':
        case 'center_created':
        case 'center_user_created':
        case 'member_created':
        case 'agency_created':
        case 'requester_created':
        return 'created'

        // แก้ไข
        case 'vehicle_updated':
        case 'center_updated':
        case 'center_user_updated':
        case 'member_updated':
        case 'agency_updated':
        case 'requester_updated':
        case 'center_user_password_changed':
        return 'updated'

        // เปิดใช้งาน / เปิดคดี
        case 'vehicle_reopened':
        case 'center_enabled':
        case 'center_user_enabled':
        case 'member_enabled':
        case 'agency_enabled':
        case 'requester_enabled':
        return 'reopened'

        // ปิดใช้งาน / ปิดคดี
        case 'vehicle_closed':
        case 'center_disabled':
        case 'center_user_disabled':
        case 'member_disabled':
        case 'agency_disabled':
        case 'requester_disabled':
        return 'closed'

        // ลบ
        case 'vehicle_deleted':
        case 'center_deleted':
        case 'center_user_deleted':
        case 'member_deleted':
        case 'agency_deleted':
        case 'requester_deleted':
        return 'deleted'

        default:
        return 'default'
    }
    }

    const fieldLabels = {
        plate_number: 'ทะเบียนรถ',
        province: 'จังหวัด',
        brand: 'ยี่ห้อ',
        model: 'รุ่นรถ',
        color: 'สีรถ',
        vehicle_type: 'ประเภทรถ',
        case_province: 'จังหวัดเจ้าของคดี',
        plate_letters: 'หมวดอักษรทะเบียน',
        police_station: 'สถานีตำรวจ',

        vehicle_description: 'ลักษณะรถ',
        engine_number: 'เลขเครื่องยนต์',
        chassis_number: 'เลขตัวถัง',

        detail: 'รายละเอียด',
        note: 'หมายเหตุ',

        case_owner: 'เจ้าของเรื่อง',
        case_status: 'สถานะคดี',

        report_date: 'วันที่รับแจ้ง',
        incident_date: 'วันที่เกิดเหตุ',
        start_date: 'วันที่เริ่มติดตาม',
        end_date: 'วันที่สิ้นสุด',
        removed_date: 'วันที่นำออกจากระบบ',

        watch_level: 'ระดับเฝ้าระวัง',
        watch_level_id: 'ระดับเฝ้าระวัง',

        agency: 'หน่วยงาน',
        agency_id: 'หน่วยงาน',

        requested_by: 'ผู้ขอเพิ่มรถ',
        requested_by_id: 'ผู้ขอเพิ่มรถ',

        image_path: 'รูปภาพ',

        created_center_id: 'ศูนย์ที่บันทึก',
        created_member_id: 'สมาชิกผู้บันทึก',
        created_member_name: 'ผู้บันทึก',

        name: 'ชื่อ',
        code: 'รหัส',
        active: 'สถานะใช้งาน',

        username: 'Username',
        email: 'Email',
        full_name: 'ชื่อผู้ใช้งาน',
        role: 'สิทธิ์',
        center_id: 'ศูนย์',

        password_changed: 'เปลี่ยน Password',
        }

        const ignoredLogFields = [
        'id',
        'user_id',
        'created_at',
        'updated_at',
        'created_by',
        'created_by_user_id',
        'center_name',
        ]

        const formatLogValue = (value) => {
            if (
                value === null ||
                value === undefined ||
                value === ''
            ) {
                return '-'
            }

            if (typeof value === 'boolean') {
                return value
                ? 'เปิดใช้งาน'
                : 'ปิดใช้งาน'
            }

            if (value === 'open') {
                return 'เปิดคดี'
            }

            if (value === 'closed') {
                return 'ปิดคดี'
            }

            if (Array.isArray(value)) {
                return value.length
                ? value.join(', ')
                : '-'
            }

            if (typeof value === 'object') {
                return JSON.stringify(value)
            }

            return String(value)
        }

        const formatFieldValue = (
            key,
            value,
            data = {}
            ) => {
            if (
                value === null ||
                value === undefined ||
                value === ''
            ) {
                return '-'
            }

            if (key === 'agency_id') {
                return (
                referenceNames.agencies[String(value)] ||
                `ID ${value}`
                )
            }

            if (key === 'watch_level_id') {
                return (
                referenceNames.watchLevels[String(value)] ||
                `ID ${value}`
                )
            }

            if (key === 'requested_by_id') {
                return (
                data.requested_by ||
                referenceNames.requesters[String(value)] ||
                `ID ${value}`
                )
            }

            

            if (
                key === 'center_id' ||
                key === 'created_center_id'
            ) {
                return (
                data.center_name ||
                referenceNames.centers[String(value)] ||
                `ID ${value}`
                )
            }

            if (key === 'created_member_id') {
                return (
                data.created_member_name ||
                referenceNames.members[String(value)] ||
                `ID ${value}`
                )
            }

            return formatLogValue(value)
        }

        const getChangedFields = (log) => {
        const oldData = log?.old_data || {}
        const newData = log?.new_data || {}

        const keys = [
            ...new Set([
            ...Object.keys(oldData),
            ...Object.keys(newData),
            ]),
        ]

        return keys
            .filter(
                (key) =>
                !ignoredLogFields.includes(key)
            )

            .filter((key) => {
                const hasValue = (value) =>
                    value !== null &&
                    value !== undefined &&
                    value !== ''

                if (
                    key === 'agency_id' &&
                    (
                    hasValue(oldData.agency) ||
                    hasValue(newData.agency)
                    )
                ) {
                    return false
                }

                if (
                    key === 'watch_level_id' &&
                    (
                    hasValue(oldData.watch_level) ||
                    hasValue(newData.watch_level)
                    )
                ) {
                    return false
                }

                if (
                    key === 'requested_by_id' &&
                    (
                    hasValue(oldData.requested_by) ||
                    hasValue(newData.requested_by)
                    )
                ) {
                    return false
                }

                if (
                    key === 'created_member_id' &&
                    (
                        hasValue(oldData.created_member_name) ||
                        hasValue(newData.created_member_name)
                    )
                    ) {
                    return false
                }

                return true
                })

            .filter((key) => {
                if (!log.old_data || !log.new_data) {
                return true
                }

                return (
                JSON.stringify(oldData[key]) !==
                JSON.stringify(newData[key])
                )
            })
            .filter((key) => {
                const oldValue = oldData[key]
                const newValue = newData[key]

                const oldEmpty =
                oldValue === null ||
                oldValue === undefined ||
                oldValue === ''

                const newEmpty =
                newValue === null ||
                newValue === undefined ||
                newValue === ''

                return !(oldEmpty && newEmpty)
            })
            .map((key) => ({
                key,
                label: fieldLabels[key] || key,
                oldValue: formatFieldValue(
                    key,
                    oldData[key],
                    oldData
                    ),

                    newValue: formatFieldValue(
                    key,
                    newData[key],
                    newData
                    ),
            }))

        }

  const filteredLogs = useMemo(() => {
    const keyword = search.trim().toLowerCase()

    return logs.filter((log) => {
      const searchText = [
        log.username,
        log.full_name,
        log.description,

        // รหัสกิจกรรม
        log.action,

        // ชื่อกิจกรรมภาษาไทย
        getActionLabel(log.action),

        log.user_role,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const matchesSearch =
        !keyword || searchText.includes(keyword)

      const matchesAction =
        !actionFilter ||
        log.action === actionFilter

      const matchesRole =
        !roleFilter ||
        log.user_role === roleFilter

      return (
        matchesSearch &&
        matchesAction &&
        matchesRole
      )
    })
  }, [
    logs,
    search,
    actionFilter,
    roleFilter,
  ])

  const todayLogCount = useMemo(() => {
    const today = new Date()

    return logs.filter((log) => {
        if (!log.created_at) return false

        const logDate = new Date(log.created_at)

        return (
        logDate.getFullYear() === today.getFullYear() &&
        logDate.getMonth() === today.getMonth() &&
        logDate.getDate() === today.getDate()
        )
    }).length
    }, [logs])

    const activeUserCount = useMemo(() => {
    const users = new Set(
        logs
        .map(
            (log) =>
            log.user_id ||
            log.username
        )
        .filter(Boolean)
    )

    return users.size
    }, [logs])

  if (profile?.role !== 'admin') {
    return (
      <div className="settings-denied">
        ไม่มีสิทธิ์เข้าถึง Activity Log
      </div>
    )
  }

  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลด Activity Log...</p>
      </div>
    )
  }

  return (
    <div className="activity-log-page">

      <div className="list-header">
        <div>
          <div className="hero-badge">
            AUDIT TRAIL
          </div>

          <h2>Activity Log</h2>

          <p>
            ตรวจสอบประวัติการทำงานและการเปลี่ยนแปลงข้อมูลในระบบ
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadLogs}
        >
          รีเฟรชข้อมูล
        </button>
      </div>


      <div className="list-stat-grid">

        <div className="list-stat-card">
            <span>กิจกรรมทั้งหมด</span>
            <strong>{logs.length}</strong>
            <small>รายการ</small>
        </div>

        <div className="list-stat-card">
            <span>กิจกรรมวันนี้</span>
            <strong>{todayLogCount}</strong>
            <small>รายการ</small>
        </div>

        <div className="list-stat-card">
            <span>ผู้ใช้งานที่ทำรายการ</span>
            <strong>{activeUserCount}</strong>
            <small>ผู้ใช้งาน</small>
        </div>

        <div className="list-stat-card">
            <span>ผลการค้นหา</span>
            <strong>{filteredLogs.length}</strong>
            <small>รายการ</small>
        </div>

        </div>


      <div className="filter-card">

        <div className="search-box">
          <label>ค้นหา</label>

          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Username / ชื่อ / รายละเอียด..."
          />
        </div>


        <div className="filter-item">
          <label>ประเภทกิจกรรม</label>

          <select
            value={actionFilter}
            onChange={(e) =>
                setActionFilter(e.target.value)
            }
            >
            <option value="">
                ทุกกิจกรรม
            </option>

            <optgroup label="รถ Blacklist">
                <option value="vehicle_created">
                เพิ่มรถ
                </option>

                <option value="vehicle_updated">
                แก้ไขข้อมูลรถ
                </option>

                <option value="vehicle_closed">
                ปิดคดี
                </option>

                <option value="vehicle_reopened">
                เปิดคดีอีกครั้ง
                </option>

                <option value="vehicle_deleted">
                ลบรถ
                </option>
            </optgroup>

            <optgroup label="ศูนย์">
                <option value="center_created">
                เพิ่มศูนย์
                </option>

                <option value="center_updated">
                แก้ไขศูนย์
                </option>

                <option value="center_enabled">
                เปิดใช้งานศูนย์
                </option>

                <option value="center_disabled">
                ปิดใช้งานศูนย์
                </option>

                <option value="center_deleted">
                ลบศูนย์
                </option>
            </optgroup>

            <optgroup label="User ศูนย์">
                <option value="center_user_created">
                สร้าง User ศูนย์
                </option>

                <option value="center_user_updated">
                แก้ไข User ศูนย์
                </option>

                <option value="center_user_password_changed">
                เปลี่ยน Password
                </option>

                <option value="center_user_enabled">
                เปิดใช้งาน User ศูนย์
                </option>

                <option value="center_user_disabled">
                ปิดใช้งาน User ศูนย์
                </option>

                <option value="center_user_deleted">
                ลบ User ศูนย์
                </option>
            </optgroup>

            <optgroup label="สมาชิกศูนย์">
                <option value="member_created">
                เพิ่มสมาชิกศูนย์
                </option>

                <option value="member_updated">
                แก้ไขสมาชิกศูนย์
                </option>

                <option value="member_enabled">
                เปิดใช้งานสมาชิก
                </option>

                <option value="member_disabled">
                ปิดใช้งานสมาชิก
                </option>

                <option value="member_deleted">
                ลบสมาชิกศูนย์
                </option>
            </optgroup>

            <optgroup label="หน่วยงาน">
                <option value="agency_created">
                เพิ่มหน่วยงาน
                </option>

                <option value="agency_updated">
                แก้ไขหน่วยงาน
                </option>

                <option value="agency_enabled">
                เปิดใช้งานหน่วยงาน
                </option>

                <option value="agency_disabled">
                ปิดใช้งานหน่วยงาน
                </option>

                <option value="agency_deleted">
                ลบหน่วยงาน
                </option>
            </optgroup>

            <optgroup label="ผู้ขอเพิ่มรถ">
                <option value="requester_created">
                เพิ่มผู้ขอเพิ่มรถ
                </option>

                <option value="requester_updated">
                แก้ไขผู้ขอเพิ่มรถ
                </option>

                <option value="requester_enabled">
                เปิดใช้งานผู้ขอเพิ่มรถ
                </option>

                <option value="requester_disabled">
                ปิดใช้งานผู้ขอเพิ่มรถ
                </option>

                <option value="requester_deleted">
                ลบผู้ขอเพิ่มรถ
                </option>
            </optgroup>
            </select>
        </div>


        <div className="filter-item">
          <label>สิทธิ์ผู้ใช้</label>

          <select
            value={roleFilter}
            onChange={(e) =>
              setRoleFilter(e.target.value)
            }
          >
            <option value="">
              ทุก Role
            </option>

            <option value="admin">
              Admin
            </option>

            <option value="center">
              Center
            </option>

            <option value="supervisor">
              Supervisor
            </option>

            <option value="operator">
              Operator
            </option>
          </select>
        </div>


        <button
          className="clear-filter-button"
          onClick={() => {
            setSearch('')
            setActionFilter('')
            setRoleFilter('')
          }}
        >
          ล้างตัวกรอง
        </button>

      </div>


      {errorMessage && (
        <div className="modern-alert error">
          {errorMessage}
        </div>
      )}


      {filteredLogs.length === 0 ? (

        <div className="empty-state">
          <div className="empty-icon">
            🕘
          </div>

          <h3>ยังไม่มี Activity Log</h3>

          <p>
            กิจกรรมต่าง ๆ ของระบบจะแสดงที่นี่
          </p>
        </div>

      ) : (

        <div className="vehicle-table-wrap">

          <table className="vehicle-table activity-table">

            <thead>
              <tr>
                <th>วันที่ / เวลา</th>
                <th>ผู้ใช้งาน</th>
                <th>สิทธิ์</th>
                <th>กิจกรรม</th>
                <th>รายละเอียด</th>
                <th>ดูข้อมูล</th>
              </tr>
            </thead>

            <tbody>

              {filteredLogs.map((log) => (

                <tr key={log.id}>

                  <td>
                    <div className="activity-time">
                      {formatDateTime(
                        log.created_at
                      )}
                    </div>
                  </td>

                  <td>
                    <div className="activity-user">

                      <strong>
                        {log.full_name ||
                          log.username ||
                          '-'}
                      </strong>

                      <span>
                        {log.username || '-'}
                      </span>

                    </div>
                  </td>

                  <td>
                    <span className="role-badge">
                      {log.user_role
                        ?.toUpperCase() || '-'}
                    </span>
                  </td>

                  <td>
                    <span
                      className={`activity-action-badge ${getActionClass(
                        log.action
                      )}`}
                    >
                      {getActionLabel(
                        log.action
                      )}
                    </span>
                  </td>

                  <td>
                    <div className="activity-description">
                      {log.description || '-'}
                    </div>
                  </td>
                  <td>
                    <button
                        className="detail-button"
                        onClick={() => setSelectedLog(log)}
                    >
                        ดูรายละเอียด
                    </button>
                    </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>
        )}

        {selectedLog && (
            <div
                className="modal-overlay"
                onClick={() => setSelectedLog(null)}
            >
                <div
                className="delete-modal activity-detail-modal"
                style={{ maxWidth: '760px' }}
                onClick={(e) => e.stopPropagation()}
                >
                <h3>
                    {getActionLabel(selectedLog.action)}
                </h3>

                <p>
                    {selectedLog.description || '-'}
                </p>

                <div className="activity-change-list">

                    {getChangedFields(selectedLog).length === 0 ? (
                        <div className="activity-no-change">
                        ไม่มีข้อมูลการเปลี่ยนแปลง
                        </div>
                    ) : (
                        getChangedFields(selectedLog).map((item) => (
                        <div
                            className="activity-change-row"
                            key={item.key}
                        >
                            <div className="activity-change-label">
                            {item.label}
                            </div>

                            <div className="activity-change-values">

                            <div className="activity-old-value">
                                <span>ก่อน</span>
                                <strong>
                                {item.oldValue}
                                </strong>
                            </div>

                            <div className="activity-change-arrow">
                                →
                            </div>

                            <div className="activity-new-value">
                                <span>หลัง</span>
                                <strong>
                                {item.newValue}
                                </strong>
                            </div>

                            </div>
                        </div>
                        ))
                    )}

                    </div>

                <div className="delete-modal-actions">
                    <button
                    className="cancel-modal-button"
                    onClick={() => setSelectedLog(null)}
                    >
                    ปิด
                    </button>
                </div>
                </div>
            </div>
            )}

    </div>
  )
}

export default ActivityLog