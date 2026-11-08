# -*- coding: utf-8 -*-
"""V3: รองรับ Template HTML ทั้งเวอร์ชันเดิมและเวอร์ชันที่ผูกฐานข้อมูล — เพิ่มแท็บรายงานชั่วคราวให้หน้า AlertReport โดยแก้เฉพาะไฟล์เดิม 3 ไฟล์

การใช้งาน: เปิด CMD ในโฟลเดอร์ Blacklist_Narathiwat แล้วสั่ง
    py PATCH_VSS05_TEMP_TAB_V3.py

ไม่ติดตั้ง package เพิ่ม / ไม่แตะฐานข้อมูล / สำรองไฟล์เดิมก่อนแก้
"""
from __future__ import annotations

import os
from pathlib import Path

MARK = 'VSS05_TEMP_TAB_20261108'
VERSION = 'V3'


class PatchError(Exception):
    pass


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    # สำรอง: ถ้ารูปแบบเว้นวรรค / ย่อหน้าในไฟล์จริงต่างจากต้นแบบ
    # ให้ยอมรับเฉพาะจุดที่ยังเป็นข้อความและโครงสร้างเดียวกันแบบไม่กำกวม
    import re
    tokens = re.split(r'(\s+)', old)
    pattern = ''.join(r'\s+' if token.isspace() else re.escape(token)
                      for token in tokens if token)
    matches = list(re.finditer(pattern, text))
    if len(matches) == 1:
        return text[:matches[0].start()] + new + text[matches[0].end():]
    raise PatchError(f'{label}: ต้องพบจุดแก้ 1 จุด แต่พบ {count} จุด (ตรวจเว้นวรรคแล้วพบ {len(matches)}) — ไม่แก้ไฟล์เพื่อความปลอดภัย')


def patch_jsx(src: str) -> str:
    if MARK in src:
        return src

    src = replace_once(
        src,
        '  const fileInputRef = useRef(null)',
        "  // VSS05_TEMP_TAB_20261108 — แยกข้อมูลจริงกับแบบฟอร์มชั่วคราว\n"
        "  const [activeReportTab, setActiveReportTab] = useState('official')\n\n"
        '  const fileInputRef = useRef(null)',
        'AlertReport.jsx: สถานะแท็บ'
    )

    src = replace_once(
        src,
        '    <div className="alert-report-page">',
        '''    <div className="alert-report-page">

      {/* VSS05_TEMP_TAB_20261108: เมนูสลับโหมดภายในหน้าเดิม */}
      <div className="vss05-report-tabs" role="tablist" aria-label="เลือกโหมดรายงาน">
        <button
          type="button"
          role="tab"
          aria-selected={activeReportTab === 'official'}
          className={activeReportTab === 'official' ? 'active' : ''}
          onClick={() => setActiveReportTab('official')}
        >
          รายงานประจำวัน (บันทึกข้อมูล)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeReportTab === 'temporary'}
          className={activeReportTab === 'temporary' ? 'active' : ''}
          onClick={() => setActiveReportTab('temporary')}
        >
          รายงานชั่วคราว (สภ. / ไม่บันทึก)
        </button>
      </div>

      {/* คง iframe เดิมไว้ แม้ซ่อนแท็บ เพื่อไม่ให้ข้อมูลที่กำลังกรอกหาย */}
      <div style={{ display: activeReportTab === 'official' ? 'block' : 'none' }}>''',
        'AlertReport.jsx: ตำแหน่งแท็บ'
    )

    old_tail = '''      <iframe
        ref={reportFrameRef}
        className="alert-report-frame"
        src={reportUrl}
        title="VSS05 รายงานการแจ้งเตือน"
      />

    </div>'''
    new_tail = '''      <iframe
        ref={reportFrameRef}
        className="alert-report-frame"
        src={reportUrl}
        title="VSS05 รายงานการแจ้งเตือน"
      />

      </div>

      {/* โหมดชั่วคราวใช้ไฟล์ HTML ตัวเดิม แต่เปิดด้วย query mode=temp */}
      <div style={{ display: activeReportTab === 'temporary' ? 'block' : 'none' }}>
        <div className="vss05-temp-notice" role="status">
          <strong>แบบฟอร์มชั่วคราวสำหรับ สภ.</strong>
          <span>แก้ไขข้อมูลและคัดลอกรูปเพื่อส่งต่อได้ทันที ไม่มีการบันทึกลงฐานข้อมูลหรือเก็บแบบร่างในเครื่อง รีเฟรชหน้าแล้วข้อมูลจะหาย</span>
        </div>
        <iframe
          className="alert-report-frame"
          src={`${reportUrl}?mode=temp`}
          title="รายงานชั่วคราวสำหรับ สภ. — ไม่บันทึกข้อมูล"
        />
      </div>

    </div>'''
    src = replace_once(src, old_tail, new_tail, 'AlertReport.jsx: iframe เดิม')
    return src


