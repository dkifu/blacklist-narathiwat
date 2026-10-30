from pathlib import Path
from datetime import datetime
import shutil
import sys

# Run from the Blacklist_Narathiwat project root.
target = Path('src/pages/daily/DailyCctvReport.jsx')
if not target.is_file():
    sys.exit(f'ERROR: File not found: {target}. Run this script from the project root.')

source = target.read_text(encoding='utf-8-sig')

old_regular_guard = """  if (totals.unknown > 0) {
    return {
      ok: false,
      message:
        `ยังมีกล้องรอตรวจสอบ ${totals.unknown} ตัว ` +
        'จึงยังไม่ปรับยอดอัตโนมัติ',
    }
  }

"""

old_central_guard = """  const centralCameraIncomplete =
    isCentralCctv(selectedCenter?.name) &&
    (
      !cameraPingInfo?.ok ||
      cameraPingInfo?.partial === true ||
      Number(cameraPingInfo?.unknown || 0) > 0
    )"""
new_central_guard = """  const centralCameraIncomplete =
    isCentralCctv(selectedCenter?.name) &&
    (
      !cameraPingInfo?.ok ||
      cameraPingInfo?.partial === true
    )"""

regular_found = source.count(old_regular_guard)
central_found = source.count(old_central_guard)
new_central_found = source.count(new_central_guard)

if regular_found > 1 or central_found > 1:
    sys.exit('ERROR: Duplicate target code. No changes made.')
if central_found == 0 and new_central_found != 1:
    sys.exit('ERROR: Central check differs from expected code. No changes made.')
if regular_found == 0 and 'ยังมีกล้องรอตรวจสอบ ${totals.unknown}' in source:
    sys.exit('ERROR: Regular center unknown guard differs from expected code. No changes made.')

updated = source.replace(old_regular_guard, '', 1).replace(old_central_guard, new_central_guard, 1)
if updated == source:
    print('NO CHANGE: Both fixes appear to be applied already.')
else:
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup = target.with_name(f'DailyCctvReport_before_confirmed_unknown_{stamp}.bak')
    shutil.copy2(target, backup)
    target.write_text(updated, encoding='utf-8')
    print('UPDATED:', target)
    print('BACKUP: ', backup)
    print('FIX 1: confirmed unknown cameras no longer block individual center auto totals')
    print('FIX 2: confirmed unknown cameras no longer block central daily report save')

print('Next: npm run build')
