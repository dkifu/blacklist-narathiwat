from pathlib import Path
from datetime import datetime
import sys

TARGET = Path('src/pages/daily/CameraStatusReport.jsx')
MARKER = 'CCTV_COPY_CAMERA_DETAILS_V1'
FUNCTION_START = 'function copyCameraDetailsLines(item) {'
FUNCTION_END = '\nfunction previewTextReport(snapshot) {'

OLD_RETURN = '''    ...counts,
    ...colors,
    ...outage,
  }
}

function previewTextReport(snapshot) {'''

NEW_RETURN = '''    ...counts,
    ...colors,
    ...outage,
    // CCTV_COPY_CAMERA_DETAILS_V1: รายกล้องสำหรับข้อความคัดลอก (ไม่แก้ข้อมูล Ping)
    cameraDetails: details,
  }
}

''' + FUNCTION_START

OLD_INSERT = '''      `- ดับรายตัว (ไม่ซ้ำกับทั้ง${item.unitName}) ${item.partialOfflineCount} กล้อง`,
      ''
    )
  }
  parts.push('ข้อมูลใบงานแจ้งซ่อมตรวจสอบได้จากตารางติดตามงานใต้กราฟ')'''

NEW_INSERT = '''      `- ดับรายตัว (ไม่ซ้ำกับทั้ง${item.unitName}) ${item.partialOfflineCount} กล้อง`,
      ''
    )
    parts.push(...copyCameraDetailsLines(item), '')
  }
  parts.push('ข้อมูลใบงานแจ้งซ่อมตรวจสอบได้จากตารางติดตามงานใต้กราฟ')'''

NEW_FUNCTION = '''function copyCameraDetailsLines(item) {
  const cameras = Array.isArray(item.cameraDetails) ? item.cameraDetails : []
  // แสดงเฉพาะกล้องที่ได้รับการยืนยันว่าดับ ไม่แสดงกล้องปกติหรือยังไม่ Ping
  const offlineCameras = cameras.filter(camera => camera.status === 'offline')
  if (!offlineCameras.length) {
    return [cameras.length || Number(item.offline || 0) === 0
      ? '- ไม่พบกล้องดับในรายงานนี้'
      : '- ไม่พบรายละเอียดรายกล้องดับของรายงานนี้']
  }

  const unitWord = item.networkType === 'checkpoint' ? 'ด่าน' : 'ตู้'
  const units = new Map()
  for (const camera of offlineCameras) {
    const rawLabel = String(camera.service_box || '').trim()
    const key = rawLabel ? rawLabel.toLocaleUpperCase() : '__NO_UNIT__'
    if (!units.has(key)) {
      units.set(key, { label: rawLabel || 'ไม่ระบุรหัสตู้/ด่าน', cameras: [] })
    }
    units.get(key).cameras.push(camera)
  }

  const lines = [`รายละเอียดกล้องดับ (${offlineCameras.length} ตัว)`]
  const sortedUnits = [...units.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'th', { numeric: true })
  )
  for (const unit of sortedUnits) {
    lines.push(`- ${unitWord} ${unit.label} | ดับ ${unit.cameras.length} กล้อง`)
    const sorted = [...unit.cameras].sort((a, b) =>
      String(a.ip || '').localeCompare(String(b.ip || ''), undefined, { numeric: true })
    )
    for (const [index, camera] of sorted.entries()) {
      lines.push(
        `    ${index + 1}. ${String(camera.name || '-').trim() || '-'} | IP: ${camera.ip || '-'}`
      )
    }
  }
  return lines
}
'''


def replace_exactly_once(content, before, after, label):
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: พบตำแหน่ง {count} จุด (ต้องเป็น 1) — ไม่มีการแก้ไข')
    return content.replace(before, after, 1)


def main():
    if not TARGET.is_file():
        raise RuntimeError(f'ไม่พบ {TARGET} กรุณารันในโฟลเดอร์หลักโปรเจกต์')

    original_bytes = TARGET.read_bytes()
    bom = original_bytes.startswith(b'\xef\xbb\xbf')
    newline = '\r\n' if b'\r\n' in original_bytes else '\n'
    content = original_bytes.decode('utf-8-sig').replace('\r\n', '\n')

    if 'CCTV_COPY_OFFLINE_ONLY_V1' in content:
        print('ALREADY APPLIED: คัดลอกเฉพาะกล้องดับเรียบร้อยแล้ว')
        return

    if MARKER in content:
        # กรณีเคยรัน APPLY_CCTV_COPY_CAMERA_DETAILS.py ไปแล้ว
        if content.count(FUNCTION_START) != 1 or content.count(FUNCTION_END) != 1:
            raise RuntimeError('ไม่พบฟังก์ชันคัดลอกรายกล้องตามที่คาดไว้')
        start = content.index(FUNCTION_START)
        end = content.index(FUNCTION_END, start)
        content = content[:start] + NEW_FUNCTION + content[end:]
        mode = 'UPDATED: เปลี่ยนรายละเอียดเดิมจากทุกกล้องเป็นเฉพาะกล้องดับ'
    else:
        # กรณียังไม่เคยรันตัวแก้ไขคัดลอกรายกล้อง
        content = replace_exactly_once(
            content, OLD_RETURN,
            NEW_RETURN + NEW_FUNCTION[len(FUNCTION_START):] + '\nfunction previewTextReport(snapshot) {',
            'เพิ่มข้อมูลรายกล้องสำหรับคัดลอก'
        )
        content = replace_exactly_once(content, OLD_INSERT, NEW_INSERT, 'เพิ่มรายละเอียดกล้องดับในข้อความ')
        mode = 'UPDATED: เพิ่มรายละเอียดเฉพาะกล้องดับในข้อความคัดลอก'

    # ใช้ตรวจให้ชัดว่าสคริปต์ไม่แตะฟังก์ชัน Ping/บันทึกหรือส่งออกภาพ
    for required in ('async function runPing()', 'async function saveReport()',
                     'async function copyPreviewText()', 'async function exportPreviewPng('):
        if required not in content:
            raise RuntimeError(f'โครงสร้างไฟล์ไม่ตรง: {required} — ไม่มีการแก้ไข')
    content = content.replace(
        '  // แสดงเฉพาะกล้องที่ได้รับการยืนยันว่าดับ ไม่แสดงกล้องปกติหรือยังไม่ Ping',
        '  // CCTV_COPY_OFFLINE_ONLY_V1: เฉพาะกล้องดับ ไม่แสดงกล้องปกติหรือยังไม่ Ping', 1
    )

    backup = TARGET.with_name(
        TARGET.stem + '_before_copy_offline_only_' + datetime.now().strftime('%Y%m%d_%H%M%S') + '.bak'
    )
    backup.write_bytes(original_bytes)
    TARGET.write_bytes((b'\xef\xbb\xbf' if bom else b'') + content.replace('\n', newline).encode('utf-8'))
    print(mode)
    print('FILE:   ', TARGET)
    print('BACKUP: ', backup)
    print('CHECKS: only offline camera + cabinet/checkpoint + camera name + IP; Ping/Save/PNG unchanged')
    print('NEXT: npm run build')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('STOPPED:', exc, file=sys.stderr)
        sys.exit(1)
