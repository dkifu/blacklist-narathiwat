# -*- coding: utf-8 -*-
"""V6: บาร์แปลง VSS05 เดียวกันใช้ได้จริงใน 2 แท็บ (รายงานจริง/ชั่วคราว)

ฐานที่รองรับ: Patch V3 สำเร็จ และ Restore Patch V4 กลับแล้ว
ไม่ต้องใช้ V5; อย่ารัน V5 เพิ่ม

วางสคริปต์ในโฟลเดอร์โปรเจกต์แล้วรัน:
  py PATCH_VSS05_SHARED_UPLOAD_V6.py

แก้เฉพาะไฟล์เดิม:
  src/pages/daily/AlertReport.jsx
  public/templates/VSS05_AlertReport.html

ไม่แก้ CSS / package.json / Supabase / ระบบบันทึกรายวัน
มี Backup นอกโปรเจกต์, ตรวจโครงสร้างทั้งหมดก่อนเขียน, ย้อนอัตโนมัติถ้าเขียนผิดพลาด
"""
from __future__ import annotations

import os
import re
from pathlib import Path

MARK = 'VSS05_SHARED_UPLOAD_V6_20261108'
V3 = 'VSS05_TEMP_TAB_20261108'
V4 = 'VSS05_UPLOAD_TAB_V4_20261108'
V5 = 'VSS05_SHARED_UPLOAD_V5_20261108'


class PatchError(Exception):
    pass


def once(src: str, old: str, new: str, purpose: str) -> str:
    hits = src.count(old)
    if hits != 1:
        raise PatchError(f'{purpose}: ต้องพบจุดแก้ 1 จุด แต่พบ {hits} — ไม่มีการแก้ไฟล์')
    return src.replace(old, new, 1)


def regex_once(src: str, pattern: str, repl, purpose: str, *, flags: int = 0) -> str:
    matches = list(re.finditer(pattern, src, flags))
    if len(matches) != 1:
        raise PatchError(f'{purpose}: ต้องพบโครงสร้าง 1 จุด แต่พบ {len(matches)} — ไม่มีการแก้ไฟล์')
    m = matches[0]
    replacement = repl(m) if callable(repl) else repl
    return src[:m.start()] + replacement + src[m.end():]


