import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

function VehicleList({ onViewDetails }) {
  const [vehicles, setVehicles] = useState([])
  const [watchLevels, setWatchLevels] = useState([])
  const [agencies, setAgencies] = useState([])

  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const [search, setSearch] = useState('')
  const [watchFilter, setWatchFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')

  const getWatchLevelClass = (watchLevel) => {
    switch (watchLevel) {
        case 'รถเป้าหมาย':
        return 'badge-watch-target'
        case 'รถเฝ้าระวัง-ตรวจสอบ':
        return 'badge-watch-watch'
        case 'รถเฝ้าติดตาม':
        return 'badge-watch-track'
        case 'รถ VIP':
        return 'badge-watch-vip'
        case 'รถทดสอบ':
        return 'badge-watch-test'
        default:
        return 'badge-default'
    }
    }

    const getCaseStatusClass = (status) => {
    switch (status) {
        case 'ปิดคดี':
        return 'badge-status-closed'
        case 'ยังไม่ปิดคดี':
        return 'badge-status-active'
        default:
        return 'badge-default'
    }
    }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setErrorMessage('')

    const [
      vehicleResult,
      watchResult,
      agencyResult,
    ] = await Promise.all([
      supabase
        .from('vehicles')
        .select('*')
        .order('created_at', { ascending: false }),

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
    ])

    if (vehicleResult.error) {
      console.error(vehicleResult.error)
      setErrorMessage(vehicleResult.error.message)
    }

    if (watchResult.error) {
      console.error(watchResult.error)
    }

    if (agencyResult.error) {
      console.error(agencyResult.error)
    }

    setVehicles(vehicleResult.data || [])
    setWatchLevels(watchResult.data || [])
    setAgencies(agencyResult.data || [])

    setLoading(false)
  }

  const getWatchLevel = (id) => {
    return watchLevels.find(
      (item) => String(item.id) === String(id)
    )
  }

  const getAgency = (id) => {
    return agencies.find(
      (item) => String(item.id) === String(id)
    )
  }

  const filteredVehicles = useMemo(() => {
    const keyword = search.trim().toLowerCase()

    return vehicles.filter((vehicle) => {
      const searchText = [
        vehicle.plate_letters,
        vehicle.plate_number,
        vehicle.province,
        vehicle.vehicle_type,
        vehicle.brand,
        vehicle.model,
        vehicle.color,
        vehicle.engine_number,
        vehicle.chassis_number,
        vehicle.police_station,
        vehicle.case_province,
        vehicle.requested_by,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const matchesSearch =
        !keyword || searchText.includes(keyword)

      const matchesWatch =
        !watchFilter ||
        String(vehicle.watch_level_id) ===
          String(watchFilter)

      const matchesStatus =
        !statusFilter ||
        vehicle.case_status === statusFilter

      return (
        matchesSearch &&
        matchesWatch &&
        matchesStatus
      )
    })
  }, [
    vehicles,
    search,
    watchFilter,
    statusFilter,
  ])

  const openCount = vehicles.filter(
    (vehicle) => vehicle.case_status === 'open'
  ).length

  const closedCount = vehicles.filter(
    (vehicle) => vehicle.case_status === 'closed'
  ).length

  const formatPlate = (vehicle) => {
    return [
      vehicle.plate_letters,
      vehicle.plate_number,
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลดข้อมูลรถ...</p>
      </div>
    )
  }

  return (
    <div className="vehicle-list-page">

      <div className="list-header">
        <div>
          <div className="hero-badge">
            BLACKLIST DATABASE
          </div>

          <h2>รถ Blacklist</h2>

          <p>
            ค้นหา ตรวจสอบ และดูรายการรถทั้งหมดในระบบ
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadData}
        >
          รีเฟรชข้อมูล
        </button>
      </div>

      <div className="list-stat-grid">

        <div className="list-stat-card">
          <span>รถทั้งหมด</span>
          <strong>{vehicles.length}</strong>
          <small>รายการ</small>
        </div>

        <div className="list-stat-card active-stat">
          <span>ยังไม่ปิดคดี</span>
          <strong>{openCount}</strong>
          <small>รายการ</small>
        </div>

        <div className="list-stat-card closed-stat">
          <span>ปิดคดีแล้ว</span>
          <strong>{closedCount}</strong>
          <small>รายการ</small>
        </div>

        <div className="list-stat-card">
          <span>ผลการค้นหา</span>
          <strong>{filteredVehicles.length}</strong>
          <small>รายการ</small>
        </div>

      </div>

      <div className="filter-card">

        <div className="search-box">
          <label>ค้นหารถ</label>

          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="ทะเบียน / จังหวัด / ยี่ห้อ / รุ่น / เลขตัวถัง..."
          />
        </div>

        <div className="filter-item">
          <label>ระดับเฝ้าระวัง</label>

          <select
            value={watchFilter}
            onChange={(e) =>
              setWatchFilter(e.target.value)
            }
          >
            <option value="">
              ทุกระดับ
            </option>

            {watchLevels.map((level) => (
              <option
                key={level.id}
                value={level.id}
              >
                {level.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-item">
          <label>สถานะคดี</label>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value)
            }
          >
            <option value="">
              ทั้งหมด
            </option>

            <option value="open">
              ยังไม่ปิดคดี
            </option>

            <option value="closed">
              ปิดคดีแล้ว
            </option>
          </select>
        </div>

        <button
          className="clear-filter-button"
          onClick={() => {
            setSearch('')
            setWatchFilter('')
            setStatusFilter('')
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

      {filteredVehicles.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🚗</div>

          <h3>ไม่พบข้อมูลรถ</h3>

          <p>
            ลองเปลี่ยนคำค้นหาหรือตัวกรอง
          </p>
        </div>
      ) : (
        <>
          <div className="vehicle-table-wrap">

            <table className="vehicle-table">

              <thead>
                <tr>
                  <th>ทะเบียน</th>
                  <th>ข้อมูลรถ</th>
                  <th>ระดับเฝ้าระวัง</th>
                  <th>หน่วยงาน</th>
                  <th>สถานะ</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>

                {filteredVehicles.map((vehicle) => {
                  const watch =
                    getWatchLevel(
                      vehicle.watch_level_id
                    )

                  const agency =
                    getAgency(
                      vehicle.agency_id
                    )

                  return (
                    <tr key={vehicle.id}>

                      <td>
                        <div className="plate-cell">
                          <strong>
                            {formatPlate(vehicle) || '-'}
                          </strong>

                          <span>
                            {vehicle.province || '-'}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className="vehicle-name-cell">
                          <strong>
                            {[vehicle.brand, vehicle.model]
                              .filter(Boolean)
                              .join(' ') || '-'}
                          </strong>

                          <span>
                            {[
                              vehicle.vehicle_type,
                              vehicle.color,
                            ]
                              .filter(Boolean)
                              .join(' • ') || '-'}
                          </span>
                        </div>
                      </td>

                      <td className="badge-table-cell">
                        <span
                            className={`watch-badge ${getWatchLevelClass(
                            watch?.name
                            )}`}
                        >
                            {watch?.name || '-'}
                        </span>
                        </td>

                      <td>
                        {agency?.name || '-'}
                      </td>

                      <td className="badge-table-cell">
                            {vehicle.case_status === 'closed' ? (
                                <span className="status-badge closed">
                                ปิดคดี
                                </span>
                            ) : (
                                <span className="status-badge open">
                                ยังไม่ปิดคดี
                                </span>
                            )}
                        </td>

                      <td>
                        <button
                          className="detail-button"
                          onClick={() =>
                                onViewDetails(vehicle.id)
                            }
                        >
                          ดูรายละเอียด
                        </button>
                      </td>

                    </tr>
                  )
                })}

              </tbody>

            </table>

          </div>

          <div className="vehicle-mobile-list">

            {filteredVehicles.map((vehicle) => {
              const watch =
                getWatchLevel(
                  vehicle.watch_level_id
                )

              const agency =
                getAgency(
                  vehicle.agency_id
                )

              return (
                <div
                  className="vehicle-mobile-card"
                  key={vehicle.id}
                >

                  <div className="mobile-card-top">

                    <div>
                      <strong className="mobile-plate">
                        {formatPlate(vehicle)}
                      </strong>

                      <span className="mobile-province">
                        {vehicle.province}
                      </span>
                    </div>

                    {vehicle.case_status ===
                    'closed' ? (
                      <span className="status-badge closed">
                        ปิดคดี
                      </span>
                    ) : (
                      <span className="status-badge open">
                        ยังไม่ปิดคดี
                      </span>
                    )}

                  </div>

                  <div className="mobile-car-name">
                    {[vehicle.brand, vehicle.model]
                      .filter(Boolean)
                      .join(' ') || '-'}
                  </div>

                  <div className="mobile-details">

                    <div>
                      <span>ระดับเฝ้าระวัง</span>
                      <strong>
                        {watch?.name || '-'}
                      </strong>
                    </div>

                    <div>
                      <span>หน่วยงาน</span>
                      <strong>
                        {agency?.name || '-'}
                      </strong>
                    </div>

                    <div>
                      <span>สี</span>
                      <strong>
                        {vehicle.color || '-'}
                      </strong>
                    </div>

                  </div>

                  <button
                    className="mobile-detail-button"
                    onClick={() =>
                        onViewDetails(vehicle.id)
                    }
                  >
                    ดูรายละเอียด
                  </button>

                </div>
              )
            })}

          </div>
        </>
      )}

    </div>
  )
}

export default VehicleList