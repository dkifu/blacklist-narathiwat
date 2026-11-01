# -*- coding: utf-8 -*-
"""Read-only source map for TCC Daily Dashboard integration.

Usage (PowerShell at project root):
    py SCAN_TCC_PROJECT.py
or
    py SCAN_TCC_PROJECT.py --root "C:\\Dev\\Blacklist_Narathiwat_Git"

This script does NOT change existing source files or contact the database.
It writes a short file-location report and a SQL inspection query.
"""

import argparse
import os
from collections import Counter
from datetime import datetime
from pathlib import Path
import re

EXCLUDED = {
    '.git', 'node_modules', 'dist', 'build', 'coverage', '.next',
    '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vscode',
}
EXTENSIONS = {'.jsx', '.tsx', '.js', '.ts', '.sql'}
# Print path + category + line numbers only. Never copy source lines or credentials.
PATTERNS = {
    'MONTHLY_SECTION_12': re.compile(r'Section12Editor|section_no\s*[,=:]\s*12|monthly_report_sections', re.I),
    'MONTHLY_REPORT': re.compile(r'\bmonthly_reports\b|\breport_month\b', re.I),
    'PROFILE_AUTH': re.compile(r'\bprofile\b|\bprofiles\b|\bAuthContext\b|supabase\.auth', re.I),
    'CENTER_ROLE': re.compile(r'\bcenter_id\b|\bcentercctv\b|\bsupervisor\b|\brepair_team_code\b', re.I),
    'DAILY_REPORT': re.compile(r'DailyReport|CameraStatusReport|daily_reports|daily_report', re.I),
    'STORAGE': re.compile(r'\.storage\.from\(|storage\.objects|storage\.buckets', re.I),
    'EXCEL': re.compile(r'\bexceljs\b|\bxlsx\b|xlsx-js-style', re.I),
    'TCC_DASHBOARD': re.compile(r'TCC_Dashboard_Report|tcc-dashboard', re.I),
}

SQL = r"""-- READ-ONLY: Run in Supabase Studio SQL Editor; share query results with developer.
-- No INSERT/UPDATE/DELETE. No API keys needed.

-- 1) Database columns needed for permissions, center mapping and Section 12.
SELECT table_schema, table_name, ordinal_position, column_name,
       data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('centers', 'profiles', 'monthly_reports',
                     'monthly_report_sections', 'daily_reports',
                     'center_daily_reports', 'tcc_daily_reports')
ORDER BY table_name, ordinal_position;

-- 2) Existing row level security. Please share the result of this query too.
SELECT schemaname, tablename, policyname, permissive,
       roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('centers', 'profiles', 'monthly_reports',
                    'monthly_report_sections', 'daily_reports',
                    'center_daily_reports', 'tcc_daily_reports')
ORDER BY tablename, policyname;

-- 3) Existing constraints and unique keys (to avoid duplicate daily records).
SELECT conrelid::regclass::text AS table_name, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('centers', 'profiles', 'monthly_reports',
                        'monthly_report_sections', 'daily_reports',
                        'center_daily_reports', 'tcc_daily_reports')
)
ORDER BY table_name, conname;

-- 4) Storage bucket names / limits. No file contents or credentials.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets ORDER BY id;
"""


def locate_root(arg):
    if arg:
        return Path(arg).expanduser().resolve()
    candidates = (Path.cwd(), Path(__file__).resolve().parent)
    for path in candidates:
        if (path / 'package.json').exists() or (path / 'src').is_dir():
            return path
    return Path.cwd()


def source_files(root):
    # Prune bulky dependency folders BEFORE descending into them.
    for directory, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d.lower() not in EXCLUDED]
        base = Path(directory)
        for filename in files:
            path = base / filename
            if path.suffix.lower() not in EXTENSIONS:
                continue
            if filename.startswith('.env'):
                continue
            try:
                if path.stat().st_size <= 1_200_000:
                    yield path
            except OSError:
                continue