def patch_jsx(src: str) -> str:
    if MARK in src:
        return src
    if V4 in src or V5 in src or "activeReportTab === 'upload'" in src:
        raise PatchError('AlertReport.jsx ยังมี Patch V4 หรือ V5: หยุดก่อนเพื่อไม่ให้แก้ซ้อน')
    if V3 not in src:
        raise PatchError('AlertReport.jsx ไม่มี Patch V3: ต้องใช้ไฟล์หลัง V3 ก่อน')

    # ย้ายบาร์อัปโหลดเดิมออกจาก wrapper official มาไว้ร่วมเหนือทั้งสองแท็บ
    # ไม่ย้าย/เปลี่ยน handlers หรือ state อื่นในบาร์
    pat = (
        r'(?P<wrapper>^[ \t]*<div style=\{\{ display: activeReportTab === \'official\' \? \'block\' : \'none\' \}\}>)'
        r'(?P<gap1>\s*)'
        r'(?P<toolbar_comment>\{/\*\s*=+\s*VSS05 TOOLBAR\s*=+\s*\*/\})'
        r'(?P<gap2>\s*)'
        r'(?P<toolbar><section className="vss05-toolbar">[\s\S]*?</section>)'
        r'(?P<gap3>\s*)'
        r'(?P<report_comment>\{/\*\s*=+\s*PHUKET EYES เดิม\s*=+\s*\*/\})'
    )

    def move_toolbar(m):
        return (
            '      ' + m.group('toolbar_comment') + '\n'
            '      ' + m.group('toolbar') + '\n\n'
            '      {/* รายงานจริงยังคง iframe เดิมไว้ ไม่สลับทิ้งเมื่อกดแท็บชั่วคราว */}\n'
            + m.group('wrapper') + '\n'
            '      ' + m.group('report_comment')
        )

    src = regex_once(src, pat, move_toolbar, 'ย้ายบาร์อัปโหลดเดิม', flags=re.M)
    src = once(src,
        '{/* คง iframe เดิมไว้ แม้ซ่อนแท็บ เพื่อไม่ให้ข้อมูลที่กำลังกรอกหาย */}',
        '{/* ' + MARK + ': บาร์อัปโหลดใช้ร่วมกัน แต่แปลงลง iframe ของแท็บที่เลือก */}',
        'บันทึกเครื่องหมายเวอร์ชัน')

    # อ้างอิง iframe ชั่วคราวเพิ่มเติม โดยไม่เปลี่ยน ref ของ iframe รายงานจริง
    src = once(src, '  const reportFrameRef = useRef(null)',
        '  const reportFrameRef = useRef(null)\n  const tempReportFrameRef = useRef(null)',
        'เพิ่ม ref ของรายงานชั่วคราว')
    src = once(src,
        '          src={`${reportUrl}?mode=temp`}',
        '          ref={tempReportFrameRef}\n          src={`${reportUrl}?mode=temp`}',
        'ผูก ref ของ iframe ชั่วคราว')

    # ส่งข้อมูลแปลง Excel เข้าเฉพาะ iframe ที่เลือก (ไม่ใช่ official เสมอ)
    src = regex_once(src,
        r'(?P<ind>^[ \t]*)const frame\s*=\s*reportFrameRef\.current\s*(?=\n)',
        lambda m: m.group('ind') + 'const frame =\n' + m.group('ind')
        + "  (activeReportTab === 'temporary' ? tempReportFrameRef.current : reportFrameRef.current)",
        'ส่งผลแปลงไปแท็บที่เลือก', flags=re.M)

    # ปุ่มยืนยันและการรับข้อความผลยืนยันต้องจับคู่ iframe เดียวกัน
    src = once(src,
        '  reportFrameRef.current?.contentWindow?.postMessage(',
        "  (activeReportTab === 'temporary' ? tempReportFrameRef.current : reportFrameRef.current)?.contentWindow?.postMessage(",
        'ส่งคำสั่งยืนยันไปแท็บที่เลือก')
    src = once(src,
        'event.source !== reportFrameRef.current?.contentWindow',
        "event.source !== (activeReportTab === 'temporary' ? tempReportFrameRef.current : reportFrameRef.current)?.contentWindow",
        'รับผลยืนยันจากแท็บที่เลือก')

    # เปลี่ยน dependency เฉพาะ useEffect ดักผลยืนยัน ไม่แตะ useEffect รายวัน
    mark = 'const handleVss05Message = (event) => {'
    if src.count(mark) != 1:
        raise PatchError('ไม่พบ Listener ยืนยัน VSS05 1 จุด')
    start = src.index(mark)
    end = src.find('VSS05_DAILY_V1_20261106', start)
    if end < 0:
        raise PatchError('ไม่พบจุดสิ้นสุด Listener ยืนยัน VSS05')
    segment = src[start:end]
    segment = once(segment, '}, [convertedFile])', '}, [convertedFile, activeReportTab])', 'อัปเดต Listener เมื่อสลับแท็บ')
    src = src[:start] + segment + src[end:]

    # เมื่อสลับแท็บ เคลียร์เฉพาะสถานะไฟล์ผลลัพธ์/ยืนยันที่อาจเป็นของอีกแท็บ
    # แต่ยังเก็บไฟล์ต้นทางที่เลือกไว้และคงข้อมูลใน iframe ทั้งสองแท็บ
    for tab in ('official', 'temporary'):
        src = once(src,
            f"onClick={{() => setActiveReportTab('{tab}')}}",
            f"onClick={{() => {{ setActiveReportTab('{tab}'); setConvertedFile(null); setIsVss05Confirmed(false) }}}}",
            f'ล้างสถานะการยืนยันเมื่อสลับไป {tab}')

    # Sanity check structure
    toolbar = src.index('<section className="vss05-toolbar">')
    official = src.index("<div style={{ display: activeReportTab === 'official' ? 'block' : 'none' }}>")
    temporary = src.index("<div style={{ display: activeReportTab === 'temporary' ? 'block' : 'none' }}>")
    if not toolbar < official < temporary:
        raise PatchError('บาร์อัปโหลดไม่อยู่นอก wrapper ของทั้งสองแท็บ')
    for label, token in [
        ('จำนวน toolbar', '<section className="vss05-toolbar">'),
        ('iframe ทางการ', 'ref={reportFrameRef}'),
        ('iframe ชั่วคราว', 'ref={tempReportFrameRef}'),
        ('ตัวเลือกวัน', "รายงานประจำวัน (บันทึกข้อมูล)"),
        ('ตัวเลือกชั่วคราว', "รายงานชั่วคราว (สภ. / ไม่บันทึก)"),
        ('แท็บ temp URL', 'src={`${reportUrl}?mode=temp`}'),
    ]:
        if src.count(token) != 1:
            raise PatchError(f'โครงสร้างผิดหลังแก้: {label} มี {src.count(token)} จุด')
    return src


