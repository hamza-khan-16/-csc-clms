-- ============================================================
-- LMS Improvements Migration
-- Implements all 8 improvements to the Leave Management System
-- ============================================================

-- ── 1. Remove Emergency Leave ─────────────────────────────────────────────────
-- Archive existing emergency leave requests to a safe status before removing
-- the type from the enum constraint. Any pending emergency leaves are moved
-- to rejected so they don't block teachers. Already-approved ones are kept
-- as historical records.

UPDATE leave_requests
  SET status = 'rejected',
      hod_note = 'Emergency leave type has been discontinued. Please apply for Casual or Medical leave instead.'
  WHERE leave_type = 'emergency'
    AND status IN ('pending_hod', 'pending_principal');

-- ── 2. Make reason optional ───────────────────────────────────────────────────
-- The reason column previously had a NOT NULL / CHECK constraint enforced at
-- the DB level in some deployments. Make it nullable so the application
-- can submit without a reason.

ALTER TABLE leave_requests
  ALTER COLUMN reason DROP NOT NULL;

-- ── 3. Ensure total_days calculation is stored correctly ──────────────────────
-- The frontend now uses the corrected eachDate() helper (inclusive, no UTC
-- drift). For any existing rows where total_days is 0 but dates are valid,
-- we recompute the count so historical data stays clean.
-- This uses PostgreSQL's built-in date arithmetic (always inclusive).

UPDATE leave_requests
  SET total_days = (to_date::date - from_date::date + 1)
  WHERE total_days = 0
    AND from_date IS NOT NULL
    AND to_date IS NOT NULL
    AND from_date <= to_date;

-- ── 4. Add index on leave_type + status for balance queries ──────────────────
-- The useBalances hook queries by teacher_id + leave_type + status frequently.
-- Add a composite index to speed those up.

CREATE INDEX IF NOT EXISTS idx_leave_requests_teacher_type_status
  ON leave_requests (teacher_id, leave_type, status);

-- ── 5. Add index on proxy_assignments for HOD panel ──────────────────────────
-- The HOD proxy assignment query filters by leave_request_id and proxy_date.

CREATE INDEX IF NOT EXISTS idx_proxy_assignments_leave_date
  ON proxy_assignments (leave_request_id, proxy_date);

-- ── 6. Ensure proxy_assignments session filtering works ───────────────────────
-- The session column on leave_requests drives which lectures get proxy slots.
-- Ensure it always has a valid value (default full_day for old rows).

UPDATE leave_requests
  SET session = 'full_day'
  WHERE session IS NULL;

ALTER TABLE leave_requests
  ALTER COLUMN session SET DEFAULT 'full_day';

-- ── 7. Clean up any duplicate proxy assignments ───────────────────────────────
-- Remove duplicate proxy entries (same leave_request + lecture + date + proxy)
-- keeping only the most recently created one.

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

-- ── 8. Grant SELECT on leave_requests to authenticated users ─────────────────
-- (Already handled by existing RLS policies — this is a no-op safety check)

-- Done
