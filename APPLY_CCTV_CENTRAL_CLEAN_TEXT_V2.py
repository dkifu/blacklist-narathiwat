from pathlib import Path
from datetime import datetime
import sys

JS = Path('src/pages/daily/CameraStatusReport.jsx')
CSS = Path('src/pages/daily/CameraStatusReport.css')
V2 = '// CCTV_CENTRAL_COPY_FORMAT_V2'
V1 = '// CCTV_CENTRAL_COPY_FORMAT_V1'
CSS_MARKER = '/* CCTV_KPI_GRID_ALIGN_V1 */'

NEW_COPY = '''  // CCTV_CENTRAL_COPY_FORMAT_V2
  async function copyAllText() {
    // ศชต.: สรุปยอดทุกศูนย์ + รายศูนย์เท่านั้น
    // ไม่ใส่ไอคอน รายละเอียดตู้ กล้องรายตัว หรือ IP
    const lines = [
      'สรุปสถานะกล้อง CCTV ทุกศูนย์',
      `วันที่ ${previewThaiDate(day)} | ${SHIFTS[selectedShift]}`,
      '',
      'ภาพรวมทุกศูนย์',
    ]

    for (const n of [overview.general, overview.checkpoint]) {
      lines.push(
        '',
        n.label,
        `  กล้องทั้งหมด: ${formatCount(n.total)} ตัว`,
        `  กล้องติด: ${formatCount(n.online)} ตัว`,
        `  กล้องดับ: ${formatCount(n.offline)} ตัว`,
      )
    }

    lines.push('', '--------------------', 'สรุปสถานะแยกรายศูนย์')

    for (const c of overview.centers) {
      lines.push(
        '',
        c.name,
        `  กล้องทั่วไป: ติด ${savedCell(c.general, 'online')} | ดับ ${savedCell(c.general, 'offline')}`,
        `  กล้องด่าน: ติด ${savedCell(c.checkpoint, 'online')} | ดับ ${savedCell(c.checkpoint, 'offline')}`,
      )
    }

    try {
      await navigator.clipboard.writeText(lines.join('\\n'))
      window.alert('คัดลอกข้อความแล้ว')
    } catch (error) {
      window.alert(`คัดลอกไม่สำเร็จ: ${error.message}`)
    }
  }

'''

CSS_ADDITION = r'''/* CCTV_KPI_GRID_ALIGN_V1 */
/* ตรึงช่องตัวเลขและเปอร์เซ็นต์ให้ตรงกันในแผง KPI */
.csr-dashboard-paper .csr-modern-stats .csr-stat-item {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) 7.5ch;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 10px;
  box-sizing: border-box;
  width: 100%;
}
.csr-dashboard-paper .csr-modern-stats .csr-stat-item > .csr-dot {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  margin: 0;
}
.csr-dashboard-paper .csr-modern-stats .csr-stat-item > small {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
}
.csr-dashboard-paper .csr-modern-stats .csr-stat-item > strong {
  grid-column: 3;
  grid-row: 1;
  min-width: 0;
  width: 100%;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.csr-dashboard-paper .csr-modern-stats .csr-stat-item > .csr-meter {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  width: 100%;
  margin: 0;
  box-sizing: border-box;
}
.csr-dashboard-paper .csr-modern-stats .csr-stat-item > em {
  grid-column: 3;
  grid-row: 2;
  width: 100%;
  min-width: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
'''


def load(path):
    if not path.is_file():
        raise RuntimeError(f'ไม่พบไฟล์ {path} (ให้รันในโฟลเดอร์หลักโปรเจกต์)')
    raw = path.read_bytes()
    return raw, raw.decode('utf-8-sig').replace('\r\n', '\n')


def encode_like(raw, content):
    newline = '\r\n' if b'\r\n' in raw else '\n'
    bom = b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b''
    return bom + content.replace('\n', newline).encode('utf-8')


def main():
    old_js, js = load(JS)
    old_css, css = load(CSS)

    begin_marker = '  async function copyAllText() {'
    end_marker = '  /* คัดลอกรูป / บันทึก PNG */'
    if js.count(begin_marker) != 1 or js.count(end_marker) != 1:
        raise RuntimeError('รูปแบบ copyAllText ไม่ตรงต้นฉบับ หยุดโดยไม่แก้ไข')
    start = js.index(begin_marker)
    if V1 in js[:start]:
        start = js.rfind('  // CCTV_CENTRAL_COPY_FORMAT_V1', 0, start)
    elif V2 in js[:start]:
        start = js.rfind('  // CCTV_CENTRAL_COPY_FORMAT_V2', 0, start)

    end = js.index(end_marker, start)
    previous = js[start:end]
    required = ('overview.general', 'overview.checkpoint', 'overview.centers',
                'navigator.clipboard.writeText')
    if not all(token in previous for token in required):
        raise RuntimeError('ฟังก์ชันคัดลอกข้อความถูกแก้จากรูปแบบที่รองรับแล้ว หยุดเพื่อความปลอดภัย')

    has_v2 = V2 in previous
    has_css = CSS_MARKER in css
    if has_v2 and has_css:
        print('ALREADY APPLIED: ข้อความ ศชต. และ CSS จัดกราฟเป็นรุ่นล่าสุดแล้ว')
        return

    js_new = js if has_v2 else js[:start] + NEW_COPY + js[end:]
    if not has_css and ('csr-modern-stats' not in js or 'csr-meter' not in js):
        raise RuntimeError('ไม่พบโครงสร้าง KPI ตามต้นฉบับ หยุดโดยไม่แก้ไข')
    css_new = css if has_css else css.rstrip('\n') + '\n\n' + CSS_ADDITION

    backups = (Path('.git/cctv-patch-backups') if Path('.git').is_dir()
               else Path('cctv-patch-backups'))
    backups.mkdir(exist_ok=True, parents=True)
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    (backups / f'CameraStatusReport_before_central_text_v2_{stamp}.jsx.bak').write_bytes(old_js)
    (backups / f'CameraStatusReport_before_central_text_v2_{stamp}.css.bak').write_bytes(old_css)

    try:
        if js_new != js:
            JS.write_bytes(encode_like(old_js, js_new))
        if css_new != css:
            CSS.write_bytes(encode_like(old_css, css_new))
    except Exception:
        JS.write_bytes(old_js)
        CSS.write_bytes(old_css)
        raise

    print('UPDATED: src/pages/daily/CameraStatusReport.jsx' if js_new != js else 'UNCHANGED: src/pages/daily/CameraStatusReport.jsx')
    print('UPDATED: src/pages/daily/CameraStatusReport.css' if css_new != css else 'UNCHANGED: src/pages/daily/CameraStatusReport.css')
    print('BACKUP:', backups)
    print('CENTRAL COPY: no icons, no full-outage/partial-outage details; totals and center rows retained')
    print('NEXT: npm run build')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('STOPPED:', exc, file=sys.stderr)
        sys.exit(1)
