# -*- coding: utf-8 -*-
"""Apply a small safe patch to the CURRENT CameraStatusReport.jsx.

Run from the root of the Blacklist_Narathiwat project:
    python APPLY_CAMERA_PING_TIMESTAMP.py

Does not replace the whole report file, so current screenshot/export fixes remain.
Stops without changing anything when the expected anchors don't match.
"""
from pathlib import Path
import sys

candidates = sorted(Path('src').rglob('CameraStatusReport.jsx'))
if len(candidates) != 1:
    sys.exit(f'ERROR: Expected exactly one src/**/CameraStatusReport.jsx; found {len(candidates)}. Nothing changed.')
path = candidates[0]
s = path.read_text(encoding='utf-8-sig')

# Idempotent: if both anchors already exist, leave it alone.
if 'pinged_at: ping ? new Date().toISOString() : null,' in s and 'pinged_at,' in s:
    print(f'Already updated: {path}')
    sys.exit(0)

# 1. Stamp only real Agent results, not a report re-save.
anchor_1 = '    ping_source_level: ping?.level ?? null,\n'
assert s.count(anchor_1) == 1, 'newResult anchor changed. No file changed.'
s = s.replace(anchor_1,
              anchor_1 + '    pinged_at: ping ? new Date().toISOString() : null,\n', 1)

# 2. Persist the per-camera stamp with the details JSON.
start_marker = '  async function saveReport() {'
assert s.count(start_marker) == 1, 'saveReport anchor changed. No file changed.'
start = s.index(start_marker)
head, tail = s[:start], s[start:]
pattern_2 = '                  ping_source_level,\n                  avg_ms,\n'
assert tail.count(pattern_2) == 2, f'Expected 2 details map anchors, found {tail.count(pattern_2)}. No file changed.'
tail = tail.replace(pattern_2,
                    '                  ping_source_level,\n                  pinged_at,\n                  avg_ms,\n', 2)
s = head + tail

# Ensure the complete patch is present before touching the user's file.
assert s.count('pinged_at: ping ? new Date().toISOString() : null,') == 1
assert s[start:].count('                  pinged_at,') == 2

backup = Path.cwd().parent / 'CameraStatusReport_before_ping_once.bak'
if backup.exists():
    sys.exit(f'ERROR: Backup already exists: {backup}. No changes made.')
backup.write_text(path.read_text(encoding='utf-8-sig'), encoding='utf-8')
path.write_text(s, encoding='utf-8')
print(f'UPDATED: {path}')
print(f'BACKUP:  {backup}')
print('Next: npm run build')