def patch_css(src: str) -> str:
    if MARK in src:
        return src
    return src.rstrip() + '''

/* VSS05_TEMP_TAB_20261108 — แท็บรายงานจริง / ชั่วคราว */
.vss05-report-tabs {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  border-bottom: 1px solid #2d3d56;
  padding-bottom: 10px;
}
.vss05-report-tabs button {
  appearance: none;
  border: 1px solid #35445d;
  border-radius: 9px;
  background: #121e2e;
  color: #a9b9d0;
  padding: 11px 17px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.vss05-report-tabs button:hover { border-color: #6884aa; color: #fff; }
.vss05-report-tabs button.active {
  background: #1e4f9e;
  color: #fff;
  border-color: #407dde;
}
.vss05-temp-notice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  border: 1px solid #71612b;
  border-radius: 10px;
  padding: 12px 15px;
  background: #292512;
  color: #e9e2be;
  font-size: 12px;
  line-height: 1.6;
}
.vss05-temp-notice strong { color: #fff3b8; font-size: 14px; }
@media (max-width: 700px) {
  .vss05-report-tabs { display: grid; grid-template-columns: 1fr; }
  .vss05-report-tabs button { width: 100%; }
}
'''


def optional_replace_once(src: str, old: str, new: str, label: str, *, required=False):
    # แก้เมื่อจุดนั้นมีจริง 1 จุดเท่านั้น; อนุญาตไม่มีจุดนี้ในอีกเวอร์ชัน
    count = src.count(old)
    if count == 1:
        return src.replace(old, new, 1)
    if count > 1:
        raise PatchError(f'{label}: จุดแก้ซ้ำ {count} จุด — ไม่ดำเนินการ')
    if required:
        raise PatchError(f'{label}: ไม่พบตำแหน่งที่จำเป็น — ไม่ดำเนินการ')
    return src


