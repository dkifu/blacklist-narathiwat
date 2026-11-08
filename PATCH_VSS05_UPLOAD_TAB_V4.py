# -*- coding: utf-8 -*-
"""V4: เพิ่มแท็บ 'อัปโหลด Alert Export' ให้ VSS05 โดยใช้ไฟล์เดิม

ใช้ต่อจาก PATCH_VSS05_TEMP_TAB_V3.py ที่สำเร็จแล้วเท่านั้น
รันในโฟลเดอร์หลักของโปรเจกต์: py PATCH_VSS05_UPLOAD_TAB_V4.py

แก้เฉพาะ:
  src/pages/daily/AlertReport.jsx
  src/pages/daily/AlertReport.css

ไม่แก้ HTML, package.json, ฐานข้อมูล หรือระบบบันทึกรายงานเดิม
ตรวจความเข้ากันได้ครบก่อนเขียน และสำรองต้นฉบับไว้นอกโปรเจกต์
"""
from __future__ import annotations

import os
import re
from pathlib import Path

MARK = 'VSS05_UPLOAD_TAB_V4_20261108'
PREVIOUS_MARK = 'VSS05_TEMP_TAB_20261108'


class PatchError(Exception):
    pass


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise PatchError(f'{label}: ควรพบจุดแก้ 1 จุด แต่พบ {count} จุด — ไม่แก้ไฟล์')
    return text.replace(old, new, 1)


def match_once(text: str, pattern: str, label: str, flags: int = 0) -> re.Match:
    matches = list(re.finditer(pattern, text, flags))
    if len(matches) != 1:
        raise PatchError(f'{label}: พบรูปแบบ {len(matches)} จุด (ต้องเป็น 1) — ไม่แก้ไฟล์')
    return matches[0]


def patch_jsx(src: str) -> str:
    if MARK in src:
        return src
    if PREVIOUS_MARK not in src or 'activeReportTab' not in src:
        raise PatchError('AlertReport.jsx: ยังไม่พบ Patch V3 สำหรับแท็บชั่วคราว กรุณาอย่ารัน V4 ก่อน V3')

    # ยืนยันโครงสร้างไฟล์ล่าสุด: V3, toolbar, iframe, controls ต้องมีอยู่จริง
    marker_pattern = re.compile(r'\{/\*\s*=+\s*(CENTER|INSPECTOR|ACTIONS)\s*=+\s*\*/\}')
    markers = {}
    for match in marker_pattern.finditer(src):
        name = match.group(1)
        if name in markers:
            raise PatchError(f'AlertReport.jsx: พบหัวข้อ {name} ซ้ำ — ไม่แก้ไฟล์')
        markers[name] = match
    if set(markers) != {'CENTER', 'INSPECTOR', 'ACTIONS'}:
        raise PatchError('AlertReport.jsx: โครงสร้างตัวเลือกศูนย์/ผู้ตรวจสอบ/ปุ่มแปลง ไม่ตรงกับ GitHub เวอร์ชันล่าสุด')
    if not (markers['CENTER'].start() < markers['INSPECTOR'].start() < markers['ACTIONS'].start()):
        raise PatchError('AlertReport.jsx: ลำดับตัวเลือกไม่ถูกต้อง')

    # โค้ดเลือกศูนย์/ผู้ตรวจสอบที่ใช้กับฐานข้อมูลเดิม นำมาใช้ในแท็บรายงานจริงด้วย
    # เพื่อให้ admin/supervisor เลือกศูนย์ก่อนบันทึกข้อมูลได้ แม้แยกแท็บอัปโหลดแล้ว
    choice_controls = src[markers['CENTER'].start():markers['ACTIONS'].start()].rstrip()
    if ('selectedCenterId' not in choice_controls or
        'selectedInspector' not in choice_controls or
        'setSelectedCenterId' not in choice_controls):
        raise PatchError('AlertReport.jsx: ตัวเลือกศูนย์/ผู้ตรวจสอบไม่ครบ — ไม่แก้ไฟล์')
    if ('ref={fileInputRef}' in choice_controls or
        'handleConvert' in choice_controls):
        raise PatchError('AlertReport.jsx: ตำแหน่งตัวเลือกครอบปุ่มอัปโหลดเกินมา — ไม่แก้ไฟล์')

    src = once(src,
        '''          รายงานชั่วคราว (สภ. / ไม่บันทึก)
        </button>
      </div>''',
        '''          รายงานชั่วคราว (สภ. / ไม่บันทึก)
        </button>
        {/* VSS05_UPLOAD_TAB_V4_20261108 — แท็บอัปโหลด/แปลงไฟล์ */}
        <button
          type="button"
          role="tab"
          aria-selected={activeReportTab === 'upload'}
          className={activeReportTab === 'upload' ? 'active' : ''}
          onClick={() => setActiveReportTab('upload')}
        >
          อัปโหลด Alert Export / แปลง VSS05
        </button>
      </div>''',
        'เพิ่มปุ่มแท็บที่ 3')

    src = once(src,
        "      <div style={{ display: activeReportTab === 'official' ? 'block' : 'none' }}>",
        "      <div style={{ display: activeReportTab === 'upload' ? 'block' : 'none' }}>",
        'ย้าย toolbar ไปแท็บอัปโหลด')

    # ระบุจุดจบ toolbar จาก comment PHUKET EYES ที่อยู่ติดกันเท่านั้น
    p = r'(      </section>)(\s+)(\{/\*\s*=+\s*PHUKET EYES เดิม\s*=+\s*\*/\})'
    m = match_once(src, p, 'จุดจบเครื่องมืออัปโหลดกับจุดเริ่มรายงานเดิม')
    daily_context = '''      </section>
      </div>

      {/* VSS05_UPLOAD_TAB_V4_20261108: ตัวเลือกศูนย์/ผู้ตรวจสอบสำหรับรายงานที่บันทึกฐานข้อมูล */}
      <div style={{ display: activeReportTab === 'official' ? 'block' : 'none' }}>
        <section className="vss05-daily-context" aria-label="ศูนย์ที่จัดทำรายงานประจำวัน">
          <div className="vss05-daily-context-title">
            <strong>รายงานประจำวัน · ข้อมูลที่บันทึก</strong>
            <span>เลือกศูนย์และผู้ตรวจสอบก่อนบันทึก เพื่อให้ข้อมูลเข้าไปยังศูนย์ที่ถูกต้อง</span>
          </div>
          <div className="vss05-toolbar-grid vss05-daily-context-grid">
''' + choice_controls + '''
          </div>
        </section>

      ''' + m.group(3)
    src = src[:m.start()] + daily_context + src[m.end():]

    if src.count('ref={reportFrameRef}') != 1:
        raise PatchError('AlertReport.jsx: iframe รายงานจริงไม่ตรงตามที่คาด')
    if src.count('src={`${reportUrl}?mode=temp`}') != 1:
        raise PatchError('AlertReport.jsx: iframe ชั่วคราวไม่ตรงตามที่คาด')
    if src.count("activeReportTab === 'upload'") != 3:
        # 1x selected, 1x class, 1x display = 3
        raise PatchError('AlertReport.jsx: การเปิด/ปิดแท็บอัปโหลดไม่ครบ')
    return src


