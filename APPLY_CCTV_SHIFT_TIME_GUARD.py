from pathlib import Path
from datetime import datetime
import sys

TARGET = Path('src/pages/daily/CameraStatusReport.jsx')
MARKER = 'CCTV_SHIFT_TIME_GUARD_V1'

HELPER = r'''// CCTV_SHIFT_TIME_GUARD_V1
// กะปฏิบัติงานตามเวลาประเทศไทย: เช้า 08:00-15:59, บ่าย 16:00-23:59, ดึก 00:00-07:59
// การตรวจในหน้าเว็บเป็นชั้นแรก; ควรเพิ่มการตรวจฝั่งฐานข้อมูลอีกชั้น
const currentBangkokShift = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const hour = Number(parts.find(part => part.type === 'hour')?.value)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  return hour >= 8 && hour < 16
    ? 'morning'
    : hour >= 16
      ? 'afternoon'
      : 'night'
}

const checkCctvShiftTime = (role, selectedShift, selectedDate) => {
  // ผู้ดูแลและหัวหน้าสามารถจัดการข้อมูลย้อนหลังได้ตามสิทธิ์เดิม
  if (['admin', 'supervisor', 'super'].includes(role)) {
    return { allowed: true, message: '' }
  }

  const actualShift = currentBangkokShift()
  const actualDate = todayTH()
  if (actualShift && selectedShift === actualShift && selectedDate === actualDate) {
    return { allowed: true, message: '' }
  }

  return {
    allowed: false,
    message: actualShift
      ? `ยังบันทึกไม่ได้: เวลาประเทศไทยขณะนี้เป็น${SHIFTS[actualShift]} วันที่ ${actualDate} ` +
        `แต่หน้าที่เลือกเป็น${SHIFTS[selectedShift] || selectedShift} วันที่ ${selectedDate} ` +
        'กรุณากลับไปเลือกกะและวันที่ปัจจุบัน'
      : 'ยังบันทึกไม่ได้: ไม่สามารถตรวจสอบเวลาประเทศไทยได้',
  }
}

'''

LOCAL_HELPER = r'''  // ป้องกันการทำงานผิดกะ โดยไม่จำกัดสิทธิ์อ่านรายงานย้อนหลัง
  function ensureCurrentCctvShift(forManualAction = false) {
    const access = checkCctvShiftTime(role, shift, reportDate)
    if (access.allowed) return true
    if (forManualAction) setManualIpMessage(access.message)
    else setMessage(access.message)
    return false
  }

'''


def replace_once(text, before, after, label):
    n = text.count(before)
    if n != 1:
        raise RuntimeError(f'{label}: expected one matching code block, found {n}. No changes saved.')
    return text.replace(before, after, 1)


def main():
    if not TARGET.is_file():
        raise RuntimeError(f'File not found: {TARGET}. Run this in the project root.')

    old_bytes = TARGET.read_bytes()
    had_bom = old_bytes.startswith(b'\xef\xbb\xbf')
    original_line_ending = '\r\n' if b'\r\n' in old_bytes else '\n'
    old = old_bytes.decode('utf-8-sig').replace('\r\n', '\n')
    if MARKER in old:
        print('ALREADY APPLIED: CCTV shift time guard is present. Nothing changed.')
        return

    new = old
    new = replace_once(
        new,
        "const todayTH = () =>\n  new Date().toLocaleDateString('sv-SE', {\n    timeZone: 'Asia/Bangkok',\n  })\n\n",
        "const todayTH = () =>\n  new Date().toLocaleDateString('sv-SE', {\n    timeZone: 'Asia/Bangkok',\n  })\n\n" + HELPER,
        'Bangkok time helper',
    )
    new = replace_once(
        new,
        "  const [message, setMessage] =\n    useState('')\n\n",
        "  const [message, setMessage] =\n    useState('')\n\n" + LOCAL_HELPER,
        'component shift guard',
    )

    # Stop a full batch Ping on a wrong shift/date.
    new = replace_once(
        new,
        "      setMessage(\n        'ต้องมีทะเบียนกล้องและกรอกรหัส Agent ก่อน'\n      )\n      return\n    }\n\n    if (\n      !window.confirm(\n        `ตรวจ Ping",
        "      setMessage(\n        'ต้องมีทะเบียนกล้องและกรอกรหัส Agent ก่อน'\n      )\n      return\n    }\n\n    if (!ensureCurrentCctvShift()) return\n\n    if (\n      !window.confirm(\n        `ตรวจ Ping",
        'full batch Ping guard',
    )

    # Stop a single-camera re-Ping on a wrong shift/date.
    new = replace_once(
        new,
        "      !agentKey || !selectedLoaded\n    ) return\n\n    const camera = inventory.find(item => item.ip === ip)",
        "      !agentKey || !selectedLoaded\n    ) return\n\n    if (!ensureCurrentCctvShift()) return\n\n    const camera = inventory.find(item => item.ip === ip)",
        'single-camera Ping guard',
    )

    # Block write, even when user leaves tab open across a shift change.
    new = replace_once(
        new,
        "      !!pingingIp\n    ) return\n\n    if (\n      Object.keys(results).length === 0\n    )",
        "      !!pingingIp\n    ) return\n\n    if (!ensureCurrentCctvShift()) return\n\n    if (\n      Object.keys(results).length === 0\n    )",
        'save report guard',
    )

    # Manual camera status writes must obey the same restriction.
    new = replace_once(
        new,
        "    if (!camera || manualIpBusy || running || pingingIp || saving || importing || loading) return\n    if (network === camera.network_type",
        "    if (!camera || manualIpBusy || running || pingingIp || saving || importing || loading) return\n    if (!ensureCurrentCctvShift(true)) return\n    if (network === camera.network_type",
        'manual single-camera edit guard',
    )
    new = replace_once(
        new,
        "      loading\n    ) return\n\n    if (\n      Object.keys(results).length > 0 &&\n      !savedInfo\n    )",
        "      loading\n    ) return\n\n    if (!ensureCurrentCctvShift()) return\n\n    if (\n      Object.keys(results).length > 0 &&\n      !savedInfo\n    )",
        'manual bulk reset guard',
    )

    # Only after all six edits have been verified, create a backup and save.
    backup = TARGET.with_name(TARGET.stem + '_before_shift_time_guard_' + datetime.now().strftime('%Y%m%d_%H%M%S') + '.bak')
    backup.write_bytes(old_bytes)
    updated_bytes = (b'\xef\xbb\xbf' if had_bom else b'') + new.replace('\n', original_line_ending).encode('utf-8')
    TARGET.write_bytes(updated_bytes)
    print('UPDATED:', TARGET)
    print('BACKUP: ', backup)
    print('CHECKS: Bangkok shift, date, full Ping, single Ping, save, manual edit, manual reset')
    print('NEXT: npm run build')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('STOPPED:', exc, file=sys.stderr)
        sys.exit(1)