def patch_html(src: str) -> str:
    if MARK in src:
        return src
    if V3 not in src or 'const TEMP_MODE' not in src:
        raise PatchError('Template VSS05 ต้องเป็นเวอร์ชันหลัง Patch V3 เท่านั้น')

    # V3 ป้องกันการรับ postMessage ทุกชนิดใน temp; ปรับให้รับเฉพาะการนำเข้า
    # และการยืนยัน Excel โดยยังปฏิเสธข้อความสั่งโหลด/บันทึก DB ทั้งหมด
    src = once(src,
        "if (TEMP_MODE) {\n  window.addEventListener('message', event => event.stopImmediatePropagation(), true);\n}",
        """if (TEMP_MODE) {
  // VSS05_SHARED_UPLOAD_V6_20261108: รับเฉพาะข้อความนำเข้า/ยืนยัน
  // การสื่อสารฐานข้อมูล VSS05_DAILY_* ถูกบล็อกทุกกรณี
  window.addEventListener('message', event => {
    const type = event.data?.type;
    const allowed = event.origin === window.location.origin &&
      event.source === window.parent &&
      (type === 'LOAD_VSS05_DATA' || type === 'REQUEST_VSS05_CONFIRMATION');
    if (!allowed) event.stopImmediatePropagation();
  }, true);
}""",
        'อนุญาตนำเข้าและยืนยันใน iframe ชั่วคราว')

    # อนุญาตให้ temp ตอบเฉพาะผลยืนยัน/ยกเลิกที่ใช้สร้าง Excel;
    # ยังคงป้องกันข้อความอื่น รวมถึงการบันทึกฐานข้อมูลจาก template
    src = once(src,
        "function notifyVss05Parent(type, payload = {}) {\n  if(TEMP_MODE) return;",
        """function notifyVss05Parent(type, payload = {}) {
  if(TEMP_MODE && type !== 'VSS05_DATA_CONFIRMED' &&
     type !== 'VSS05_CONFIRMATION_RESET') return;""",
        'อนุญาตส่งผลยืนยันกลับ React จากโหมดชั่วคราว')

    if src.count("function vss05Msg(type,payload={}) {\n  if(TEMP_MODE) return;") != 1:
        raise PatchError('ไม่พบตัวป้องกันการส่งข้อความฐานข้อมูลใน V3 — ไม่แก้ต่อ')
    if src.count("function vss05SaveDaily() {\n  if(TEMP_MODE) return;") != 1:
        raise PatchError('ไม่พบตัวป้องกันการบันทึกลงฐานข้อมูลใน V3')
    if src.count("function vss05Refresh() {\n  if(TEMP_MODE) return;") != 1:
        raise PatchError('ไม่พบตัวป้องกันการโหลดฐานข้อมูลใน V3')
    return src