def patch_css(src: str) -> str:
    if MARK in src:
        return src
    if PREVIOUS_MARK not in src:
        raise PatchError('AlertReport.css: ไม่พบ CSS ของ Patch V3')
    return src.rstrip() + '''

/* VSS05_UPLOAD_TAB_V4_20261108 — แยกแท็บอัปโหลดและรายงานจริง */
.vss05-daily-context {
  margin-bottom: 14px;
  padding: 15px 18px;
  border: 1px solid #30435c;
  border-radius: 12px;
  background: linear-gradient(140deg,#111c2b,#0e1825);
}
.vss05-daily-context-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 12px;
  color: #aebed2;
  font-size: 12px;
}
.vss05-daily-context-title strong { color: #eef4ff; font-size: 14px; }
.vss05-daily-context .vss05-daily-context-grid {
  grid-template-columns: repeat(2,minmax(0,1fr));
  max-width: 880px;
  gap: 12px;
}
@media (max-width: 700px) {
  .vss05-daily-context .vss05-daily-context-grid { grid-template-columns: 1fr; }
}
'''


def main() -> None:
    root = Path(__file__).resolve().parent
    paths = {
        root / 'src/pages/daily/AlertReport.jsx': patch_jsx,
        root / 'src/pages/daily/AlertReport.css': patch_css,
    }
    print('=== VSS05 Upload Tab Patch V4 ===')
    print('Project:', root)
    missing = [str(path.relative_to(root)) for path in paths if not path.is_file()]
    if missing:
        raise PatchError('ไม่พบไฟล์เดิม: ' + ', '.join(missing) + '\nวาง .py ไว้ที่โฟลเดอร์หลักของโปรเจกต์')

    old = {p: p.read_text(encoding='utf-8-sig') for p in paths}
    # Fail-fast: เตรียมและตรวจไฟล์ทั้งหมดก่อนเขียนไฟล์ใด ๆ
    new = {p: transform(old[p]) for p,transform in paths.items()}
    changed = [p for p in paths if old[p] != new[p]]
    if not changed:
        print('✓ V4 ติดตั้งแล้ว ไม่มีการแก้ไขซ้ำ')
        return
    if len(changed) != len(paths):
        raise PatchError('สถานะ Patch ไม่ตรงกันระหว่าง JSX/CSS — ไม่แก้ไข')

    backup_root = root.parent / '_BACKUP_VSS05_UPLOAD_TAB_V4_20261108'
    written = []
    try:
        for p in changed:
            backup = backup_root / p.relative_to(root)
            backup.parent.mkdir(parents=True, exist_ok=True)
            # ไม่ทับไฟล์ backup รอบก่อนหน้าเด็ดขาด
            if not backup.exists():
                backup.write_text(old[p], encoding='utf-8')
            tmp = p.with_name(p.name + '.upload_v4_tmp')
            try:
                tmp.write_text(new[p], encoding='utf-8')
                os.replace(tmp,p)
            finally:
                if tmp.exists():
                    tmp.unlink()
            written.append(p)
            print('✓ แก้:', p.relative_to(root))
            print('  สำรอง:',backup)
    except Exception:
        for p in reversed(written):
            p.write_text(old[p], encoding='utf-8')
        raise
    print('\nสำเร็จ: เพิ่มแท็บอัปโหลดไฟล์/แปลง VSS05 และคงตัวเลือกศูนย์ในแท็บรายงานประจำวัน')
    print('ไม่แก้ฐานข้อมูล และไม่แก้ template HTML')
    print('ทดสอบต่อด้วย: npm run build')


if __name__ == '__main__':
    try:
        main()
    except (PatchError, OSError, UnicodeError) as e:
        print('\n✗ Patch ไม่สำเร็จ:',e)
        raise SystemExit(1)
