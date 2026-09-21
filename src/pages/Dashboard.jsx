import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function Dashboard({
  profile,
  onViewDetails,
}) {
  const [vehicles, setVehicles] = useState([])
  const [watchLevels, setWatchLevels] = useState([])
  const [centers, setCenters] = useState([])

  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (profile?.id) {
      loadDashboard()
    }
  }, [
    profile?.id,
    profile?.role,
    profile?.center_id,
  ])

  const loadDashboard = async () => {
    setLoading(true)
    setErrorMessage('')

    try {
      // =========================
      // VEHICLES
      // =========================

      let vehicleQuery = supabase
        .from('vehicles')
        .select(`
          id,
          case_status,
          watch_level_id,
          created_center_id,
          created_at
        `)
        .order('created_at', {
          ascending: false,
        })

      // User ศูนย์ เห็นเฉพาะรถของศูนย์ตัวเอง
      if (profile?.role === 'center') {
        if (!profile?.center_id) {
          setVehicles([])
          setWatchLevels([])
          setCenters([])

          setErrorMessage(
            'User ศูนย์นี้ยังไม่ได้ผูกกับศูนย์'
          )

          setLoading(false)
          return
        }

        vehicleQuery = vehicleQuery.eq(
          'created_center_id',
          profile.center_id
        )
      }

      const promises = [
        vehicleQuery,

        supabase
          .from('watch_levels')
          .select('id, name')
          .order('sort_order'),
      ]

      // Admin เท่านั้นที่ต้องโหลดรายชื่อศูนย์
      if (profile?.role === 'admin') {
        promises.push(
          supabase
            .from('centers')
            .select('id, name')
            .order('name')
        )
      }

      const results =
        await Promise.all(promises)

      const vehicleResult = results[0]
      const watchResult = results[1]
      const centerResult = results[2]

      if (vehicleResult.error) {
        throw vehicleResult.error
      }

      if (watchResult.error) {
        throw watchResult.error
      }

      if (centerResult?.error) {
        throw centerResult.error
      }

      setVehicles(
        vehicleResult.data || []
      )

      setWatchLevels(
        watchResult.data || []
      )

      setCenters(
        centerResult?.data || []
      )
    } catch (error) {
      console.error(
        'Dashboard error:',
        error
      )

      setErrorMessage(
        error?.message ||
        'ไม่สามารถโหลดข้อมูล Dashboard ได้'
      )
    }

    setLoading(false)
  }

  const getWatchName = (watchLevelId) => {
    return (
      watchLevels.find(
        (item) =>
          String(item.id) ===
          String(watchLevelId)
      )?.name || ''
    )
  }

  // =========================
  // COUNTS
  // =========================

  const totalCount = vehicles.length

  const openCount = vehicles.filter(
    (vehicle) =>
      vehicle.case_status === 'open'
  ).length

  const closedCount = vehicles.filter(
    (vehicle) =>
      vehicle.case_status === 'closed'
  ).length

  const targetCount = vehicles.filter(
    (vehicle) =>
      getWatchName(
        vehicle.watch_level_id
      ) === 'รถเป้าหมาย'
  ).length

  const watchCount = vehicles.filter(
    (vehicle) =>
      getWatchName(
        vehicle.watch_level_id
      ) === 'รถเฝ้าระวัง-ตรวจสอบ'
  ).length

  const trackCount = vehicles.filter(
    (vehicle) =>
      getWatchName(
        vehicle.watch_level_id
      ) === 'รถเฝ้าติดตาม'
  ).length


  // =========================
  // GROUP CHART
  // =========================

  const groupChartData = [
    {
      name: 'รถเป้าหมาย',
      count: targetCount,
      className: 'target',
    },
    {
      name: 'รถเฝ้าระวัง-ตรวจสอบ',
      count: watchCount,
      className: 'watch',
    },
    {
      name: 'รถเฝ้าติดตาม',
      count: trackCount,
      className: 'track',
    },
  ]

  const maxGroupCount = Math.max(
    1,
    ...groupChartData.map(
      (item) => item.count
    )
  )


  // =========================
  // CENTER CHART - ADMIN
  // =========================

  const centerChartData = centers
    .map((center) => {
      const count = vehicles.filter(
        (vehicle) =>
          String(
            vehicle.created_center_id
          ) === String(center.id)
      ).length

      return {
        id: center.id,
        name: center.name,
        count,
      }
    })
    .sort(
      (a, b) =>
        b.count - a.count
    )

  const maxCenterCount = Math.max(
    1,
    ...centerChartData.map(
      (item) => item.count
    )
  )


  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลด Dashboard...</p>
      </div>
    )
  }

  return (
    <div className="dashboard-page">

      <div className="dashboard-welcome">

        <div>
          <div className="hero-badge">
            BLACKLIST OVERVIEW
          </div>

          <h2>
            ภาพรวมระบบรถ Blacklist
          </h2>

          <p>
            {profile?.role === 'admin'
              ? 'ข้อมูลภาพรวมจากทุกศูนย์'
              : `ข้อมูลเฉพาะ ${
                  profile?.agency ||
                  'ศูนย์ของคุณ'
                }`}
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadDashboard}
        >
          รีเฟรชข้อมูล
        </button>

      </div>

      {errorMessage && (
        <div className="modern-alert error">
          {errorMessage}
        </div>
      )}


      {/* =========================
          STAT CARDS
      ========================= */}

      <div className="dashboard-stats-grid">

        <DashboardCard
          title="รถ Blacklist ทั้งหมด"
          value={totalCount}
          className="total"
        />

        <DashboardCard
          title="ยังไม่ปิดคดี"
          value={openCount}
          className="open"
        />

        <DashboardCard
          title="ปิดคดีแล้ว"
          value={closedCount}
          className="closed"
        />

        <DashboardCard
          title="รถเป้าหมาย"
          value={targetCount}
          className="target"
        />

        <DashboardCard
          title="รถเฝ้าระวัง-ตรวจสอบ"
          value={watchCount}
          className="watch"
        />

        <DashboardCard
          title="รถเฝ้าติดตาม"
          value={trackCount}
          className="track"
        />

      </div>


      {/* =========================
          CHARTS
      ========================= */}

      <div
        className={`dashboard-chart-grid ${
          profile?.role !== 'admin'
            ? 'single'
            : ''
        }`}
      >

        {/* รถตามกลุ่ม */}

        <div className="dashboard-chart-card">

          <div className="dashboard-chart-header">
            <div>
              <h3>
                รถ Blacklist ตามกลุ่ม
              </h3>

              <p>
                เปรียบเทียบจำนวนรถ 3 กลุ่มหลัก
              </p>
            </div>
          </div>

          <div className="dashboard-bars">

            {groupChartData.map(
              (item) => (

                <div
                  className="dashboard-bar-row"
                  key={item.name}
                >

                  <div className="dashboard-bar-label">

                    <span>
                      {item.name}
                    </span>

                    <strong
                      className={
                        item.className
                      }
                    >
                      {item.count} คัน
                    </strong>

                  </div>

                  <div className="dashboard-bar-track">

                    <div
                      className={`dashboard-bar-fill ${item.className}`}
                      style={{
                        width:
                          item.count === 0
                            ? '0%'
                            : `${
                                Math.max(
                                  6,
                                  (
                                    item.count /
                                    maxGroupCount
                                  ) * 100
                                )
                              }%`,
                      }}
                    />

                  </div>

                </div>

              )
            )}

          </div>

        </div>


        {/* รถตามศูนย์ - Admin เท่านั้น */}

        {profile?.role === 'admin' && (

          <div className="dashboard-chart-card">

            <div className="dashboard-chart-header">

              <div>
                <h3>
                  รถ Blacklist ตามศูนย์
                </h3>

                <p>
                  จำนวนรถที่บันทึกโดยแต่ละศูนย์
                </p>
              </div>

            </div>

            <div className="dashboard-bars center-bars">

              {centerChartData.length > 0 ? (

                centerChartData.map(
                  (center) => (

                    <div
                      className="dashboard-bar-row"
                      key={center.id}
                    >

                      <div className="dashboard-bar-label">

                        <span>
                          {center.name}
                        </span>

                        <strong>
                          {center.count} คัน
                        </strong>

                      </div>

                      <div className="dashboard-bar-track">

                        <div
                          className="dashboard-bar-fill center"
                          style={{
                            width:
                              center.count === 0
                                ? '0%'
                                : `${
                                    Math.max(
                                      6,
                                      (
                                        center.count /
                                        maxCenterCount
                                      ) * 100
                                    )
                                  }%`,
                          }}
                        />

                      </div>

                    </div>

                  )
                )

              ) : (

                <div className="dashboard-chart-empty">
                  ยังไม่มีข้อมูลศูนย์
                </div>

              )}

            </div>

          </div>

        )}

      </div>

    </div>
  )
}


function DashboardCard({
  title,
  value,
  className = '',
}) {
  return (
    <div
      className={`dashboard-stat-card ${className}`}
    >
      <span>{title}</span>

      <div>
        <strong>{value}</strong>
        <small>คัน</small>
      </div>
    </div>
  )
}

export default Dashboard