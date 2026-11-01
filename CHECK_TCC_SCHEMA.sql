-- READ-ONLY: Run in Supabase Studio SQL Editor; share query results with developer.
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
