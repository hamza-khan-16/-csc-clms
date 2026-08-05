-- ── LMS Improvements Migration ────────────────────────────────────────────────

-- 1. Make reason optional
ALTER TABLE leave_requests
  ALTER COLUMN reason DROP NOT NULL;

-- 2. Backfill total_days = 0 rows
UPDATE leave_requests
  SET total_days = (to_date::date - from_date::date + 1)
  WHERE total_days = 0
    AND from_date IS NOT NULL
    AND to_date IS NOT NULL
    AND from_date <= to_date;

-- 3. Performance indexes
CREATE INDEX IF NOT EXISTS idx_leave_requests_teacher_type_status
  ON leave_requests (teacher_id, leave_type, status);

CREATE INDEX IF NOT EXISTS idx_proxy_assignments_leave_date
  ON proxy_assignments (leave_request_id, proxy_date);

-- 4. Default session
UPDATE leave_requests SET session = 'full_day' WHERE session IS NULL;
ALTER TABLE leave_requests ALTER COLUMN session SET DEFAULT 'full_day';

-- 5. Deduplicate proxy assignments
DELETE FROM proxy_assignments
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY leave_request_id, lecture_id, proxy_date, proxy_teacher_id
               ORDER BY created_at DESC
             ) AS rn
      FROM proxy_assignments
    ) ranked
    WHERE rn > 1
  );
