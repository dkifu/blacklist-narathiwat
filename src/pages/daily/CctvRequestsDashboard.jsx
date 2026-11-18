// CCTV_REQUESTS_MANUAL_CASE_V4
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import './CctvRequests.css'

const names = {1:'นราธิวาส',2:'ปัตตานี',4:'หาดใหญ่',7:'ตากใบ',8:'สุไหง-โกลก',9:'เบตง'}
const shifts = { morning:'กะเช้า',afternoon:'กะบ่าย',night:'กะดึก' }
const today = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})
const label = c => c.case_reference ||
  `CR-${String(c.case_number).padStart(6,'0')}` // legacy fallback
export default function CctvRequestsDashboard({profile,shift}) {
  const [date,setDate] = useState(today)
  const [summary,setSummary] = useState(null)
  const [rows,setRows] = useState([])
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(false)
  const [refresh,setRefresh] = useState(0)
  const manager = ['admin','supervisor'].includes(profile?.role)
  const central = profile?.role==='center' && Number(profile?.center_id)===10
  const load = useCallback(async () => {
    setLoading(true);setError('')
    try {
      const {data:sum,error:sumError} = await supabase.rpc('cctv_request_daily_summary',{
        p_report_date:date,p_shift:shift,
      })
      if(sumError)throw sumError
      setSummary(sum)
      if(central){setRows([]);return}
      let q = supabase.from('cctv_request_cases')
        .select('id,case_number,case_reference,center_id,report_date,shift,alarm_source,event_type_code,operator_name,camera_name,camera_ip,status,submitted_at')
        .eq('report_date',date).eq('shift',shift).order('submitted_at',{ascending:false}).limit(500)
      if(!manager)q=q.eq('center_id',Number(profile?.center_id))
      const {data,error:listError}=await q
      if(listError)throw listError
      setRows((data||[]).filter(c=>c.status==='submitted'))
    }catch(e){setError(e?.message||String(e));setSummary(null);setRows([])}
    finally{setLoading(false)}
  },[date,shift,central,manager,profile?.center_id])
  useEffect(()=>{load()},[load,refresh])
  const exportExcel=()=>{
    const wb=XLSX.utils.book_new()
    const data=[['เลขเคส','ศูนย์','วันที่รายงาน','กะ','ประเภทเหตุ','ที่มา Alarm','กล้อง','IP','Operator','วันเวลาส่ง'],
      ...rows.map(c=>[label(c),names[c.center_id]||c.center_id,c.report_date,shifts[c.shift],c.event_type_code||'',c.alarm_source||'',c.camera_name||'',c.camera_ip||'',c.operator_name||'',c.submitted_at||''])]
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),'รายงานชั่วโมงที่ 8')
    XLSX.writeFile(wb,`CCTV_REQUESTS_HOUR08_${date}_${shift}.xlsx`)
  }
  return <div className="cr-wrap">
    <div className="cr-toolbar"><div><h2>HOUR 08 · สรุปส่งงาน CCTV REQUESTS</h2><p>{shifts[shift]} · สรุปข้อมูลที่เจ้าหน้าที่ส่งแล้วจากหน้า CCTV REQUESTS</p></div></div>
    <div className="cr-panel cr-filters"><label className="cr-field"><span>วันที่รายงาน</span><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <button className="cr-btn" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16}/> รีเฟรช</button>
      {!central&&<button className="cr-btn" disabled={!rows.length} onClick={exportExcel}><FileSpreadsheet size={16}/> Excel</button>}
    </div>
    {error&&<div className="cr-error">{error}</div>}
    {summary&&<>
      <div className="cr-metrics"><div><span>เคสทั้งหมด</span><strong>{summary.total??0}</strong></div><div><span>ส่งแล้ว</span><strong>{summary.submitted??0}</strong></div>
        <div><span>เคส LPR ที่ส่ง</span><strong>{summary.lpr??0}</strong></div><div><span>ใบคำร้องที่ส่ง</span><strong>{summary.requests??0}</strong></div></div>
      {central&&<div className="cr-panel"><p className="cr-muted">แสดงยอดรวม 6 ศูนย์เท่านั้น ตามสิทธิ์บัญชี ศชต. ไม่มีรายละเอียดแยกศูนย์หรือรายเคส</p></div>}
      {manager&&Array.isArray(summary.centers)&&<div className="cr-panel"><h3>ยอดส่งงานแยกศูนย์</h3><div className="cr-metrics">{summary.centers.map(c=><div key={c.center_id}><span>{names[c.center_id]||c.center_id}</span><strong>{c.submitted} / {c.total}</strong></div>)}</div></div>}
      {!central&&<div className="cr-panel cr-table-wrap"><h3>รายการที่ส่งแล้ว</h3><table className="cr-table"><thead><tr><th>เลขเคส</th><th>ศูนย์</th><th>ประเภท</th><th>IP</th><th>Operator</th><th>ส่งเมื่อ</th></tr></thead>
        <tbody>{rows.map(c=><tr key={c.id}><td>{label(c)}</td><td>{names[c.center_id]||c.center_id}</td><td>{c.alarm_source||'-'}</td><td>{c.camera_ip||'-'}</td><td>{c.operator_name||'-'}</td><td>{c.submitted_at?new Date(c.submitted_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'-'}</td></tr>)}
          {!rows.length&&<tr><td colSpan="6" className="cr-empty">ยังไม่มีเคสที่ส่งในวันที่และกะนี้</td></tr>}</tbody></table></div>}
    </>}
  </div>
}