def patch_html(src: str) -> str:
    if MARK in src:
        return src

    # รองรับ Template HTML ได้ 2 สาย: 1) HTML เดิม (ไม่มี daily persistence)
    # 2) HTML ที่เพิ่ม VSS05_DAILY_SAVE/LOAD และล็อกปุ่มคัดลอก
    has_daily = 'function vss05CanExport()' in src
    has_daily_save = 'function vss05SaveDaily()' in src
    if has_daily != has_daily_save:
        raise PatchError('HTML มีส่วนบันทึกรายวันไม่ครบชุด กรุณาตรวจสอบต้นฉบับก่อน Patch')
    if src.count('function buildForm(){') != 1 or src.count('function initForm(){') != 1:
        raise PatchError('HTML ไม่มีฟอร์มมาตรฐานที่รองรับ — ไม่แก้ไข')
    if src.count("$('btnCopy').onclick") != 1 or src.count('function saveDraft(){') != 1:
        raise PatchError('HTML ไม่มีปุ่มคัดลอกรูปหรือระบบ draft มาตรฐาน — ไม่แก้ไข')

    src = replace_once(src, '</style>', '''/* VSS05_TEMP_TAB_20261108 — ซ่อนปุ่มบันทึกในโหมดชั่วคราว */
html[data-temp-mode="true"] #btnSaveDaily,
html[data-temp-mode="true"] #btnSave,
html[data-temp-mode="true"] .hint { display: none !important; }
html[data-temp-mode="true"] #vss05DailyStatus {
  background:#fff6d6; border-color:#b68a28; color:#624300;
}
</style>''', 'Template HTML: CSS')

    src = replace_once(src, 'const countEvents =', '''// VSS05_TEMP_TAB_20261108 — โหมดรายงานชั่วคราว เก็บเฉพาะในหน่วยความจำ
const TEMP_MODE = new URLSearchParams(window.location.search).get('mode') === 'temp';
document.documentElement.setAttribute('data-temp-mode', String(TEMP_MODE));
// ไม่รับข้อความจาก Parent ใน iframe ชั่วคราว (ป้องกันโหลดหรือบันทึกข้อมูลจริง)
if (TEMP_MODE) {
  window.addEventListener('message', event => event.stopImmediatePropagation(), true);
}
const countEvents =''', 'Template HTML: ประกาศโหมด')

    # ข้อมูลชั่วคราวต้องไม่อ่าน/เขียน localStorage แม้แต่โลโก้/คำแนะนำ/หัวรายงาน
    replaces = [
        ("try{ storedLogo=localStorage.getItem('pe_logo'); }catch(e){}",
         "if(!TEMP_MODE) try{ storedLogo=localStorage.getItem('pe_logo'); }catch(e){}", 'ไม่โหลดโลโก้ซ้าย'),
        ("try{ localStorage.setItem('pe_logo',url); }catch(err){}",
         "if(!TEMP_MODE) try{ localStorage.setItem('pe_logo',url); }catch(err){}", 'ไม่เก็บโลโก้ซ้าย'),
        ("try{ storedLogoR=localStorage.getItem('pe_logo_r'); }catch(e){}",
         "if(!TEMP_MODE) try{ storedLogoR=localStorage.getItem('pe_logo_r'); }catch(e){}", 'ไม่โหลดโลโก้ขวา'),
        ("try{ localStorage.setItem('pe_logo_r',url); }catch(err){}",
         "if(!TEMP_MODE) try{ localStorage.setItem('pe_logo_r',url); }catch(err){}", 'ไม่เก็บโลโก้ขวา'),
        ("try{ const h=JSON.parse(localStorage.getItem('pe_hist')||'null'); if(h) HIST=Object.assign(HIST,h); }catch(e){}",
         "if(!TEMP_MODE) try{ const h=JSON.parse(localStorage.getItem('pe_hist')||'null'); if(h) HIST=Object.assign(HIST,h); }catch(e){}", 'ไม่อ่านประวัติคำแนะนำ'),
        ("try{ localStorage.setItem('pe_hist',JSON.stringify(HIST)); }catch(e){}",
         "if(!TEMP_MODE) try{ localStorage.setItem('pe_hist',JSON.stringify(HIST)); }catch(e){}", 'ไม่บันทึกประวัติคำแนะนำ'),
        ('function saveDraft(){', 'function saveDraft(){\n  if(TEMP_MODE) return;', 'ไม่บันทึก Draft'),
        ('function loadDraft(){', 'function loadDraft(){\n  if(TEMP_MODE) return null;', 'ไม่อ่าน Draft'),
        ("try{ const t=JSON.parse(localStorage.getItem('pe_title')||'null'); if(t) TITLE=Object.assign(TITLE,t); }catch(e){}",
         "if(!TEMP_MODE) try{ const t=JSON.parse(localStorage.getItem('pe_title')||'null'); if(t) TITLE=Object.assign(TITLE,t); }catch(e){}", 'ไม่โหลดหัวรายงาน'),
        ('function saveTitle(){', 'function saveTitle(){\n  if(TEMP_MODE) return;', 'ไม่เก็บหัวรายงาน'),
        ("try{ if(localStorage.getItem('pe_theme')==='dark') theme='dark'; }catch(e){}",
         "if(!TEMP_MODE) try{ if(localStorage.getItem('pe_theme')==='dark') theme='dark'; }catch(e){}", 'ไม่อ่านธีม'),
        ("try{ localStorage.setItem('pe_theme',theme); }catch(e){}",
         "if(!TEMP_MODE) try{ localStorage.setItem('pe_theme',theme); }catch(e){}", 'ไม่เก็บธีม'),
    ]
    for old,new,label in replaces:
        src = replace_once(src, old, new, 'Template HTML: '+label)

    # ครอบ 'remember' โดยไม่ต้องแก้โค้ดทั้งฟังก์ชัน (ต่างเวอร์ชันได้)
    src = replace_once(src, 'function remember(id,val){',
        'function remember(id,val){\n  if(TEMP_MODE) return;', 'Template HTML: ไม่เก็บคำแนะนำ')

    # วันที่รายงาน: ทั้งแบบเดิมและใหม่มี handler นี้ แต่ logic ข้างในต่างกัน
    # แทรกเฉพาะ early-return จึงไม่เปิด DB refresh ในโหมดชั่วคราว
    src = replace_once(src, "rd.addEventListener('change', () => {", '''rd.addEventListener('change', () => {
  if(TEMP_MODE) {
    const nextDate = rd.value;
    if(!nextDate) { rd.value = S.reportDate; return; }
    S.reportDate = nextDate;
    const yesterday = addDays(nextDate, -1);
    S.start = {d:yesterday, t:'00:00'};
    S.end = {d:yesterday, t:'23:59'};
    rebuild();
    return;
  }''', 'Template HTML: เปลี่ยนวันรายงานชั่วคราว')

    # HTML รุ่นใหม่ล็อกช่วงวันที่ไว้ แต่รุ่นเดิมไม่ได้ล็อก (ปล่อยรุ่นเดิมตามเดิม)
    if has_daily:
        src = replace_once(src, 'if(el!==rd) el.disabled=true;',
            'if(!TEMP_MODE && el!==rd) el.disabled=true;', 'Template HTML: ปลดล็อกช่วงวันเวลา')
        src = replace_once(src, 'if(S.reportDate && (S.start.d!==addDays(S.reportDate,-1)',
            'if(!TEMP_MODE && S.reportDate && (S.start.d!==addDays(S.reportDate,-1)',
            'Template HTML: ข้ามกฎช่วงวันที่รายงานจริง')

    src = optional_replace_once(src,
        "text:'ข้อความ 3 บรรทัดด้านบนของรูป แก้ได้ตามงาน ระบบจำค่าไว้ในเครื่องนี้'",
        "text:TEMP_MODE ? 'แก้หัวรายงานได้ชั่วคราว ไม่บันทึกข้อมูล' : 'ข้อความ 3 บรรทัดด้านบนของรูป แก้ได้ตามงาน ระบบจำค่าไว้ในเครื่องนี้'",
        'Template HTML: คำอธิบาย')

    # ตอนเริ่มฟอร์ม: รุ่นเก่าโหลด draft จากเครื่อง; temp ต้อง newState() เท่านั้น
    src = optional_replace_once(src,
        'S=loadDraft()||newState();',
        'S=TEMP_MODE ? newState() : (loadDraft()||newState());',
        'Template HTML: ไม่โหลดแบบร่างของงานจริง')

    # ปุ่มคัดลอกรูป ใช้ข้อมูล Canvas ล่าสุด; รุ่นใหม่มีการบังคับ save ก่อน
    if has_daily:
        src = replace_once(src, 'function vss05CanExport() {',
            'function vss05CanExport() {\n  if(TEMP_MODE) return true;', 'Template HTML: คัดลอกโดยไม่ Save')
        src = replace_once(src, 'function vss05SetUi(message) {', '''function vss05SetUi(message) {
  if(TEMP_MODE) {
    const status = $('vss05DailyStatus');
    if(status) status.textContent = 'รายงานชั่วคราว • คัดลอกรูปได้ทันที • ไม่บันทึกข้อมูล';
    const btnSaveDaily = $('btnSaveDaily');
    if(btnSaveDaily) {btnSaveDaily.disabled = true; btnSaveDaily.hidden = true;}
    const btnSave = $('btnSave');
    if(btnSave) btnSave.disabled = true;
    const btnCopy = $('btnCopy');
    if(btnCopy) btnCopy.disabled = false;
    const reportDay = $('form')?.querySelector('.sec-info input[type="date"]');
    if(reportDay) reportDay.disabled = false;
    return;
  }''', 'Template HTML: แสดงสถานะชั่วคราว')
        src = replace_once(src, 'function vss05MarkDirty() {',
            'function vss05MarkDirty() {\n  if(TEMP_MODE) {vss05SetUi();return;}', 'Template HTML: แก้ได้ไม่ต้อง Save')
        src = replace_once(src, 'function vss05Msg(type,payload={}) {',
            'function vss05Msg(type,payload={}) {\n  if(TEMP_MODE) return;', 'Template HTML: ห้ามส่งข้อความฐานข้อมูล')
        src = replace_once(src, 'function vss05Refresh() {',
            'function vss05Refresh() {\n  if(TEMP_MODE) return;', 'Template HTML: ไม่โหลดรายงานจริง')
        src = replace_once(src, 'function vss05SaveDaily() {',
            'function vss05SaveDaily() {\n  if(TEMP_MODE) return;', 'Template HTML: ไม่บันทึกรายงานจริง')
        # หากฟอร์มโหลดแล้วมี logic เปิดปิดปุ่ม ให้เรียก vss05SetUi ใน temp
        src = replace_once(src, 'function initForm(){', 'function initForm(){', 'Template HTML: พบ initForm')

    # รุ่นใหม่/เก่าต่างมี notifyVss05Parent: ยืนยันในแท็บชั่วคราวต้องไม่ส่งไปแก้ Excel จริง
    src = replace_once(src, 'function notifyVss05Parent(type, payload = {}) {',
        'function notifyVss05Parent(type, payload = {}) {\n  if(TEMP_MODE) return;',
        'Template HTML: กันส่งการยืนยันไปหน้าจริง')

    # กันการบันทึก PNG ผ่านการเรียก click ทาง JS; ปุ่มซ่อนอยู่แล้ว
    src = replace_once(src, "$('btnSave').onclick = async ()=>{",
        "$('btnSave').onclick = async ()=>{\n  if(TEMP_MODE) return;", 'Template HTML: ไม่มี Save PNG')

    # ensure copy uses last edits (wait for render after form change)
    src = replace_once(src, "$('btnCopy').onclick = async ()=>{",
        "$('btnCopy').onclick = async ()=>{\n  if(TEMP_MODE) render();", 'Template HTML: คัดลอกรูปล่าสุด')

    # VSS05 daily ready in newer HTML must not be posted from temp; guards in vss05Msg cover it.
    # document has standard copy and already supports editable text/image fields.
    return src


