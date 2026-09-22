import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

function VehicleList({ onViewDetails }) {
  const [vehicles, setVehicles] = useState([])
  const [watchLevels, setWatchLevels] = useState([])
  const [agencies, setAgencies] = useState([])

  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const [imageUrls, setImageUrls] = useState({})
  const [currentPage, setCurrentPage] = useState(1)
  const [hoverPreview, setHoverPreview] = useState(null)

  const signedUrlCacheRef = useRef(new Map())

  const ITEMS_PER_PAGE = 10
  const SIGNED_URL_TTL = 3600

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

  const showHoverPreview = (e, vehicle) => {
    const url = imageUrls[vehicle.id]

    if (!url) return

    const rect =
      e.currentTarget.getBoundingClientRect()

    const previewWidth = 360
    const previewHeight = 270
    const gap = 14

    let left = rect.right + gap
    let top = rect.top

    // ถ้าด้านขวาไม่พอ ให้เด้งไปด้านซ้าย
    if (
      left + previewWidth >
      window.innerWidth - 12
    ) {
      left =
        rect.left -
        previewWidth -
        gap
    }

    // ป้องกันภาพเลยขอบล่าง
    if (
      top + previewHeight >
      window.innerHeight - 12
    ) {
      top =
        window.innerHeight -
        previewHeight -
        12
    }

    if (top < 12) {
      top = 12
    }

    setHoverPreview({
      url,
      alt: formatPlate(vehicle),
      left,
      top,
    })
  }

  const prepareFirstPageImages = async (vehicleRows) => {
    const firstPageVehicles = vehicleRows
      .filter((vehicle) => {
        return (
          !statusFilter ||
          vehicle.case_status === statusFilter
        )
      })
      .slice(0, ITEMS_PER_PAGE)

    const vehiclesWithImages =
      firstPageVehicles
        .map((vehicle) => ({
          ...vehicle,
          preview_path:
            vehicle.thumbnail_path ||
            vehicle.image_path,
        }))
        .filter(
          (vehicle) => vehicle.preview_path
        )

    if (vehiclesWithImages.length === 0) {
      return
    }

    const paths = vehiclesWithImages.map(
      (vehicle) => vehicle.preview_path
    )

    const { data, error } =
      await supabase.storage
        .from('vehicle-images')
        .createSignedUrls(
          paths,
          SIGNED_URL_TTL
        )

    if (error) {
      console.error(
        'First page image error:',
        error
      )

      return
    }

    const expiresAt =
      Date.now() +
      SIGNED_URL_TTL * 1000

    const firstPageUrls = {}

    const preloadPromises =
      vehiclesWithImages.map(
        (vehicle, index) => {
          const signedUrl =
            data?.[index]?.signedUrl

          if (!signedUrl) {
            return Promise.resolve()
          }

          firstPageUrls[vehicle.id] =
            signedUrl

          signedUrlCacheRef.current.set(
            vehicle.preview_path,
            {
              url: signedUrl,
              expiresAt,
            }
          )

          return new Promise((resolve) => {
            const img = new Image()

            img.fetchPriority = 'high'
            img.decoding = 'async'

            img.onload = resolve
            img.onerror = resolve

            img.src = signedUrl
          })
        }
      )

    // รอให้ browser ได้ Thumbnail หน้าแรกจริง ๆ
    await Promise.all(preloadPromises)

    setImageUrls((prev) => ({
      ...prev,
      ...firstPageUrls,
    }))
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

    const vehicleRows =
      vehicleResult.data || []

    await prepareFirstPageImages(
      vehicleRows
    )

    setVehicles(vehicleRows)

    setWatchLevels(
      watchResult.data || []
    )

    setAgencies(
      agencyResult.data || []
    )

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

  const totalPages = Math.max(
    1,
    Math.ceil(filteredVehicles.length / ITEMS_PER_PAGE)
  )

  const paginatedVehicles = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE

    return filteredVehicles.slice(
      startIndex,
      startIndex + ITEMS_PER_PAGE
    )
  }, [filteredVehicles, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, watchFilter, statusFilter])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const preloadImage = (url) => {
    if (!url) return

    const img = new Image()

    img.decoding = 'async'
    img.fetchPriority = 'low'
    img.src = url
  }

  const prefetchVehicleImages = async (vehiclesToPrefetch) => {
    if (!vehiclesToPrefetch.length) return

    const now = Date.now()

    const urlsToPreload = []
    const vehiclesToSign = []

    vehiclesToPrefetch.forEach((vehicle) => {
      const imagePath =
        vehicle.thumbnail_path || vehicle.image_path

      if (!imagePath) return

      const cached =
        signedUrlCacheRef.current.get(imagePath)

      if (
        cached &&
        cached.expiresAt > now + 5 * 60 * 1000
      ) {
        urlsToPreload.push(cached.url)
      } else {
        vehiclesToSign.push({
          ...vehicle,
          preview_path: imagePath,
        })
      }
    })

    // รูปที่มี Signed URL อยู่แล้ว
    // ให้ browser preload ไฟล์จริงไว้เลย
    urlsToPreload.forEach(preloadImage)

    if (vehiclesToSign.length === 0) {
      return
    }

    const paths = vehiclesToSign.map(
      (vehicle) => vehicle.preview_path
    )

    const { data, error } = await supabase.storage
      .from('vehicle-images')
      .createSignedUrls(paths, SIGNED_URL_TTL)

    if (error) {
      console.error(
        'Prefetch signed URL error:',
        error
      )
      return
    }

    const expiresAt =
      Date.now() + SIGNED_URL_TTL * 1000

    vehiclesToSign.forEach((vehicle, index) => {
      const result = data?.[index]

      if (!result?.signedUrl) return

      signedUrlCacheRef.current.set(
        vehicle.preview_path,
        {
          url: result.signedUrl,
          expiresAt,
        }
      )

      // สำคัญ:
      // ดาวน์โหลด Thumbnail เข้ browser cache ล่วงหน้า
      preloadImage(result.signedUrl)
    })
  }

  useEffect(() => {
    let cancelled = false
    let prefetchTimer = null

    const scheduleNextPagePrefetch = () => {
      const nextPageStart =
        currentPage * ITEMS_PER_PAGE

      const nextPageVehicles =
        filteredVehicles.slice(
          nextPageStart,
          nextPageStart + ITEMS_PER_PAGE
        )

      if (nextPageVehicles.length === 0) {
        return
      }

      // รอหน้า current โหลดก่อนนิดเดียว
      // แล้วแอบโหลดหน้าถัดไปทันที
      prefetchTimer = window.setTimeout(() => {
        if (!cancelled) {
          prefetchVehicleImages(
            nextPageVehicles
          )
        }
      }, 150)
    }

    const loadImages = async () => {
      const now = Date.now()

      const cachedUrls = {}
      const vehiclesToSign = []

      paginatedVehicles.forEach((vehicle) => {
        const imagePath =
          vehicle.thumbnail_path ||
          vehicle.image_path

        if (!imagePath) {
          cachedUrls[vehicle.id] = ''
          return
        }

        const cached =
          signedUrlCacheRef.current.get(
            imagePath
          )

        if (
          cached &&
          cached.expiresAt >
            now + 5 * 60 * 1000
        ) {
          cachedUrls[vehicle.id] =
            cached.url
        } else {
          vehiclesToSign.push({
            ...vehicle,
            preview_path: imagePath,
          })
        }
      })

      // รูปที่มี cache ให้แสดงทันที
      if (
        !cancelled &&
        Object.keys(cachedUrls).length > 0
      ) {
        setImageUrls((prev) => ({
          ...prev,
          ...cachedUrls,
        }))
      }

      // ถ้าหน้าปัจจุบันมี cache ครบแล้ว
      // ก็เริ่ม prefetch หน้าถัดไปเลย
      if (vehiclesToSign.length === 0) {
        scheduleNextPagePrefetch()
        return
      }

      const paths = vehiclesToSign.map(
        (vehicle) => vehicle.preview_path
      )

      const { data, error } =
        await supabase.storage
          .from('vehicle-images')
          .createSignedUrls(
            paths,
            SIGNED_URL_TTL
          )

      if (error) {
        console.error(
          'Batch image load error:',
          error
        )
        return
      }

      if (cancelled) return

      const newUrls = {}

      const expiresAt =
        Date.now() +
        SIGNED_URL_TTL * 1000

      vehiclesToSign.forEach(
        (vehicle, index) => {
          const result = data?.[index]

          if (result?.signedUrl) {
            newUrls[vehicle.id] =
              result.signedUrl

            signedUrlCacheRef.current.set(
              vehicle.preview_path,
              {
                url: result.signedUrl,
                expiresAt,
              }
            )
          } else {
            newUrls[vehicle.id] = ''

            console.error(
              'Signed URL failed:',
              vehicle.preview_path,
              result?.error
            )
          }
        }
      )

      setImageUrls((prev) => ({
        ...prev,
        ...newUrls,
      }))

      // สำคัญ:
      // หลังหน้า current ได้ URL ครบ
      // ให้โหลดหน้าถัดไปทันที
      scheduleNextPagePrefetch()
    }

    loadImages()

    return () => {
      cancelled = true

      if (prefetchTimer) {
        clearTimeout(prefetchTimer)
      }
    }
  }, [
    paginatedVehicles,
    currentPage,
    filteredVehicles,
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
                  <th>ภาพ</th>
                  <th>ทะเบียน</th>
                  <th>ข้อมูลรถ</th>
                  <th>ระดับเฝ้าระวัง</th>
                  <th>หน่วยงาน</th>
                  <th>สถานะ</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>

                {paginatedVehicles.map((vehicle) => {
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
                        <div
                          className="vehicle-thumb-button"
                          onMouseEnter={(e) =>
                            showHoverPreview(e, vehicle)
                          }
                          onMouseLeave={() =>
                            setHoverPreview(null)
                          }
                        >
                          {imageUrls[vehicle.id] ? (
                            <img
                              className="vehicle-thumbnail"
                              src={imageUrls[vehicle.id]}
                              alt={formatPlate(vehicle)}
                              loading="eager"
                              decoding="async"
                              fetchPriority="high"
                            />
                          ) : (
                            <div className="vehicle-thumbnail-empty">
                              🚗
                            </div>
                          )}
                        </div>
                      </td>

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

            {paginatedVehicles.map((vehicle) => {
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

                  <button
                    className="mobile-vehicle-image"
                    onClick={() =>
                      onViewDetails(vehicle.id)
                    }
                  >
                    {imageUrls[vehicle.id] ? (
                      <img
                        src={imageUrls[vehicle.id]}
                        alt={formatPlate(vehicle)}
                        loading="eager"
                        decoding="async"
                        fetchPriority="high"
                      />
                    ) : (
                      <div className="mobile-vehicle-image-empty">
                        <span>🚗</span>
                        <small>ไม่มีรูปภาพ</small>
                      </div>
                    )}
                  </button>

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

          <div className="vehicle-pagination">

            <div className="pagination-info">
              แสดง{' '}
              {filteredVehicles.length === 0
                ? 0
                : (currentPage - 1) * ITEMS_PER_PAGE + 1}
              {' - '}
              {Math.min(
                currentPage * ITEMS_PER_PAGE,
                filteredVehicles.length
              )}
              {' จาก '}
              {filteredVehicles.length}
              {' รายการ'}
            </div>

            <div className="pagination-controls">

              <button
                disabled={currentPage === 1}
                onClick={() =>
                  setCurrentPage((page) =>
                    Math.max(page - 1, 1)
                  )
                }
              >
                ← ก่อนหน้า
              </button>

              <span>
                หน้า {currentPage} / {totalPages}
              </span>

              <button
                disabled={currentPage === totalPages}
                onClick={() =>
                  setCurrentPage((page) =>
                    Math.min(page + 1, totalPages)
                  )
                }
              >
                ถัดไป →
              </button>

            </div>

          </div>

        </>
      )}

       {hoverPreview && (
        <div
          className="vehicle-hover-preview"
          style={{
            left: hoverPreview.left,
            top: hoverPreview.top,
          }}
        >
          <img
            src={hoverPreview.url}
            alt={hoverPreview.alt}
          />
        </div>
      )}

    </div>
  )
}

export default VehicleList