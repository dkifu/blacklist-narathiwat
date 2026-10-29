
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './AgentMonitor.css'

const REFRESH_MS = 60_000
const PAGE_SIZE = 500

const STATUS_LABELS = {
  online: 'ออนไลน์',
  offline: 'ขาดการติดต่อ',
  never: 'ยังไม่เคยติดต่อ',
  revoked: 'เพิกถอนสิทธิ์',
  inactive: 'ไม่พร้อมใช้งาน',
}

function getDeviceStatus(device) {
  if (device.registration_status === 'revoked') {
    return 'revoked'
  }

  if (device.registration_status !== 'active') {
    return 'inactive'
  }

  if (!device.last_seen_at) {
    return 'never'
  }

  return device.is_online ? 'online' : 'offline'
}

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timeAgo(value) {
  if (!value) return 'ไม่เคยติดต่อ'

  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'ไม่ทราบเวลา'

  const minutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60000)
  )

  if (minutes < 1) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`

  return `${Math.floor(hours / 24)} วันที่แล้ว`
}

function StatusPill({ status }) {
  return (
    <span className={`am-status am-status--${status}`}>
      <span className="am-status-dot" />
      {STATUS_LABELS[status] || 'ไม่ทราบสถานะ'}
    </span>
  )
}

export default function AgentMonitor({ profile }) {
  const allowed = ['admin', 'supervisor'].includes(
    profile?.role
    )

  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [revision, setRevision] = useState(0)

  const [search, setSearch] = useState('')
  const [centerFilter, setCenterFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    if (!allowed) return

    let cancelled = false
    let running = false

    async function loadDevices() {
      if (running) return

      running = true
      setLoading(true)

      try {
        const allDevices = []

        // อ่านเป็นหน้า เพื่อไม่กำหนดเพดานจำนวน Agent
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { data, error: queryError } = await supabase
            .rpc('cctv_agent_monitor_list')
            .range(offset, offset + PAGE_SIZE - 1)

          if (queryError) throw queryError
          if (cancelled) return

          const batch = data || []
          allDevices.push(...batch)

          if (batch.length < PAGE_SIZE) break
        }

        if (!cancelled) {
          setDevices(allDevices)
          setLastRefresh(new Date().toISOString())
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message || 'โหลดข้อมูลสถานะ Agent ไม่สำเร็จ'
          )
        }
      } finally {
        running = false
        if (!cancelled) setLoading(false)
      }
    }

    loadDevices()

    const timer = setInterval(loadDevices, REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [allowed, revision])

  const centers = useMemo(() => {
    const map = new Map()

    for (const device of devices) {
      if (device.center_id == null) continue

      const id = String(device.center_id)
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: device.center_name || `ศูนย์ ${id}`,
        })
      }
    }

    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'th')
    )
  }, [devices])

  const stats = useMemo(() => {
    const counts = {
      total: devices.length,
      online: 0,
      offline: 0,
      inactive: 0,
    }

    for (const device of devices) {
      const status = getDeviceStatus(device)

      if (status === 'online') counts.online++
      else if (
        status === 'offline' ||
        status === 'never'
      ) counts.offline++
      else counts.inactive++
    }

    return counts
  }, [devices])

  const filteredDevices = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()

    const priority = {
      offline: 0,
      never: 1,
      inactive: 2,
      revoked: 3,
      online: 4,
    }

    return devices
      .filter(device => {
        const status = getDeviceStatus(device)

        if (
          centerFilter !== 'all' &&
          String(device.center_id) !== centerFilter
        ) return false

        if (
          statusFilter !== 'all' &&
          status !== statusFilter
        ) return false

        if (!keyword) return true

        const text = [
          device.device_name,
          device.center_name,
          device.agent_version,
          device.device_id,
        ].join(' ').toLocaleLowerCase()

        return text.includes(keyword)
      })
      .sort((a, b) => {
        const aStatus = getDeviceStatus(a)
        const bStatus = getDeviceStatus(b)

        return (
          priority[aStatus] - priority[bStatus] ||
          String(a.center_name || '').localeCompare(
            String(b.center_name || ''), 'th'
          ) ||
          String(a.device_name || '').localeCompare(
            String(b.device_name || ''), 'th'
          )
        )
      })
  }, [devices, centerFilter, statusFilter, search])

  if (!allowed) {
    return (
      <div className="agent-monitor">
        <div className="am-empty">
          บัญชีนี้ไม่มีสิทธิ์ดูสถานะเครื่อง Agent
        </div>
      </div>
    )
  }

  const summaryCards = [
    {
      key: 'total',
      label: 'เครื่องที่ลงทะเบียน',
      value: stats.total,
      icon: '▣',
      tone: 'blue',
    },
    {
      key: 'online',
      label: 'ออนไลน์',
      value: stats.online,
      icon: '●',
      tone: 'green',
    },
    {
      key: 'offline',
      label: 'ขาดการติดต่อ / ไม่เคยติดต่อ',
      value: stats.offline,
      icon: '◷',
      tone: 'orange',
    },
    {
      key: 'inactive',
      label: 'ไม่พร้อมใช้งาน / เพิกถอน',
      value: stats.inactive,
      icon: '⊘',
      tone: 'red',
    },
  ]

  return (
    <div className="agent-monitor">

      <header className="am-header">
        <div>
          <div className="am-eyebrow">
            SYSTEM MONITORING / CCTV PING AGENT
          </div>

          <h2>สถานะเครื่อง Ping Agent</h2>

          <p>
            ตรวจสอบการเชื่อมต่อของเครื่องที่ลงทะเบียน
            และติดตั้ง CCTV Ping Agent
          </p>
        </div>

        <button
          type="button"
          className="am-refresh"
          onClick={() => setRevision(v => v + 1)}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
          {loading ? 'กำลังตรวจสอบ...' : 'รีเฟรชข้อมูล'}
        </button>
      </header>

      <section className="am-summary">
        {summaryCards.map(card => (
          <div
            key={card.key}
            className={`am-summary-card am-tone-${card.tone}`}
          >
            <div className="am-summary-top">
              <span>{card.label}</span>
              <span className="am-summary-icon">
                {card.icon}
              </span>
            </div>

            <strong>
              {stats.total === 0 && loading
                ? '—'
                : card.value.toLocaleString('th-TH')}
            </strong>
          </div>
        ))}
      </section>

      <section className="am-list-panel">
        <div className="am-list-heading">
          <div>
            <h3>รายการเครื่อง Agent</h3>
            <p>
              ข้อมูลจาก Supabase ·
              รีเฟรชอัตโนมัติทุก 60 วินาที
            </p>
          </div>

          <span className="am-result-count">
            {filteredDevices.length.toLocaleString('th-TH')} เครื่อง
          </span>
        </div>

        <div className="am-filters">
          <label className="am-search">
            <span>ค้นหาเครื่อง</span>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ชื่อเครื่อง / รหัสเครื่อง / ศูนย์"
            />
          </label>

          <label>
            <span>ศูนย์</span>
            <select
              value={centerFilter}
              onChange={e => setCenterFilter(e.target.value)}
            >
              <option value="all">ทุกศูนย์ที่มีสิทธิ์ดู</option>
              {centers.map(center => (
                <option key={center.id} value={center.id}>
                  {center.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>สถานะ</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="all">ทุกสถานะ</option>
              <option value="online">ออนไลน์</option>
              <option value="offline">ขาดการติดต่อ</option>
              <option value="never">ยังไม่เคยติดต่อ</option>
              <option value="revoked">เพิกถอนสิทธิ์</option>
              <option value="inactive">ไม่พร้อมใช้งาน</option>
            </select>
          </label>
        </div>

        {error && (
          <div className="am-error" role="alert">
            อ่านข้อมูลไม่สำเร็จ: {error}
          </div>
        )}

        <div className="am-table-scroll">
          <table className="am-table">
            <thead>
              <tr>
                <th>เครื่องที่ติดตั้ง Agent</th>
                <th>ศูนย์</th>
                <th>เวอร์ชัน</th>
                <th>สถานะ</th>
                <th>ติดต่อเซิร์ฟเวอร์ล่าสุด</th>
                <th>ลงทะเบียนเมื่อ</th>
              </tr>
            </thead>

            <tbody>
              {filteredDevices.map(device => {
                const status = getDeviceStatus(device)

                return (
                  <tr key={device.device_id}>
                    <td>
                      <div className="am-device">
                        <span className="am-device-icon">
                          ▣
                        </span>

                        <div>
                          <strong>
                            {device.device_name}
                          </strong>
                          <small>
                            ID: {String(device.device_id).slice(0, 8)}
                          </small>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className="am-center">
                        {device.center_name || '—'}
                      </span>
                    </td>

                    <td>
                      <span className="am-version">
                        {device.agent_version || '—'}
                      </span>
                    </td>

                    <td>
                      <StatusPill status={status} />
                    </td>

                    <td>
                      <div className="am-time">
                        <strong>
                          {timeAgo(device.last_seen_at)}
                        </strong>
                        <small>
                          {formatDate(device.last_seen_at)}
                        </small>
                      </div>
                    </td>

                    <td>
                      <span className="am-registered">
                        {formatDate(device.registered_at)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!loading && !error && filteredDevices.length === 0 && (
          <div className="am-empty">
            {devices.length === 0
              ? 'ยังไม่มีเครื่อง Agent ที่ลงทะเบียนในศูนย์ที่มีสิทธิ์ดู'
              : 'ไม่พบเครื่อง Agent ที่ตรงกับเงื่อนไขค้นหา'}
          </div>
        )}

        <footer className="am-footer">
          <span>
            <span className="am-live-dot" />
            {loading ? 'กำลังปรับปรุงข้อมูล' : 'พร้อมตรวจสอบ'}
          </span>

          <span>
            อัปเดตข้อมูลล่าสุด: {formatDate(lastRefresh)}
          </span>
        </footer>
      </section>

      <p className="am-note">
        สถานะออนไลน์อ้างอิง Heartbeat ที่เซิร์ฟเวอร์ได้รับ
        ภายใน 3 นาทีล่าสุด ไม่ใช่การ Ping เครื่องโดยตรง
        เครื่องที่เพิ่งหยุดทำงานอาจยังปรากฏว่าออนไลน์
        จนกว่าจะพ้นช่วงเวลาดังกล่าว
      </p>
    </div>
  )
}