def main() -> None:
    root = Path(__file__).resolve().parent
    jsx_path = root / 'src/pages/daily/AlertReport.jsx'
    html_path = root / 'public/templates/VSS05_AlertReport.html'
    css_path = root / 'src/pages/daily/AlertReport.css'
    for path in (jsx_path, html_path, css_path):
        if not path.is_file():
            raise PatchError(f'ไม่พบ {path.relative_to(root)} กรุณาวางไฟล์ Python ในโฟลเดอร์โปรเจกต์')

    old_jsx = jsx_path.read_text(encoding='utf-8-sig')
    old_html = html_path.read_text(encoding='utf-8-sig')
    css = css_path.read_text(encoding='utf-8-sig')
    if V3 not in css or V4 in css:
        raise PatchError('CSS ยังไม่อยู่ในสถานะหลัง Restore V4 — หยุดก่อน')
    if (MARK in old_jsx) != (MARK in old_html):
        raise PatchError('พบ V6 ติดตั้งไม่ครบทั้ง JSX และ HTML — หยุดก่อน')
    if MARK in old_jsx and MARK in old_html:
        print('✓ V6 ติดตั้งเรียบร้อยแล้ว — ไม่มีการแก้ซ้ำ')
        return

    # สำคัญ: ตรวจและสร้างไฟล์ฉบับแก้ครบทั้งคู่ก่อน Backup / เขียนแม้แต่ไฟล์เดียว
    new_jsx = patch_jsx(old_jsx)
    new_html = patch_html(old_html)

    backup_root = root.parent / '_BACKUP_VSS05_SHARED_UPLOAD_V6_20261108'
    pairs = [(jsx_path, old_jsx, new_jsx), (html_path, old_html, new_html)]
    for path, _, _ in pairs:
        backup = backup_root / path.relative_to(root)
        if backup.exists():
            raise PatchError(f'พบ Backup V6 เก่า แต่ไฟล์ยังไม่ตรงกับ V6: {backup}\nหยุดเพื่อป้องกันการทับสำรอง')

    # Backups อยู่นอกโปรเจกต์และไม่มีการเขียนทับ
    for path, old, _ in pairs:
        backup = backup_root / path.relative_to(root)
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_text(old, encoding='utf-8')

    written = []
    try:
        for path, old, new in pairs:
            tmp = path.with_name(path.name + '.v6_pending')
            try:
                tmp.write_text(new, encoding='utf-8')
                os.replace(tmp, path)
            finally:
                if tmp.exists():
                    tmp.unlink()
            written.append((path, old))
            print('✓ แก้:', path.relative_to(root))
            print('  สำรอง:', backup_root / path.relative_to(root))
    except Exception:
        for path, old in reversed(written):
            path.write_text(old, encoding='utf-8')
        raise

    print('\nสำเร็จ: 2 แท็บใช้บาร์อัปโหลด VSS05 ร่วมกัน และส่งข้อมูลเข้า iframe ที่กำลังเลือก')
    print('ไม่แก้ CSS / ไม่แก้ระบบบันทึกรายวัน / ไม่ติดต่อ Supabase จาก Patch')
    print('ขั้นต่อไป: npm run build แล้วทดสอบการแปลง/ยืนยันในทั้งสองแท็บ')


if __name__ == '__main__':
    try:
        print('=== VSS05 Shared Upload Patch V6 ===')
        main()
    except (PatchError, OSError, UnicodeError) as exc:
        print('\n✗ Patch ไม่สำเร็จ:', exc)
        raise SystemExit(1)