def main() -> None:
    root = Path(__file__).resolve().parent
    files = {
        root / 'src/pages/daily/AlertReport.jsx': patch_jsx,
        root / 'src/pages/daily/AlertReport.css': patch_css,
        root / 'public/templates/VSS05_AlertReport.html': patch_html,
    }

    print('=== VSS05 Temporary Tab Patch V3 ===')
    print(f'Project: {root}')
    missing = [str(p.relative_to(root)) for p in files if not p.is_file()]
    if missing:
        raise PatchError('ไม่พบไฟล์เดิม:\n- ' + '\n- '.join(missing) + '\nให้นำไฟล์ .py ไปวางที่โฟลเดอร์หลักของโปรเจกต์')

    old_text = {p: p.read_text(encoding='utf-8-sig') for p in files}
    # ตรวจว่าทุกจุดแก้มีอยู่ก่อนเขียนไฟล์ใด ๆ (fail fast)
    new_text = {p: transform(old_text[p]) for p, transform in files.items()}
    changes = [p for p in files if new_text[p] != old_text[p]]
    if not changes:
        print('✓ ตรวจพบว่า Patch ติดตั้งแล้ว ไม่มีการแก้ซ้ำ')
        return

    # เก็บ Backup นอกโฟลเดอร์โปรเจกต์: ไม่ถูก Vite copy เข้า dist
    # และไม่ไปรวมในไฟล์ที่ VS Code แสดงว่าต้อง commit
    backup_root = root.parent / '_BACKUP_VSS05_TEMP_TAB_20261108'
    written = []
    try:
        for path in changes:
            backup = backup_root / path.relative_to(root)
            backup.parent.mkdir(parents=True, exist_ok=True)
            if not backup.exists():
                backup.write_text(old_text[path], encoding='utf-8')
            tmp = path.with_name(path.name + '.patching_tmp')
            try:
                tmp.write_text(new_text[path], encoding='utf-8')
                os.replace(tmp, path)
            finally:
                if tmp.exists():
                    tmp.unlink()
            written.append(path)
            print('✓ แก้:', path.relative_to(root))
            print('  สำรอง:', backup)
    except Exception:
        for path in reversed(written):
            path.write_text(old_text[path], encoding='utf-8')
        raise

    print('\nสำเร็จ: เพิ่มแท็บรายงานชั่วคราว (ไม่บันทึกข้อมูล) ในไฟล์เดิม')
    print('ทดสอบต่อด้วย: npm run build')
    print('หมายเหตุ: ไฟล์สำรองอยู่นอกโปรเจกต์ ไม่ต้อง commit')


if __name__ == '__main__':
    try:
        main()
    except (PatchError, OSError, UnicodeError) as exc:
        print('\n✗ Patch ไม่สำเร็จ:', exc)
        raise SystemExit(1)