def summarize(root):
    hits = []
    for path in source_files(root):
        try:
            lines = path.read_text(encoding='utf-8-sig').splitlines()
        except (OSError, UnicodeError):
            continue
        matches = {}
        for category, regex in PATTERNS.items():
            positions = [i for i, line in enumerate(lines, 1) if regex.search(line)]
            if positions:
                matches[category] = positions
        if not matches:
            continue
        rel = path.relative_to(root).as_posix()
        score = (
            25 * bool(matches.get('MONTHLY_SECTION_12')) +
            20 * bool(matches.get('TCC_DASHBOARD')) +
            15 * bool(matches.get('MONTHLY_REPORT')) +
            10 * bool(matches.get('PROFILE_AUTH')) +
            10 * bool(matches.get('CENTER_ROLE')) +
            8 * bool(matches.get('DAILY_REPORT')) +
            3 * bool(matches.get('STORAGE')) +
            2 * bool(matches.get('EXCEL'))
        )
        if re.search(r'App\.(jsx|tsx)|supabase\.(js|ts)|AuthContext|MonthlyReport|CenterCCTV|CameraStatusReport', rel, re.I):
            score += 35
        hits.append((score, rel, len(lines), matches))
    return sorted(hits, key=lambda r: (-r[0], r[1]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', help='Project root containing package.json and src/')
    args = parser.parse_args()
    root = locate_root(args.root)
    if not root.exists() or not ((root / 'src').is_dir() or (root / 'package.json').exists()):
        parser.error(f'Project root not found: {root}. Run inside the project folder or use --root')

    hits = summarize(root)
    output = root / 'TCC_FILES_TO_REVIEW.txt'
    sqlfile = root / 'CHECK_TCC_SCHEMA.sql'
    blocks = [
        'TCC DAILY DASHBOARD - READ ONLY SOURCE SCAN',
        f'Generated: {datetime.now().isoformat(timespec="seconds")}',
        f'Project: {root}',
        '',
        'This report contains FILE PATHS and MATCHED LINE NUMBERS only.',
        'It contains no source code, credentials, or database rows.',
        '',
        'ALREADY RECEIVED: TCC_Dashboard_Report.html, DailyReport.jsx,',
        'DailyReport.css, Section12Editor.jsx, Section12Editor.css.',
        '',
        'TOP CANDIDATES FOR ADDITIONAL REVIEW:',
    ]
    if hits:
        for score, rel, count, matches in hits[:45]:
            blocks.append(f'\n{rel}  ({count} lines)')
            for cat, nums in matches.items():
                shown = ', '.join(str(n) for n in nums[:12])
                if len(nums) > 12:
                    shown += f', ... (+{len(nums)-12})'
                blocks.append(f'  {cat}: {shown}')
    else:
        blocks.append('No matching source files found under project root.')

    blocks += [
        '',
        'SUGGESTED SOURCE FILES TO SEND (if found, not copies already received):',
        '1. src/lib/supabase.js (or the actual Supabase client file)',
        '2. Auth/profile owner: src/App.jsx or the actual auth context/provider',
        '3. The parent page that imports or renders Section12Editor',
        '4. src/pages/daily/CameraStatusReport.jsx (existing center / permissions pattern)',
        '5. package.json (dependencies only; DO NOT SEND .env files)',
        '6. SQL Studio results from CHECK_TCC_SCHEMA.sql',
        '',
        'Never send .env, service_role keys, access tokens or database passwords.',
    ]
    output.write_text('\n'.join(blocks) + '\n', encoding='utf-8')
    sqlfile.write_text(SQL, encoding='utf-8')
    print(f'[OK] Wrote: {output}')
    print(f'[OK] Wrote: {sqlfile}')
    print(f'[INFO] Matched source files: {len(hits)}')
    print('[SAFE] No project files were modified; no database connection was made.')


if __name__ == '__main__':
    main()
