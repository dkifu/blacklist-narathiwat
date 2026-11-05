import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import './TccDashboardFrame.css'

const localDate = () => {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const validDate = value => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) return false

  const d = new Date(value + 'T12:00:00')

  if (Number.isNaN(d.getTime())) return false

  const pad = n => String(n).padStart(2, '0')

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === value
  )
}

export default function TccDashboardFrame({ profile }) {
  const role = profile?.role
  const ownCenter = Number(profile?.center_id)

  const manager =
    role === 'admin' ||
    role === 'supervisor'

  const central =
    role === 'center' &&
    ownCenter === 10

  const allowed =
    manager ||
    (role === 'center' && ownCenter > 0)

  const [date, setDate] = useState(localDate)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState('daily')

  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const [centerId, setCenterId] = useState(
    manager ? '' : String(ownCenter)
  )

  const centralView =
    central || (role === 'admin' && centerId === 'central')

  const frameRef = useRef(null)
  const inFlight = useRef(false)

  // ========================================
  // โหลดสถานะการบันทึก
  // ========================================

  useEffect(() => {
    if (!allowed || !validDate(date)) return

    let active = true

    setLoading(true)
    setError('')

    supabase.rpc('tcc_report_status', {
      p_report_date: date
    })
      .then(({ data, error: rpcError }) => {
        if (!active) return
        if (rpcError) throw rpcError

        setStatus(data)
      })
      .catch(err => {
        if (!active) return

        setStatus(null)
        setError(
          err?.message || 'ไม่สามารถอ่านสถานะรายงานได้'
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [allowed, date, refreshKey])

  // ========================================
  // รับข้อความจาก TCC HTML
  // ========================================

  useEffect(() => {
    const handleMessage = async event => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow
      ) return

      const msg = event.data

      if (
        !msg ||
        msg.source !== 'tcc-dashboard'
      ) return

      // ซิงก์วันที่รายงาน
      if (msg.kind === 'report-date') {
        if (validDate(msg.value)) {
          setDate(msg.value)
        }
        return
      }

      // TCC_CENTRAL_DAILY_PATCH_20261105
      // ศชต. ใช้ข้อมูลรวมที่ RPC อนุญาตเท่านั้น ไม่เปิดช่องบันทึก/แก้ตัวเลข
      if (msg.kind === 'central-daily-request') {
        if (!centralView || viewMode !== 'daily') return
        if (!validDate(msg.reportDate) || !validDate(msg.dataDate)) return
        if (msg.reportDate !== date) return

        const dataDay = new Date(`${msg.reportDate}T12:00:00`)
        dataDay.setDate(dataDay.getDate() - 1)
        const pad = n => String(n).padStart(2, '0')
        const expectedDataDate =
          `${dataDay.getFullYear()}-${pad(dataDay.getMonth() + 1)}-${pad(dataDay.getDate())}`
        if (msg.dataDate !== expectedDataDate) return

        try {
          // ต้องขอครอบคลุมทั้งวันสถิติและวันรายงานเพื่ออ่านสถานะกล้อง
          const { data: history, error: historyError } =
            await supabase.rpc('tcc_history_range', {
              p_from_date: msg.dataDate,
              p_to_date: msg.reportDate,
              p_center_id: null
            })
          if (historyError) throw historyError

          const dayRow = (Array.isArray(history?.data_by_date)
            ? history.data_by_date : []).find(
              row => row.data_date === msg.dataDate
            )
          // TCC_PING_CAMERA_V8_REACT_20261105
          // Secure aggregate: central receives totals only, never other centers' details.
          const { data: pingCamera, error: pingError } = await supabase.rpc(
            'tcc_checkpoint_camera_daily', {
              p_report_date: msg.reportDate,
              p_center_id: null
            }
          )
          if (pingError) throw pingError
          // TCC_VSS05_ALERT_V11_REACT_20261106: VSS05 summary uses report_date,
          // identical to the TCC report date (statistics refer to the prior day).
          const { data: vssAlerts, error: vssError } = await supabase.rpc(
            'tcc_vss05_alert_authoritative', {
              p_report_date: msg.reportDate,
              p_center_id: null
            }
          )
          if (vssError) throw vssError
          const fields = {
            cam: ['ok', 'bad', 'unknown'], alert: ['face', 'veh'],
            face: ['in', 'out'],
            vin: ['car', 'pick', 'moto', 'truck', 'van', 'other'],
            vout: ['car', 'pick', 'moto', 'truck', 'van', 'other'],
            pin: ['pt', 'yl', 'nr'], pout: ['pt', 'yl', 'nr']
          }
          const payload = {}
          for (const [group, keys] of Object.entries(fields)) {
            const source = group === 'cam'
              ? {
                  ok: pingCamera?.has_data ? pingCamera.online : 0,
                  bad: pingCamera?.has_data ? pingCamera.offline : 0,
                  unknown: pingCamera?.has_data ? pingCamera.unknown : 0
                }
              : group === 'alert'
                ? { face: vssAlerts?.face || 0, veh: vssAlerts?.veh || 0 }
                : dayRow?.totals?.[group]
            payload[group] = Object.fromEntries(keys.map(key => {
              const n = Number(source?.[key])
              return [key, Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0]
            }))
          }

          // ตรวจว่า iframe ที่ขอข้อมูลยังเป็นหน้าปัจจุบัน
          if (event.source !== frameRef.current?.contentWindow) return
          event.source.postMessage({
            source: 'tcc-host',
            kind: 'central-daily-result',
            reportDate: msg.reportDate,
            dataDate: msg.dataDate,
            found: Boolean(dayRow),
            hasAlerts: Boolean(vssAlerts?.has_data),
            alertSavedCount: Number(vssAlerts?.saved_count || 0),
            alertExpectedCount: Number(vssAlerts?.expected_count || 6),
            hasCamera: Boolean(pingCamera?.has_data),
            cameraSavedCount: Number(pingCamera?.saved_count || 0),
            cameraExpectedCount: Number(pingCamera?.expected_count || 6),
            savedCount: Number(dayRow?.saved_count || 0),
            expectedCount: Number(dayRow?.expected_count || 6),
            payload
          }, event.origin)
        } catch (err) {
          if (event.source !== frameRef.current?.contentWindow) return
          event.source.postMessage({
            source: 'tcc-host',
            kind: 'central-daily-result',
            reportDate: msg.reportDate,
            dataDate: msg.dataDate,
            error: err?.message || 'โหลดข้อมูลรวมไม่สำเร็จ'
          }, event.origin)
        }
        return
      }

      if (
        centralView ||
        !centerId ||
        !['save-report', 'load-report'].includes(msg.kind)
      ) return

      const respond = (ok, record = null, message = '', camera = null, alerts = null) => {
        event.source.postMessage({
          source: 'tcc-host',
          kind: 'rpc-result',
          requestId: msg.requestId,
          ok,
          record,
          error: message,
          camera,
          alerts
        }, event.origin)
      }

      if (inFlight.current) {
        respond(false, null, 'มีคำขอที่กำลังดำเนินการอยู่')
        return
      }

      if (
        !validDate(msg.reportDate) ||
        !validDate(msg.dataDate)
      ) {
        respond(false, null, 'วันที่รายงานไม่ถูกต้อง')
        return
      }

      inFlight.current = true
      setBusy(true)

      try {
        let result
        let cameraSnapshot = null
        let vssSnapshot = null

        if (msg.kind === 'load-report') {
          const [savedReport, pingResult, vssResult] = await Promise.all([
            supabase.rpc('tcc_daily_get', {
              p_center_id: Number(centerId),
              p_data_date: msg.dataDate
            }),
            supabase.rpc('tcc_checkpoint_camera_daily', {
              p_report_date: msg.reportDate,
              p_center_id: Number(centerId)
            }),
            supabase.rpc('tcc_vss05_alert_authoritative', {
              p_report_date: msg.reportDate,
              p_center_id: Number(centerId)
            })
          ])
          if (pingResult.error) throw pingResult.error
          if (vssResult.error) throw vssResult.error
          result = savedReport
          cameraSnapshot = pingResult.data
          vssSnapshot = vssResult.data
        } else {
          if (
            !Number.isSafeInteger(msg.revision) ||
            msg.revision < 0
          ) {
            throw new Error('Revision ไม่ถูกต้อง')
          }

          const { data: latestVss, error: latestVssError } = await supabase.rpc(
            'tcc_vss05_alert_authoritative', {
              p_report_date: msg.reportDate,
              p_center_id: Number(centerId)
            }
          )
          if (latestVssError) throw latestVssError
          if (!latestVss?.has_data) {
            throw new Error('ยังไม่ได้บันทึกรายงาน VSS05 ของวันรายงานนี้ กรุณาบันทึก VSS05 ก่อน')
          }
          if (Number(msg.payload?.alert?.face) !== Number(latestVss.face) ||
              Number(msg.payload?.alert?.veh) !== Number(latestVss.veh)) {
            throw new Error('ยอดแจ้งเตือน VSS05 มีการเปลี่ยนแปลง กรุณาโหลดรายงาน TCC ใหม่ก่อนบันทึก')
          }
          result = await supabase.rpc('tcc_daily_save', {
            p_center_id: Number(centerId),
            p_report_date: msg.reportDate,
            p_data_date: msg.dataDate,
            p_payload: msg.payload,
            p_expected_revision: msg.revision
          })
        }

        if (result.error) {
          throw result.error
        }

        respond(true, result.data, '', cameraSnapshot, vssSnapshot)

        if (msg.kind === 'save-report') {
          setRefreshKey(v => v + 1)
        }
      } catch (err) {
        respond(
          false,
          null,
          err?.message || 'ไม่สามารถติดต่อฐานข้อมูลได้'
        )
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [centerId, centralView, viewMode, date])

  // ========================================
  // ตรวจสิทธิ์
  // ========================================

  if (!allowed) {
    return (
      <p>บัญชีนี้ไม่มีสิทธิ์เข้าดู TCC Dashboard</p>
    )
  }

  const rows = Array.isArray(status?.centers)
    ? status.centers
    : []

  return (
    <div className="tcc-dashboard-host">
      <section
        className="tcc-status-toolbar"
        style={{
          padding: 14,
          border: '1px solid #35455a',
          borderRadius: 12,
          marginBottom: 12,
          background: '#111925',
          color: '#eaf0fa'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <strong>สถานะบันทึกรายงาน TCC</strong>

          {centralView ? (
            <label>
              วันที่รายงาน{' '}
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </label>
          ) : (
            <span>วันที่รายงาน: {date}</span>
          )}

          {manager && (
            <label>
              ศูนย์ที่จัดทำ{' '}
              <select
              value={centerId}
              disabled={busy}
              onChange={e => {
                setCenterId(e.target.value)

                if (e.target.value === 'central') {
                  setViewMode('daily')
                }
              }}
            >
                <option value="">เลือกศูนย์</option>
                {role === 'admin' && (
                  <option value="central">
                    ศชต. — สถิติรวม 6 ศูนย์
                  </option>
                )}

                {rows.map(row => (
                  <option
                    key={row.center_id}
                    value={row.center_id}
                  >
                    {row.center_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            disabled={loading || busy}
            onClick={() => setRefreshKey(v => v + 1)}
          >
            {loading
              ? 'กำลังตรวจสอบ...'
              : 'ตรวจสอบอีกครั้ง'}
          </button>
        </div>

        {error && (
          <p
            role="alert"
            style={{ color: '#ff9a9a' }}
          >
            {error}
          </p>
        )}

        {/* TCC_DAILY_STATUS_ONLY_V17 */}
        {viewMode === 'daily' && (
          <>
        {/* TCC_VISUAL_V2_20261105_STATUS: green for submitted centers */}
        {!error && status && (
          <div style={{
            marginTop: 12,
            padding: '12px 14px',
            border: '1px solid #293d55',
            borderRadius: 12,
            background: '#122033'
          }}>
            {(central || manager) && (
              <div style={{
                display: 'flex', alignItems: 'center',
                flexWrap: 'wrap', gap: 10, marginBottom: 10
              }}>
                <strong style={{ fontSize: 13, color: '#c7d8ee' }}>
                  สถานะการบันทึก
                </strong>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  borderRadius: 999, padding: '5px 12px',
                  background: Number(status.saved_count) > 0 ? '#113e2d' : '#263248',
                  color: Number(status.saved_count) > 0 ? '#8ef0bc' : '#cad2e0',
                  border: `1px solid ${Number(status.saved_count) > 0 ? '#277d58' : '#43516a'}`,
                  fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums'
                }}>
                  {Number(status.saved_count) === Number(status.expected_count)
                    ? '✓ ครบแล้ว' : '● บันทึกแล้ว'}
                  {status.saved_count} / {status.expected_count} ศูนย์
                </span>
                {Number(status.saved_count) < Number(status.expected_count) && (
                  <span style={{ fontSize: 12, color: '#adc0d5' }}>
                    กำลังรอข้อมูลจากศูนย์อื่น
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {rows.map(row => (
                <span
                  key={row.center_id}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    flexWrap: 'wrap', gap: 7,
                    borderRadius: 999,
                    padding: '6px 11px',
                    fontSize: 12, fontWeight: 600,
                    border: `1px solid ${row.saved ? '#2f9d6b' : '#40506a'}`,
                    background: row.saved ? '#113d2a' : '#1c293a',
                    color: row.saved ? '#8bf2b9' : '#b4c1d1'
                  }}
                >
                  <span aria-hidden="true">{row.saved ? '●' : '○'}</span>
                  <span>{row.center_name}</span>
                  <span>{row.saved ? '✓ บันทึกแล้ว' : 'ยังไม่บันทึก'}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <small
          style={{
            display: 'block',
            opacity: 0.7,
            marginTop: 8
          }}
        >
          ข้อมูลตัวเลขบันทึกลงฐานข้อมูลกลาง
          ส่วนภาพประกอบใช้สำหรับ Preview เท่านั้น
        </small>
          </>
        )}
      </section>


      <div className="tcc-view-tabs">
        <button
          type="button"
          className={viewMode === 'daily' ? 'active' : ''}
          onClick={() => setViewMode('daily')}
        >
          รายงานรายวัน
        </button>

        <button
          type="button"
          className={viewMode === 'history' ? 'active' : ''}
          onClick={() => setViewMode('history')}
        >
          สถิติย้อนหลัง
        </button>
        <button
          type="button"
          className={viewMode === 'monthly' ? 'active' : ''}
          onClick={() => setViewMode('monthly')}
        >
          ตารางรายเดือน
        </button>
      </div>


      {viewMode === 'monthly' && (
        <TccMonthlyInline
          canBrowseAll={manager || central}
          ownCenter={ownCenter}
        />
      )}

      {viewMode === 'daily' && (
        centralView ? (
          <iframe
            key={`central-daily-${date}`}
            ref={frameRef}
            className="daily-hub-tcc-frame"
            src={`${import.meta.env.BASE_URL}TCC_Dashboard_Report.html?cid=central&tcc_central=1&report_date=${encodeURIComponent(date)}`}
            title="รายงาน TCC รายวัน ศชต. (ข้อมูลรวมอ่านอย่างเดียว)"
            loading="lazy"
          />
        ) : centerId ? (
          <iframe
            key={centerId}
            ref={frameRef}
            className="daily-hub-tcc-frame"
            src={`${import.meta.env.BASE_URL}TCC_Dashboard_Report.html?cid=${encodeURIComponent(centerId)}`}
            title="รายงาน Dashboard ด่านตรวจ"
            loading="lazy"
          />
        ) : (
          <p className="tcc-select-center-hint">
            กรุณาเลือกศูนย์เพื่อจัดทำรายงานรายวัน
          </p>
        )
      )}


      {viewMode === 'history' && (
        <TccHistoryInline
          key={`${centralView ? 'central' : String(centerId)}-${viewMode}`}
          dailyOnly={centralView && viewMode === 'daily'}
          central={centralView}
          centerId={
            centralView
              ? null
              : manager
                ? (centerId ? Number(centerId) : null)
                : ownCenter
          }
          centerName={
            centralView
              ? 'ศชต.'
              : rows.find(
                  row => Number(row.center_id) === Number(centerId)
                )?.center_name || ''
          }
        />
      )}

    </div>
  )
}



/* ==========================================
   TCC HISTORY — SAME PAGE
   ========================================== */

function TccHistoryInline({
  central,
  centerId,
  centerName,
  dailyOnly = false
}) {
  const formatDate = d => {
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const previousDate = offset => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return formatDate(d)
  }

  const [mode, setMode] = useState('day')
  const [day, setDay] = useState(() => previousDate(-1))
  const [month, setMonth] = useState(() => previousDate(0).slice(0, 7))
  const [fromDate, setFromDate] = useState(() => previousDate(-7))
  const [toDate, setToDate] = useState(() => previousDate(-1))

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const requestId = useRef(0)

  useEffect(() => {
    return () => {
      requestId.current += 1
    }
  }, [])

  const clear = () => {
    requestId.current += 1
    setData(null)
    setError('')
    setLoading(false)
  }

  const search = async event => {
    event.preventDefault()

    let from = day
    let to = day

    if (mode === 'month') {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        setError('เดือนที่เลือกไม่ถูกต้อง')
        return
      }

      const [year, m] = month.split('-').map(Number)
      const last = new Date(year, m, 0).getDate()

      from = `${month}-01`
      to = `${month}-${String(last).padStart(2, '0')}`
    }

    if (mode === 'range') {
      from = fromDate
      to = toDate
    }

    if (!validDate(from) || !validDate(to)) {
      setError('กรุณาเลือกวันที่ให้ถูกต้อง')
      return
    }

    const start = new Date(`${from}T12:00:00`)
    const end = new Date(`${to}T12:00:00`)
    const diff = Math.round(
      (end.getTime() - start.getTime()) / 86400000
    )

    if (
      diff < 0 ||
      diff > 365 ||
      from < '2000-01-01' ||
      to > '2200-12-31'
    ) {
      setError('ช่วงวันที่ไม่ถูกต้อง หรือเกิน 366 วัน')
      return
    }

    const id = ++requestId.current

    setLoading(true)
    setError('')
    setData(null)

    try {
      const { data: result, error: rpcError } =
        await supabase.rpc('tcc_history_range', {
          p_from_date: from,
          p_to_date: to,
          p_center_id: central ? null : centerId
        })

      if (rpcError) throw rpcError
      // TCC_VSS05_SINGLE_SOURCE_V12_REACT_20261106
      // History alert counts come LIVE from VSS05, keyed to statistics date.
      const { data: vssHistory, error: vssError } =
        await supabase.rpc('tcc_vss05_alert_range', {
          p_from_date: from,
          p_to_date: to,
          p_center_id: central ? null : centerId
        })
      if (vssError) throw vssError
      if (id !== requestId.current) return

      const vssByDay = new Map(
        (vssHistory?.data_by_date || []).map(row => [row.data_date, row])
      )
      const vssByRecord = new Map(
        (vssHistory?.records || []).map(row => [
          String(row.center_id) + '|' + row.data_date, row
        ])
      )
      const mergedRows = (result?.data_by_date || []).map(row => {
        const v = vssByDay.get(row.data_date)
        return {
          ...row,
          totals: {
            ...(row.totals || {}),
            alert: { face: Number(v?.face || 0), veh: Number(v?.veh || 0) }
          },
          vss05_saved_count: Number(v?.saved_count || 0),
          vss05_expected_count: Number(v?.expected_count || (central || !centerId ? 6 : 1))
        }
      })
      const mergedRecords = central ? [] : (result?.records || []).map(row => {
        const v = vssByRecord.get(String(row.center_id) + '|' + row.data_date)
        return {
          ...row,
          payload: {
            ...(row.payload || {}),
            alert: { face: Number(v?.face || 0), veh: Number(v?.veh || 0) }
          }
        }
      })
      setData({
        ...result,
        data_by_date: mergedRows,
        records: mergedRecords
      })

    } catch (err) {
      if (id !== requestId.current) return

      setError(err?.message || 'ค้นหาข้อมูลไม่สำเร็จ')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  const dataRows = Array.isArray(data?.data_by_date)
    ? data.data_by_date
    : []

  const cameraRows = Array.isArray(data?.camera_by_report_date)
    ? data.camera_by_report_date
    : []

  const sum = obj =>
    Object.values(obj || {}).reduce(
      (total, value) => total + Number(value || 0),
      0
    )

  const fmt = value =>
    Number(value || 0).toLocaleString('en-US')

  const totals = dataRows.reduce((acc, row) => {
    const t = row.totals || {}

    acc.vehicleIn += sum(t.vin)
    acc.vehicleOut += sum(t.vout)
    acc.faceIn += Number(t.face?.in || 0)
    acc.faceOut += Number(t.face?.out || 0)
    acc.alertFace += Number(t.alert?.face || 0)
    acc.alertVehicle += Number(t.alert?.veh || 0)

    return acc
  }, {
    vehicleIn: 0,
    vehicleOut: 0,
    faceIn: 0,
    faceOut: 0,
    alertFace: 0,
    alertVehicle: 0
  })

  const summary = [
    ['รถขาเข้า', totals.vehicleIn, 'คัน'],
    ['รถขาออก', totals.vehicleOut, 'คัน'],
    ['ใบหน้าขาเข้า', totals.faceIn, 'ครั้ง'],
    ['ใบหน้าขาออก', totals.faceOut, 'ครั้ง'],
    ['แจ้งเตือนใบหน้า', totals.alertFace, 'เหตุการณ์'],
    ['แจ้งเตือนรถ', totals.alertVehicle, 'เหตุการณ์']
  ]


  const exportExcel = async () => {
  if (!data || loading || exporting) return

  const daily = Array.isArray(data.data_by_date)
    ? data.data_by_date
    : []

  const cameras = Array.isArray(data.camera_by_report_date)
    ? data.camera_by_report_date
    : []

  if (!daily.length && !cameras.length) {
    setError('ไม่มีข้อมูลสำหรับส่งออก Excel')
    return
  }

  setExporting(true)
  setError('')

  try {
    const excelModule = await import('exceljs-community')
    const ExcelJS = excelModule.default || excelModule
    const workbook = new ExcelJS.Workbook()

    workbook.creator = 'TCC Checkpoint Dashboard'
    workbook.created = new Date()
    workbook.modified = new Date()
    workbook.properties.date1904 = false

    const THEME = {
      navy: 'FF17365D',
      navy2: 'FF24476F',
      lightBlue: 'FFDCE6F1',
      paleBlue: 'FFEEF3F8',
      green: 'FFE2F0D9',
      greenText: 'FF1E6A39',
      yellow: 'FFFFF2CC',
      red: 'FFFDE9E7',
      border: 'FFB8C4D2',
      white: 'FFFFFFFF',
      text: 'FF1F1F1F',
      gray: 'FF666666'
    }

    const thinBorder = {
      top: { style: 'thin', color: { argb: THEME.border } },
      left: { style: 'thin', color: { argb: THEME.border } },
      bottom: { style: 'thin', color: { argb: THEME.border } },
      right: { style: 'thin', color: { argb: THEME.border } }
    }

    const center = {
      vertical: 'middle',
      horizontal: 'center'
    }

    const left = {
      vertical: 'middle',
      horizontal: 'left'
    }

    const right = {
      vertical: 'middle',
      horizontal: 'right'
    }

    const num = value => Number(value || 0)

    const styleAllCells = (sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = { name: 'Tahoma', size: 10, color: { argb: THEME.text } }
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
        })
      })
    }

    const fillRow = (row, color, fontColor = THEME.white, bold = true) => {
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: color }
        }
        cell.font = {
          name: 'Tahoma',
          size: 10,
          bold,
          color: { argb: fontColor }
        }
        cell.alignment = center
        cell.border = thinBorder
      })
    }

    const applyTableBorders = (sheet, fromRow, toRow, fromCol, toCol) => {
      for (let r = fromRow; r <= toRow; r += 1) {
        for (let c = fromCol; c <= toCol; c += 1) {
          const cell = sheet.getRow(r).getCell(c)
          cell.border = thinBorder
        }
      }
    }

    const setPage = (sheet) => {
      sheet.pageSetup = {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
        margins: {
          left: 0.3,
          right: 0.3,
          top: 0.5,
          bottom: 0.5,
          header: 0.2,
          footer: 0.2
        }
      }

    }

    const autoNumberFormat = (sheet, colIndexes = []) => {
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        colIndexes.forEach((col) => {
          const cell = row.getCell(col)
          if (typeof cell.value === 'number') {
            cell.numFmt = '#,##0'
            cell.alignment = right
          }
        })
      })
    }

    /* =========================================================
       SHEET 1: สรุปภาพรวม
       ========================================================= */

    {
      const ws = workbook.addWorksheet('สรุปภาพรวม')
      setPage(ws)

      ws.columns = Array.from({ length: 8 }, () => ({
        width: 14
      }))

      const paint = (cell, {
        bg = THEME.white,
        color = THEME.text,
        size = 11,
        bold = false,
        align = 'center'
      } = {}) => {
        cell.font = {
          name: 'Tahoma',
          size,
          bold,
          color: { argb: color }
        }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bg }
        }
        cell.alignment = {
          vertical: 'middle',
          horizontal: align,
          wrapText: true
        }
        cell.border = thinBorder
      }

      // ชื่อรายงาน
      ws.mergeCells('A1:H2')
      ws.getCell('A1').value = 'รายงานสถิติ TCC'
      paint(ws.getCell('A1'), {
        bg: THEME.navy,
        color: THEME.white,
        size: 20,
        bold: true
      })
      ws.getRow(1).height = 30
      ws.getRow(2).height = 23

      ws.mergeCells('A3:H3')
      ws.getCell('A3').value =
        'CHECKPOINT VEHICLE & FACE STATISTICS REPORT'
      paint(ws.getCell('A3'), {
        bg: THEME.lightBlue,
        color: THEME.navy,
        size: 10
      })
      ws.getRow(3).height = 24

      // รายละเอียดรายงาน
      const details = [
        ['ช่วงข้อมูล',
          `${data.from_date} ถึง ${data.to_date}`],
        ['ขอบเขต',
          central
            ? 'ศชต. — ยอดรวมศูนย์ที่ส่งข้อมูลแล้ว'
            : centerId
              ? (centerName || 'ศูนย์ที่เลือก')
              : 'ทุกศูนย์'],
        ['ข้อมูลสถิติ',
          'รถและใบหน้าอ้างอิงวันที่ของสถิติ'],
        ['ข้อมูลกล้อง',
          'อ้างอิงวันที่รายงาน ไม่บวกรวมข้ามวัน']
      ]

      details.forEach(([label, value], i) => {
        const r = 5 + i
        ws.mergeCells(`A${r}:B${r}`)
        ws.mergeCells(`C${r}:H${r}`)

        ws.getCell(`A${r}`).value = label
        ws.getCell(`C${r}`).value = value

        paint(ws.getCell(`A${r}`), {
          bg: THEME.lightBlue,
          color: THEME.navy,
          bold: true,
          align: 'left'
        })
        paint(ws.getCell(`C${r}`), {
          bg: i % 2 === 0
            ? THEME.paleBlue
            : THEME.white,
          align: 'left'
        })
        ws.getRow(r).height = 25
      })

      const sectionTitle = (row, title) => {
        ws.mergeCells(`A${row}:H${row}`)
        const cell = ws.getCell(`A${row}`)
        cell.value = title
        paint(cell, {
          bg: THEME.navy2,
          color: THEME.white,
          size: 12,
          bold: true
        })
        ws.getRow(row).height = 28
      }

      const metricPair = (
        titleRow,
        heading,
        leftLabel,
        leftValue,
        rightLabel,
        rightValue
      ) => {
        sectionTitle(titleRow, heading)

        const top = titleRow + 1
        const bottom = titleRow + 2

        const items = [
          {
            col1: 'A', col2: 'B',
            label: leftLabel, isNumber: false
          },
          {
            col1: 'C', col2: 'D',
            label: leftValue, isNumber: true
          },
          {
            col1: 'E', col2: 'F',
            label: rightLabel, isNumber: false
          },
          {
            col1: 'G', col2: 'H',
            label: rightValue, isNumber: true
          }
        ]

        items.forEach(item => {
          ws.mergeCells(
            `${item.col1}${top}:${item.col2}${bottom}`
          )

          const cell = ws.getCell(`${item.col1}${top}`)
          cell.value = item.label

          paint(cell, {
            bg: item.isNumber
              ? THEME.white
              : THEME.paleBlue,
            color: THEME.navy,
            size: item.isNumber ? 17 : 11,
            bold: true
          })

          if (item.isNumber) {
            cell.numFmt = '#,##0'
          }
        })

        ws.getRow(top).height = 23
        ws.getRow(bottom).height = 23
      }

      metricPair(
        11,
        'สถิติยานพาหนะ',
        'รถขาเข้า (คัน)',
        totals.vehicleIn,
        'รถขาออก (คัน)',
        totals.vehicleOut
      )

      metricPair(
        15,
        'สถิติการตรวจจับใบหน้า',
        'ใบหน้าขาเข้า (ครั้ง)',
        totals.faceIn,
        'ใบหน้าขาออก (ครั้ง)',
        totals.faceOut
      )

      metricPair(
        19,
        'สถิติการแจ้งเตือน',
        'แจ้งเตือนใบหน้า (เหตุการณ์)',
        totals.alertFace,
        'แจ้งเตือนรถ (เหตุการณ์)',
        totals.alertVehicle
      )

      ws.mergeCells('A23:H23')
      ws.getCell('A23').value =
        'หมายเหตุ: ตัวเลขจากฐานข้อมูลกลางตามช่วงวันที่และสิทธิ์ที่เลือก'
      paint(ws.getCell('A23'), {
        bg: THEME.lightBlue,
        color: THEME.gray,
        size: 9,
        align: 'left'
      })
      ws.getRow(23).height = 26

      ws.pageSetup.printArea = 'A1:H23'
    }

    /* =========================================================
       SHEET 2: สถิติรายวัน
       ========================================================= */
    {
      const ws = workbook.addWorksheet('สถิติรายวัน')
      setPage(ws)

      ws.columns = [
        { header: 'วันที่ของสถิติ', width: 16 },
        { header: 'สถานะ', width: 16 },
        { header: 'รถเข้า', width: 14 },
        { header: 'รถออก', width: 14 },
        { header: 'ใบหน้าเข้า', width: 14 },
        { header: 'ใบหน้าออก', width: 14 },
        { header: 'แจ้งเตือนใบหน้า', width: 18 },
        { header: 'แจ้งเตือนรถ', width: 16 }
      ]

      ws.mergeCells('A1:H1')
      ws.getCell('A1').value = 'สถิติรถและใบหน้าแยกตามวันที่ของสถิติ'
      ws.getCell('A1').font = {
        name: 'Tahoma',
        size: 14,
        bold: true,
        color: { argb: THEME.white }
      }
      ws.getCell('A1').alignment = center
      ws.getCell('A1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: THEME.navy }
      }
      ws.getRow(1).height = 24

      const headerRow = ws.getRow(3)
      headerRow.values = [
        'วันที่ของสถิติ',
        'สถานะ',
        'รถเข้า',
        'รถออก',
        'ใบหน้าเข้า',
        'ใบหน้าออก',
        'แจ้งเตือนใบหน้า',
        'แจ้งเตือนรถ'
      ]
      fillRow(headerRow, THEME.navy2)

      daily.forEach((row, index) => {
        const t = row.totals || {}
        const excelRow = ws.getRow(4 + index)

        excelRow.values = [
          row.data_date,
          `${row.saved_count}/${row.expected_count}${row.complete ? ' ครบ' : ' ไม่ครบ'}`,
          sum(t.vin),
          sum(t.vout),
          num(t.face?.in),
          num(t.face?.out),
          num(t.alert?.face),
          num(t.alert?.veh)
        ]

        excelRow.getCell(1).alignment = center
        excelRow.getCell(2).alignment = center

        for (let c = 3; c <= 8; c += 1) {
          excelRow.getCell(c).numFmt = '#,##0'
          excelRow.getCell(c).alignment = right
        }

        excelRow.eachCell((cell) => {
          cell.border = thinBorder
          cell.font = { name: 'Tahoma', size: 10 }
        })

        excelRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: row.complete
                ? (index % 2 === 0 ? THEME.paleBlue : THEME.white)
                : THEME.yellow
            }
          }
        })
      })
    }

    /* =========================================================
       SHEET 3: ประเภทรถและทะเบียน
       ========================================================= */
    {
      const ws = workbook.addWorksheet('ประเภทรถและทะเบียน')
      setPage(ws)

      ws.columns = [
        { width: 16 },
        { width: 20 },
        { width: 20 },
        { width: 14 },
        { width: 14 }
      ]

      ws.mergeCells('A1:E1')
      ws.getCell('A1').value = 'รายละเอียดประเภทรถและทะเบียน'
      ws.getCell('A1').font = {
        name: 'Tahoma',
        size: 14,
        bold: true,
        color: { argb: THEME.white }
      }
      ws.getCell('A1').alignment = center
      ws.getCell('A1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: THEME.navy }
      }

      ws.getRow(3).values = ['วันที่', 'กลุ่มข้อมูล', 'รายการ', 'ขาเข้า', 'ขาออก']
      fillRow(ws.getRow(3), THEME.navy2)

      const vehicleTypes = [
        ['car', 'รถยนต์'],
        ['pick', 'รถกระบะ'],
        ['moto', 'รถจักรยานยนต์'],
        ['truck', 'รถบรรทุก'],
        ['van', 'รถตู้'],
        ['other', 'รถประเภทอื่น']
      ]

      const provinces = [
        ['pt', 'ปัตตานี'],
        ['yl', 'ยะลา'],
        ['nr', 'นราธิวาส']
      ]

      let rowNo = 4

      daily.forEach((row) => {
        const t = row.totals || {}

        vehicleTypes.forEach(([key, label], idx) => {
          const r = ws.getRow(rowNo++)
          r.values = [
            row.data_date,
            'ประเภทรถ',
            label,
            num(t.vin?.[key]),
            num(t.vout?.[key])
          ]
          r.eachCell(cell => {
            cell.border = thinBorder
            cell.font = { name: 'Tahoma', size: 10 }
          })
          if (idx % 2 === 0) {
            r.eachCell(cell => {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: THEME.paleBlue }
              }
            })
          }
        })

        provinces.forEach(([key, label], idx) => {
          const r = ws.getRow(rowNo++)
          r.values = [
            row.data_date,
            'ทะเบียน 3 จชต.',
            label,
            num(t.pin?.[key]),
            num(t.pout?.[key])
          ]
          r.eachCell(cell => {
            cell.border = thinBorder
            cell.font = { name: 'Tahoma', size: 10 }
          })
          if (idx % 2 === 0) {
            r.eachCell(cell => {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF8FBFE' }
              }
            })
          }
        })
      })

      autoNumberFormat(ws, [4, 5])
    }

    /* =========================================================
       SHEET 4: สถานะกล้องรายวัน
       ========================================================= */
    {
      const ws = workbook.addWorksheet('สถานะกล้องรายวัน')
      setPage(ws)

      ws.columns = [
        { width: 16 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
        { width: 16 }
      ]

      ws.mergeCells('A1:E1')
      ws.getCell('A1').value = 'สถานะกล้องแยกตามวันที่รายงาน'
      ws.getCell('A1').font = {
        name: 'Tahoma',
        size: 14,
        bold: true,
        color: { argb: THEME.white }
      }
      ws.getCell('A1').alignment = center
      ws.getCell('A1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: THEME.navy }
      }

      ws.getRow(2).values = [
        'วันที่รายงาน',
        'สถานะ',
        'กล้องปกติ',
        'กล้องเสีย',
        'กล้องทั้งหมด'
      ]
      fillRow(ws.getRow(2), THEME.navy2)

      cameras.forEach((row, index) => {
        const ok = num(row.cam?.ok)
        const bad = num(row.cam?.bad)
        const r = ws.getRow(3 + index)

        r.values = [
          row.report_date,
          `${row.saved_count}/${row.expected_count}${row.complete ? ' ครบ' : ' ไม่ครบ'}`,
          ok,
          bad,
          ok + bad
        ]

        r.eachCell(cell => {
          cell.border = thinBorder
          cell.font = { name: 'Tahoma', size: 10 }
        })

        for (let c = 3; c <= 5; c += 1) {
          r.getCell(c).numFmt = '#,##0'
          r.getCell(c).alignment = right
        }

        r.eachCell(cell => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: row.complete
                ? (index % 2 === 0 ? THEME.green : THEME.white)
                : THEME.red
            }
          }
        })
      })
    }

    /* =========================================================
       SHEET 5: รายละเอียดรายศูนย์
       ========================================================= */
    {
      const records = !central && Array.isArray(data.records)
        ? data.records
        : []

      if (records.length) {
        const ws = workbook.addWorksheet('รายละเอียดรายศูนย์')
        setPage(ws)

        ws.columns = [
          { width: 20 },
          { width: 16 },
          { width: 16 },
          { width: 12 },
          { width: 12 },
          { width: 12 },
          { width: 12 },
          { width: 16 },
          { width: 14 },
          { width: 10 }
        ]

        ws.mergeCells('A1:J1')
        ws.getCell('A1').value = 'รายละเอียดข้อมูลรายศูนย์'
        ws.getCell('A1').font = {
          name: 'Tahoma',
          size: 14,
          bold: true,
          color: { argb: THEME.white }
        }
        ws.getCell('A1').alignment = center
        ws.getCell('A1').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: THEME.navy }
        }

        ws.getRow(3).values = [
          'ศูนย์',
          'วันที่รายงาน',
          'วันที่ของสถิติ',
          'รถเข้า',
          'รถออก',
          'ใบหน้าเข้า',
          'ใบหน้าออก',
          'แจ้งเตือนใบหน้า',
          'แจ้งเตือนรถ',
          'Revision'
        ]
        fillRow(ws.getRow(3), THEME.navy2)

        records.forEach((row, index) => {
          const p = row.payload || {}
          const r = ws.getRow(4 + index)

          r.values = [
            row.center_name,
            row.report_date,
            row.data_date,
            sum(p.vin),
            sum(p.vout),
            num(p.face?.in),
            num(p.face?.out),
            num(p.alert?.face),
            num(p.alert?.veh),
            num(row.revision)
          ]

          r.eachCell(cell => {
            cell.border = thinBorder
            cell.font = { name: 'Tahoma', size: 10 }
          })

          for (let c = 4; c <= 10; c += 1) {
            r.getCell(c).numFmt = '#,##0'
            r.getCell(c).alignment = right
          }

          if (index % 2 === 0) {
            r.eachCell(cell => {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: THEME.paleBlue }
              }
            })
          }
        })
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()

    const blob = new Blob(
      [buffer],
      {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    )

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `TCC_${data.from_date}_to_${data.to_date}.xlsx`

    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (err) {
    setError(err?.message || 'ไม่สามารถสร้างไฟล์ Excel ได้')
  } finally {
    setExporting(false)
  }
}

  const changeMode = value => {
    setMode(value)
    clear()
  }

  return (
    <section className="tcc-history-inline">
      <div className="tcc-history-head">
        <div>
          <h3>
            {dailyOnly ? 'รายงาน TCC รายวัน — ศชต.' : 'สถิติ TCC ย้อนหลัง'}
          </h3>
          <p>รายงานข้อมูลจากฐานข้อมูลกลาง</p>
        </div>

        <span>
          {central ? 'ยอดรวม 6 ศูนย์' :
            centerId ? 'ศูนย์ที่เลือก' : 'รวมทุกศูนย์'}
        </span>
      </div>

      <div className="tcc-history-workspace">
        <aside className="tcc-history-sidebar">

      <form className="tcc-history-filter" onSubmit={search}>

        {!dailyOnly && (
          <label>
            รูปแบบ
            <select
              value={mode}
              onChange={e => changeMode(e.target.value)}
            >
              <option value="day">รายวัน</option>
              <option value="month">รายเดือน</option>
              <option value="range">กำหนดช่วงวันที่</option>
            </select>
          </label>
        )}


        {mode === 'day' && (
          <label>
            วันที่ของสถิติ
            <input
              type="date"
              value={day}
              onChange={e => {
                setDay(e.target.value)
                clear()
              }}
              required
            />
          </label>
        )}

        {mode === 'month' && (
          <label>
            เดือน
            <input
              type="month"
              value={month}
              onChange={e => {
                setMonth(e.target.value)
                clear()
              }}
              required
            />
          </label>
        )}

        {mode === 'range' && (
          <>
            <label>
              ตั้งแต่
              <input
                type="date"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value)
                  clear()
                }}
                required
              />
            </label>

            <label>
              ถึง
              <input
                type="date"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value)
                  clear()
                }}
                required
              />
            </label>
          </>
        )}

        <button type="submit" disabled={loading}>
          {loading ? 'กำลังค้นหา...' : 'ค้นหาข้อมูล'}
        </button>
        <button
          type="button"
          className="tcc-export-btn"
          disabled={!data || loading || exporting}
          onClick={exportExcel}
        >
          {exporting ? 'กำลังสร้าง Excel...' : 'ส่งออก Excel (.xlsx)'}
        </button>
      </form>

      {error && (
        <p className="tcc-history-error" role="alert">
          {error}
        </p>
      )}

      {data && (
        <div className="tcc-history-sidebar-stats">
          <h4>สรุปสถิติที่ค้นหา</h4>

          {summary.map(([label, value, unit]) => (
            <div className="tcc-history-sidebar-stat" key={label}>
              <span>{label}</span>
              <strong>{fmt(value)}</strong>
              <small>{unit}</small>
            </div>
          ))}
        </div>
      )}

      </aside>

      <main className="tcc-history-preview-main">

        <div className="tcc-history-preview-stage">
          <h3>พรีวิว Dashboard ด่านตรวจ</h3>

          {data && dataRows.length > 0 ? (
            <>
              <p className="tcc-history-note">
                ข้อมูลช่วง {data.from_date} ถึง {data.to_date}
                {' '}| สถานะกล้องไม่รวมข้ามวัน
                {' '}| ไม่แสดงภาพมุมกล้องย้อนหลัง
              </p>

              <iframe
                title="พรีวิวรายงาน TCC ย้อนหลัง"
                src={`${import.meta.env.BASE_URL}TCC_Dashboard_Report.html?tcc_preview=1`}
                onLoad={event => {
                  const fields = {
                    alert: ['face', 'veh'],
                    face: ['in', 'out'],
                    vin: ['car', 'pick', 'moto', 'truck', 'van', 'other'],
                    vout: ['car', 'pick', 'moto', 'truck', 'van', 'other'],
                    pin: ['pt', 'yl', 'nr'],
                    pout: ['pt', 'yl', 'nr']
                  }

                  const payload = {}

                  for (const [group, keys] of Object.entries(fields)) {
                    payload[group] = {}

                    for (const key of keys) {
                      payload[group][key] = dataRows.reduce(
                        (total, row) =>
                          total + Math.max(
                            0,
                            Number(row.totals?.[group]?.[key]) || 0
                          ),
                        0
                      )
                    }
                  }

                  const singleDay = data.from_date === data.to_date

                  const nextDay = new Date(
                    `${data.to_date}T12:00:00`
                  )
                  nextDay.setDate(nextDay.getDate() + 1)

                  const pad = n => String(n).padStart(2, '0')
                  const nextReportDate =
                    `${nextDay.getFullYear()}-` +
                    `${pad(nextDay.getMonth() + 1)}-` +
                    `${pad(nextDay.getDate())}`

                  const record = (
                    !central &&
                    centerId &&
                    Array.isArray(data.records)
                  )
                    ? data.records.find(
                        row => row.data_date === data.to_date
                      )
                    : null

                  const latestCamera = singleDay
                    ? cameraRows.find(
                        row => row.report_date === nextReportDate
                      )
                    : [...cameraRows].sort(
                        (a, b) =>
                          String(b.report_date).localeCompare(
                            String(a.report_date)
                          )
                      )[0]

                  const camera = singleDay
                    ? (record?.payload?.cam || latestCamera?.cam)
                    : latestCamera?.cam

                  payload.cam = {
                    ok: Number(camera?.ok) || 0,
                    bad: Number(camera?.bad) || 0
                  }

                  const reportDate = singleDay
                    ? (record?.report_date || nextReportDate)
                    : (latestCamera?.report_date || data.to_date)

                  event.currentTarget.contentWindow?.postMessage({
                    source: 'tcc-host',
                    kind: 'history-preview',
                    reportDate,
                    dataDate: data.to_date,
                    payload,
                    title: central
                      ? 'ศชต. — รายงาน TCC ย้อนหลัง'
                      : `${centerName || 'ทุกศูนย์'} — รายงาน TCC ย้อนหลัง`,
                    subtitle: singleDay
                      ? `ข้อมูลสถิติวันที่ ${data.to_date}`
                      : `ยอดรวมช่วง ${data.from_date} ถึง ${data.to_date}`
                  }, window.location.origin)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  aspectRatio: '1600 / 1542',
                  border: 'none',
                  borderRadius: 8,
                  background: '#050d26'
                }}
              />
            </>
          ) : (
            <p>
              {data
                ? 'ไม่พบข้อมูลสำหรับสร้างพรีวิว'
                : 'เลือกวันที่แล้วกดค้นหาข้อมูลทางด้านซ้าย'}
            </p>
          )}
        </div>


      {data && (
        <>
          <p className="tcc-history-period">
            ช่วงวันที่ {data.from_date} ถึง {data.to_date}
          </p>


          {central && (
            <p className="tcc-history-note">
              แสดงยอดรวมจากศูนย์ที่ส่งข้อมูลแล้ว
              วันที่ส่งไม่ครบ 6 ศูนย์ถือเป็นข้อมูลเบื้องต้น
              โดยไม่เปิดเผยตัวเลขรายศูนย์
            </p>
          )}


          {!central && dataRows.some(row => !row.complete) && (
            <p className="tcc-history-note">
              บางวันยังได้รับข้อมูลไม่ครบทุกศูนย์
              ตัวเลขที่แสดงอาจเป็นยอดบางส่วน
            </p>
          )}



          <h4>สถิติรถและใบหน้า</h4>

          <div className="tcc-history-scroll">
            <table>
              <thead>
                <tr>
                  <th>วันที่ของสถิติ</th>
                  <th>บันทึก</th>
                  <th>รถเข้า</th>
                  <th>รถออก</th>
                  <th>ใบหน้าเข้า</th>
                  <th>ใบหน้าออก</th>
                  <th>แจ้งเตือนใบหน้า</th>
                  <th>แจ้งเตือนรถ</th>
                </tr>
              </thead>

              <tbody>
                {dataRows.map(row => {
                  const t = row.totals || {}

                  return (
                    <tr key={row.data_date}>
                      <td>{row.data_date}</td>
                      <td>
                        {row.saved_count}/{row.expected_count}
                        {row.complete ? ' ครบ' : ' ไม่ครบ'}
                        <small style={{ display: 'block', color: '#9eb5d6' }}>
                          VSS05 {row.vss05_saved_count}/{row.vss05_expected_count}
                        </small>
                      </td>
                      <td>{fmt(sum(t.vin))}</td>
                      <td>{fmt(sum(t.vout))}</td>
                      <td>{fmt(t.face?.in)}</td>
                      <td>{fmt(t.face?.out)}</td>
                      <td>{fmt(t.alert?.face)}</td>
                      <td>{fmt(t.alert?.veh)}</td>
                    </tr>
                  )
                })}

                {dataRows.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      ไม่พบข้อมูลที่แสดงได้ในช่วงวันที่เลือก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h4>สถานะกล้องแยกตามวันที่รายงาน</h4>

          <p className="tcc-history-note">
            จำนวนกล้องเป็นข้อมูล ณ วันรายงาน
            จึงไม่บวกรวมข้ามวัน
          </p>

          <div className="tcc-history-scroll">
            <table>
              <thead>
                <tr>
                  <th>วันที่รายงาน</th>
                  <th>บันทึก</th>
                  <th>กล้องปกติ</th>
                  <th>กล้องเสีย</th>
                  <th>กล้องทั้งหมด</th>
                </tr>
              </thead>

              <tbody>
                {cameraRows.map(row => {
                  const ok = Number(row.cam?.ok || 0)
                  const bad = Number(row.cam?.bad || 0)

                  return (
                    <tr key={row.report_date}>
                      <td>{row.report_date}</td>
                      <td>
                        {row.saved_count}/{row.expected_count}
                        {row.complete ? ' ครบ' : ' ไม่ครบ'}
                      </td>
                      <td>{fmt(ok)}</td>
                      <td>{fmt(bad)}</td>
                      <td>{fmt(ok + bad)}</td>
                    </tr>
                  )
                })}

                {cameraRows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      ไม่พบข้อมูลกล้องในช่วงวันที่เลือก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !error && !loading && (
  <p className="tcc-history-placeholder">
    เลือกช่วงวันที่แล้วกดค้นหาข้อมูล
  </p>
)}

    </main>
  </div>
</section>
)
}

/* TCC_MONTHLY_IN_FILE_V14_20261106: monthly matrix, same JSX file. */
function TccMonthlyInline({ canBrowseAll, ownCenter }) {
  const [month, setMonth] = useState(() => localDate().slice(0, 7))
  const [selectedCenter, setSelectedCenter] = useState(
    canBrowseAll ? '' : String(ownCenter)
  )
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const centers = [
    { id: 1, name: 'ศูนย์นราธิวาส' },
    { id: 2, name: 'ศูนย์ปัตตานี' },
    { id: 4, name: 'ศูนย์หาดใหญ่' },
    { id: 7, name: 'ศูนย์ตากใบ' },
    { id: 8, name: 'ศูนย์สุไหง-โกลก' },
    { id: 9, name: 'ศูนย์เบตง' }
  ]

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      setData(null)
      setError('เดือนและปีไม่ถูกต้อง')
      return
    }
    let active = true
    const [year, m] = month.split('-').map(Number)
    setLoading(true)
    setError('')
    setData(null)
    supabase.rpc('tcc_monthly_overview', {
      p_year: year,
      p_month: m,
      p_center_id: canBrowseAll
        ? (selectedCenter ? Number(selectedCenter) : null)
        : Number(ownCenter)
    }).then(({ data: result, error: rpcError }) => {
      if (!active) return
      if (rpcError) throw rpcError
      setData(result)
    }).catch(err => {
      if (!active) return
      setError(err?.message || 'โหลดตารางรายเดือนไม่สำเร็จ')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [month, selectedCenter, canBrowseAll, ownCenter])

  const raw = Array.isArray(data?.rows) ? data.rows : []
  const visibleCenters = Array.isArray(data?.centers) ? data.centers : []
  const fmt = n => Number(n || 0).toLocaleString('en-US')
  const nDays = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    : 0
  const expected = visibleCenters.length || (selectedCenter ? 1 : 6)
  const perDay = new Map()
  raw.forEach(item => {
    // Group by statistics/data date. Report is issued on the following day.
    const date = item.data_date
    if (typeof date !== 'string') return
    if (!perDay.has(date)) perDay.set(date, [])
    perDay.get(date).push(item)
  })
  // TCC_MONTHLY_ALERT_COUNTS_V16_20261106
  const statuses = [
    ['tcc_saved', 'บันทึกข้อมูล']
  ]
  const count = (items, key) => items.filter(item => item[key] === true).length
  const pill = (number, total) => {
    const state = number === 0 ? 'none' : number >= total ? 'done' : 'partial'
    return <span className={`tcc-month-pill is-${state}`}>
      {number === 0 ? '—' : `✓ ${number}/${total}`}
    </span>
  }
  const dates = Array.from({ length: nDays }, (_, i) => {
    // The selected month refers to DATA dates, including its first/last day.
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    const items = perDay.get(date) || []
    const hasFace = items.some(item => item.face_saved)
    const hasVehicle = items.some(item => item.vehicle_saved)
    // Missing VSS05 differs from a saved report with zero incidents.
    const hasAlert = items.some(item => item.alert_saved === true)
    const alertFace = items.reduce((sum, item) => sum + Number(item.alert_face || 0), 0)
    const alertVehicle = items.reduce((sum, item) => sum + Number(item.alert_vehicle || 0), 0)
    const faceIn = items.reduce((sum, item) => sum + Number(item.face_in || 0), 0)
    const faceOut = items.reduce((sum, item) => sum + Number(item.face_out || 0), 0)
    const vehicleIn = items.reduce((sum, item) => sum + Number(item.vehicle_in || 0), 0)
    const vehicleOut = items.reduce((sum, item) => sum + Number(item.vehicle_out || 0), 0)
    return { date, items, hasFace, hasVehicle, hasAlert, alertFace, alertVehicle,
      faceIn, faceOut, vehicleIn, vehicleOut }
  })
  const faceByCenter = visibleCenters.map(center => {
    const items = raw.filter(item => Number(item.center_id) === Number(center.center_id))
    const saved = count(items, 'face_saved')
    const faceIn = items.reduce((sum, item) => sum + Number(item.face_in || 0), 0)
    const faceOut = items.reduce((sum, item) => sum + Number(item.face_out || 0), 0)
    return { id: center.center_id, name: center.center_name,
      saved, faceIn, faceOut }
  })
  const totalIn = faceByCenter.reduce((sum, center) => sum + center.faceIn, 0)
  const totalOut = faceByCenter.reduce((sum, center) => sum + center.faceOut, 0)
  const totalVehicleIn = raw.reduce((sum, item) => sum + Number(item.vehicle_in || 0), 0)
  const totalVehicleOut = raw.reduce((sum, item) => sum + Number(item.vehicle_out || 0), 0)
  const totalAlertFace = raw.reduce((sum, item) => sum + Number(item.alert_face || 0), 0)
  const totalAlertVehicle = raw.reduce((sum, item) => sum + Number(item.alert_vehicle || 0), 0)
  const hasAnyAlert = raw.some(item => item.alert_saved === true)
  const displayDate = value =>
    `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
  // TCC_MONTHLY_TABLE_V15_DATA_DATE_ONLY_20261106


  return (
    <section className="tcc-monthly-view">
      <div className="tcc-monthly-header">
        <div>
          <h3>ตารางรายงาน TCC รายเดือน</h3>
          <p>ตารางอ้างอิงวันที่ข้อมูล (00:00–23:59) • สีเขียว = มีข้อมูลบันทึกแล้วตามขอบเขตที่เลือก</p>
        </div>
        <div className="tcc-monthly-filters">
          <label>
            เดือน / ปี
            <input type="month" min="2000-01" max="2200-12"
              value={month} onChange={e => setMonth(e.target.value)} />
          </label>
          {canBrowseAll && <label>
            ศูนย์ที่ดู
            <select value={selectedCenter}
              onChange={e => setSelectedCenter(e.target.value)}>
              <option value="">ทุกศูนย์ (รวม 6 ศูนย์)</option>
              {centers.map(center => <option key={center.id} value={center.id}>
                {center.name}
              </option>)}
            </select>
          </label>}
        </div>
      </div>

      {loading && <p className="tcc-monthly-loading">กำลังโหลดข้อมูลรายเดือน...</p>}
      {error && <p className="tcc-history-error" role="alert">{error}</p>}
      {!loading && data && <>
        <div className="tcc-monthly-highlights">
          <div><span>จำนวนวันที่ในเดือน</span><strong>{nDays}</strong><small>วัน</small></div>
          <div><span>ใบหน้าเข้า</span><strong>{fmt(totalIn)}</strong><small>ครั้ง</small></div>
          <div><span>ใบหน้าออก</span><strong>{fmt(totalOut)}</strong><small>ครั้ง</small></div>
          <div><span>รวมใบหน้าเข้า + ออก</span><strong>{fmt(totalIn + totalOut)}</strong><small>ครั้ง</small></div>
        </div>

        <div className="tcc-monthly-scroll">
          <table>
            <thead><tr>
              <th>วันที่ข้อมูล</th>
              {statuses.map(([key, label]) => <th key={key}>{label}</th>)}
              <th>แจ้งเตือนใบหน้า</th><th>แจ้งเตือนรถ</th>
              <th>รถขาเข้า</th><th>รถขาออก</th><th>รวมรถ</th>
              <th>ใบหน้าเข้า</th><th>ใบหน้าออก</th><th>รวมใบหน้า</th>
            </tr></thead>
            <tbody>
              {dates.map(day => <tr key={day.date}>
                <td className="tcc-month-date">{displayDate(day.date)}</td>
                {statuses.map(([key]) => <td key={key}>
                  {pill(count(day.items, key), expected)}
                </td>)}
                <td className="tcc-month-alert-count">{day.hasAlert ? fmt(day.alertFace) : '—'}</td>
                <td className="tcc-month-alert-count">{day.hasAlert ? fmt(day.alertVehicle) : '—'}</td>
                <td>{day.hasVehicle ? fmt(day.vehicleIn) : '—'}</td>
                <td>{day.hasVehicle ? fmt(day.vehicleOut) : '—'}</td>
                <td className="tcc-month-total">{day.hasVehicle ? fmt(day.vehicleIn + day.vehicleOut) : '—'}</td>
                <td>{day.hasFace ? fmt(day.faceIn) : '—'}</td>
                <td>{day.hasFace ? fmt(day.faceOut) : '—'}</td>
                <td className="tcc-month-total">{day.hasFace ? fmt(day.faceIn + day.faceOut) : '—'}</td>
              </tr>)}
            </tbody>
            <tfoot><tr>
              <th colSpan={statuses.length + 1}>รวมทั้งเดือน</th>
              <th>{hasAnyAlert ? fmt(totalAlertFace) : '—'}</th>
              <th>{hasAnyAlert ? fmt(totalAlertVehicle) : '—'}</th>
              <th>{fmt(totalVehicleIn)}</th><th>{fmt(totalVehicleOut)}</th>
              <th>{fmt(totalVehicleIn + totalVehicleOut)}</th>
              <th>{fmt(totalIn)}</th><th>{fmt(totalOut)}</th>
              <th>{fmt(totalIn + totalOut)}</th>
            </tr></tfoot>
          </table>
        </div>
        <p className="tcc-history-note">
          เลือกเดือนตามวันที่ข้อมูลโดยตรง • ระบบเชื่อมรายงานที่ออกในวันถัดไปให้เอง •
          แจ้งเตือน Face ID/LPR อ่านจาก VSS05 โดยตรง • ไม่มีข้อมูลจะแสดง — ไม่ใช่ 0 • บันทึกแล้วแต่ยอดเป็น 0 ถือว่ามีข้อมูล
        </p>
        <h4>ตารางรวมจำนวนใบหน้าเข้า–ออก แยกตามศูนย์</h4>
        <div className="tcc-monthly-scroll">
          <table>
            <thead><tr>
              <th>ศูนย์</th><th>วันที่บันทึกข้อมูลใบหน้า</th>
              <th>ใบหน้าเข้า</th><th>ใบหน้าออก</th><th>รวม</th>
            </tr></thead>
            <tbody>
              {faceByCenter.map(center => <tr key={center.id}>
                <td className="tcc-month-name">{center.name}</td>
                <td>{center.saved} / {nDays} วัน</td>
                <td>{fmt(center.faceIn)}</td>
                <td>{fmt(center.faceOut)}</td>
                <td className="tcc-month-total">{fmt(center.faceIn + center.faceOut)}</td>
              </tr>)}
            </tbody>
            <tfoot><tr>
              <th colSpan={2}>รวม</th><th>{fmt(totalIn)}</th>
              <th>{fmt(totalOut)}</th><th>{fmt(totalIn + totalOut)}</th>
            </tr></tfoot>
          </table>
        </div>
      </>}
    </section>
  )
}
