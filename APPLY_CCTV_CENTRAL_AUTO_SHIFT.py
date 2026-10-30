from pathlib import Path
from datetime import datetime
import sys

TARGET = Path('src/pages/daily/CameraStatusReport.jsx')
MARKER = 'CCTV_CENTRAL_AUTO_SHIFT_V1'
OLD_STATE = """function CameraAllCentersView({ shift }) {
  const [day, setDay] = useState(todayTH)

  const [selectedShift, setSelectedShift] = useState(
    SHIFTS[shift] ? shift : 'morning'
  )
"""
NEW_STATE = """function CameraAllCentersView() {
  const [day, setDay] = useState(todayTH)

  // CCTV_CENTRAL_AUTO_SHIFT_V1
  // หน้า ศชต. เริ่มที่กะปัจจุบันตามเวลาไทย ไม่อิงกะจากหน้าเมนู
  // ยังให้ผู้ใช้เลือกกะอื่นเพื่อดูย้อนหลังได้ตามปกติ
  const [selectedShift, setSelectedShift] = useState(
    () => currentBangkokShift() || 'morning'
  )
"""
OLD_EFFECT = """  useEffect(() => {
    if (SHIFTS[shift]) setSelectedShift(shift)
  }, [shift])

  /* โหลดข้อมูลจาก Supabase */"""
NEW_EFFECT = """  // ไม่ใช้ props.shift บังคับเปลี่ยนกะของหน้า ศชต.
  // เพื่อไม่ให้ทับการเลือกดูกะอื่นด้วยตนเอง

  /* โหลดข้อมูลจาก Supabase */"""


def main():
    if not TARGET.is_file():
        raise RuntimeError(f'ไม่พบ {TARGET} — กรุณารันในโฟลเดอร์หลักโปรเจกต์')
    raw = TARGET.read_bytes()
    bom = raw.startswith(b'\xef\xbb\xbf')
    newline = '\r\n' if b'\r\n' in raw else '\n'
    source = raw.decode('utf-8-sig').replace('\r\n', '\n')
    if MARKER in source:
        print('ALREADY APPLIED: หน้า ศชต. ใช้กะเริ่มต้นตามเวลาไทยอยู่แล้ว')
        return
    if 'const currentBangkokShift = () =>' not in source:
        raise RuntimeError('ไม่พบ currentBangkokShift — ต้องใช้โค้ดหลังจากรัน APPLY_CCTV_SHIFT_TIME_GUARD.py ก่อน')
    if source.count(OLD_STATE) != 1 or source.count(OLD_EFFECT) != 1 or source.count("<CameraAllCentersView shift={props.shift} />") != 1:
        raise RuntimeError('โค้ดต้นฉบับไม่ตรงกับเวอร์ชันที่ตรวจสอบ — ยังไม่แก้ไขไฟล์')
    changed = (source.replace(OLD_STATE, NEW_STATE, 1)
                     .replace(OLD_EFFECT, NEW_EFFECT, 1)
                     .replace('<CameraAllCentersView shift={props.shift} />', '<CameraAllCentersView />', 1))
    backup = TARGET.with_name(f'{TARGET.stem}_before_central_auto_shift_{datetime.now():%Y%m%d_%H%M%S}.bak')
    backup.write_bytes(raw)
    TARGET.write_bytes((b'\xef\xbb\xbf' if bom else b'') + changed.replace('\n', newline).encode('utf-8'))
    print('UPDATED:', TARGET)
    print('BACKUP: ', backup)
    print('CHECKS: central default = current Bangkok shift; manual selection preserved; existing Ping guard unchanged')
    print('NEXT: npm run build')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('STOPPED:', exc, file=sys.stderr)
        sys.exit(1)
