// CCTV_REQUESTS_LPR_MONTHLY_V1: multi-hit LPR report (same plate/center/event month).
import { useEffect, useMemo, useState } from 'react'
import { FileImage, RefreshCw } from 'lucide-react'

const SLOT_FIELDS = [
  { key: 'plate', label: 'ภาพป้ายทะเบียน', pathKey: 'plate_image_path' },
  { key: 'face', label: 'ภาพกล้อง FACE', pathKey: 'face_image_path' },
  { key: 'overview', label: 'ภาพกล้อง Overview', pathKey: 'overview_image_path' },
]

const formatDate = value => {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? String(value) :
    date.toLocaleDateString('th-TH-u-ca-buddhist', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
const formatTime = value => value ? `${String(value).slice(0, 5)} น.` : '-'
const monthName = value => {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return '-'
  const d = new Date(`${value}-01T12:00:00`)
  return d.toLocaleDateString('th-TH-u-ca-buddhist', { month: 'long', year: 'numeric' })
}

export default function CctvLprMonthlyReport({
  supabase, bucket, active, caseFiles, evidenceThumbs, selections, setSelections,
  reportRef, onGenerate, canGenerate, readOnly, busy, refreshKey, centerNames,
}) {
  const [report, setReport] = useState(null)
  const [imageUrls, setImageUrls] = useState({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [manualRefresh, setManualRefresh] = useState(0)
  const caseId = active?.id || null

  useEffect(() => {
    let cancelled = false
    const urls = []
    setReport(null)
    setImageUrls({})
    setLoadError('')
    if (!caseId) { setLoading(false); return () => {} }
    setLoading(true)
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('cctv_request_lpr_monthly', {
          p_case_id: caseId,
        })
        if (error) throw error
        if (cancelled) return
        setReport(data)
        const paths = [...new Set((data?.events || []).flatMap(event =>
          SLOT_FIELDS.map(slot => event[slot.pathKey]).filter(Boolean)
        ))]
        // Small batches: avoid flooding private Storage with dozens of concurrent downloads.
        for (let i = 0; i < paths.length && !cancelled; i += 4) {
          await Promise.all(paths.slice(i, i + 4).map(async path => {
            try {
              const { data: blob, error: downloadError } = await supabase.storage
                .from(bucket).download(path)
              if (downloadError || !blob || cancelled) return
              const url = URL.createObjectURL(blob)
              if (cancelled) { URL.revokeObjectURL(url); return }
              urls.push(url)
              setImageUrls(prev => ({ ...prev, [path]: url }))
            } catch { /* Keep placeholder for missing/inaccessible evidence. */ }
          }))
        }
      } catch (error) {
        if (!cancelled) setLoadError(error?.message || String(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [caseId, refreshKey, manualRefresh, supabase, bucket])

  const events = useMemo(() => report?.events || [], [report])
  const alertCount = Math.max(5, events.length)
  const photoFiles = caseFiles.filter(f => f.file_type === 'image')
  const selectedIds = SLOT_FIELDS.map(slot => selections[slot.key]).filter(Boolean)
  const isUnique = new Set(selectedIds).size === selectedIds.length
  const allThree = SLOT_FIELDS.every(slot => Boolean(selections[slot.key])) && isUnique
  const plateText = report
    ? `${report.plate_letters || ''} ${report.plate_number || ''} ${report.plate_province || ''}`.trim()
    : 'รอบันทึกข้อมูลทะเบียน'

  const rows = [
    ['ทะเบียนรถ', plateText],
    ['ประเภท', 'LPR'],
    ['หมวดหมายจับ', '—'],
    ['รหัสติดตาม', '—'],
    ['รายละเอียดรถ', '—'],
    ['ชื่อเป้าหมาย', '—'],
  ]
  const actionRows = [
    'จัดทำรายงานหมายจับตามแบบฟอร์มที่กำหนด',
    'ส่งรายงานตามที่ระบุใน Action Plan',
    'จัดเรียงข้อมูลและภาพประกอบ',
  ]
  const getImage = (event, slot) => {
    const path = event[slot.pathKey]
    return path ? imageUrls[path] : null
  }

  return (
    <div className="cr-panel cr-lpr-monthly-panel">
      <div className="cr-section-head">
        <h3>4. รายงานภาพ LPR พิเศษ (สะสมรายเดือน)</h3>
        <div className="cr-actions">
          <button type="button" className="cr-btn" disabled={!caseId || loading}
            onClick={() => setManualRefresh(v => v + 1)}>
            <RefreshCw size={15} /> รีเฟรชประวัติ
          </button>
          {!readOnly && (
            <button type="button" className="cr-btn cr-primary"
              disabled={!caseId || !canGenerate || !allThree || Boolean(busy) || loading}
              onClick={onGenerate}>
              <FileImage size={16} /> สร้างภาพและแนบเคส
            </button>
          )}
        </div>
      </div>
      <p className="cr-muted">
        1 เคส = การตรวจพบ 1 ครั้ง · เลือกภาพทะเบียน, FACE และ Overview ของเคสนี้อย่างละภาพ
        แล้วกดบันทึกแบบร่าง รายงานจะรวมรถทะเบียนเดียวกันของศูนย์เดียวกันในเดือนที่เกิดเหตุโดยอัตโนมัติ
      </p>
      <div className="cr-lpr-pickers">
        {SLOT_FIELDS.map(slot => (
          <label key={slot.key} className="cr-lpr-picker">
            <strong>{slot.label}</strong>
            <select disabled={readOnly || !caseId} value={selections[slot.key] || ''}
              onChange={e => setSelections(prev => ({ ...prev, [slot.key]: e.target.value }))}>
              <option value="">เลือกภาพหลักฐาน</option>
              {photoFiles.map(f => <option key={f.id} value={f.id}>{f.file_name}</option>)}
            </select>
            <div className="cr-lpr-picker-thumb">
              {evidenceThumbs?.[selections[slot.key]]
                ? <img src={evidenceThumbs[selections[slot.key]]} alt={slot.label} />
                : <span>ยังไม่ได้เลือกภาพ</span>}
            </div>
          </label>
        ))}
      </div>
      {!isUnique && <p className="cr-error">กรุณาเลือกภาพคนละไฟล์ให้ครบทั้ง 3 ช่อง</p>}
      {!canGenerate && caseId && !readOnly && (
        <p className="cr-muted">หลังเลือกภาพให้กด “บันทึกแบบร่าง” ก่อน จึงจะสร้างภาพรายงานได้</p>
      )}
      {loadError && <p className="cr-error">โหลดประวัติ LPR ไม่สำเร็จ: {loadError}</p>}
      {loading && <p className="cr-muted">กำลังโหลดประวัติและภาพหลักฐานในเดือนนี้...</p>}
      <div className="cr-lpr-monthly-scroll">
        <div className="cr-lpr-monthly-sheet" ref={reportRef}>
          <header className="cr-lpr-m-report-head">
            <strong>รายงานเฝ้าระวังรถ LPR</strong>
            <span>ศูนย์ {centerNames[report?.center_id] || '-'} · ประจำเดือน {monthName(report?.month)}</span>
            <b>รวมแจ้งเตือนทั้งเดือน: {events.length} ครั้ง</b>
          </header>
          <table className="cr-lpr-m-table cr-lpr-m-verify">
            <thead>
              <tr><th colSpan={2}>ตรวจสอบความถูกต้อง</th>
                {Array.from({ length: alertCount }, (_, i) => <th key={i}>Alert {i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, value]) => <tr key={name}>
                <th>{name}</th><td>{value}</td>
                {Array.from({ length: alertCount }, (_, i) => <td key={i} className="cr-lpr-m-pending">
                  {events[i] ? 'รอตรวจสอบ' : '—'}
                </td>)}
              </tr>)}
              <tr className="cr-lpr-m-blue"><th colSpan={2}>Action Plan</th>
                {Array.from({ length: alertCount }, (_, i) => <td key={i}></td>)}
              </tr>
              {actionRows.map(name => <tr key={name}>
                <th colSpan={2}>{name}</th>
                {Array.from({ length: alertCount }, (_, i) => <td key={i}>—</td>)}
              </tr>)}
            </tbody>
          </table>
          <div className="cr-lpr-m-history-label">ประวัติการตรวจพบ</div>
          <table className="cr-lpr-m-table cr-lpr-m-history">
            <thead>
              <tr>
                <th rowSpan={2}>ที่</th><th rowSpan={2}>วัน เดือน ปี</th>
                <th rowSpan={2}>เวลา</th><th rowSpan={2}>สถานที่ / กล้อง</th>
                <th rowSpan={2}>ศูนย์</th><th colSpan={3}>ภาพจากระบบ</th>
                <th rowSpan={2}>จนท.ผู้ตรวจพบ</th>
              </tr>
              <tr><th>ภาพป้ายทะเบียน</th><th>ภาพจากกล้อง FACE</th><th>ภาพจากกล้อง Overview</th></tr>
            </thead>
            <tbody>
              {events.length === 0 ? <tr><td colSpan={9}>ยังไม่มีประวัติ LPR — กรุณาบันทึกแบบร่างก่อน</td></tr>
                : events.map((event, i) => <tr key={event.case_id}>
                  <td>{i + 1}</td>
                  <td>{formatDate(event.event_date)}</td>
                  <td>{formatTime(event.event_time)}</td>
                  <td>{event.camera_name || event.camera_ip || '-'}</td>
                  <td>{centerNames[event.center_id] || '-'}</td>
                  {SLOT_FIELDS.map(slot => <td key={slot.key} className="cr-lpr-m-image-cell">
                    {getImage(event, slot)
                      ? <img src={getImage(event, slot)} alt={`${slot.label} Alert ${i + 1}`} />
                      : <span>ไม่มีภาพ</span>}
                  </td>)}
                  <td>{event.operator_name || '-'}</td>
                </tr>)}
            </tbody>
          </table>
          {events.length > 0 && <div className="cr-lpr-m-timeline">
            {events.map((event, i) => <div key={event.case_id} className="cr-lpr-m-timeline-item">
              {i > 0 && <span className="cr-lpr-m-arrow">→</span>}
              <div><strong>{formatDate(event.event_date)} · {formatTime(event.event_time)}</strong>
                <span>{event.camera_name || event.camera_ip || '-'}</span>
                <small>เคส {event.case_reference || '-'}</small>
              </div>
            </div>)}
          </div>}
        </div>
      </div>
      <p className="cr-muted">
        ช่องตรวจสอบและ Action Plan ยังไม่บันทึกสถานะในเวอร์ชันนี้ จึงแสดง “รอตรวจสอบ” ไม่ยืนยันข้อมูลแทนเจ้าหน้าที่
      </p>
    </div>
  )
}
