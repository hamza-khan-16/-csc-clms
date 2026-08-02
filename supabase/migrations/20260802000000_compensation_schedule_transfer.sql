-- ── Compensation schedule transfer ───────────────────────────────────────────
--
-- When a proxy teacher accepts and then the leave-taker accepts compensation:
--
--   1. A dated lecture row is inserted for the leave-taker on the compensation
--      date — they now appear as teaching that slot in the schedule.
--
--   2. For recurring (fixed) lectures a tombstone row is inserted:
--        subject = '__COMP_GIVEN__<original subject>'
--      This tells the frontend to suppress the proxy teacher's fixed lecture
--      on that specific date only, without deleting their recurring schedule.
--
-- No schema changes needed — lecture_date and subject columns already exist.
-- This migration exists solely to document the tombstone convention.

-- Add an index to speed up dated-lecture lookups by teacher + date
-- (also helps the tombstone filter query)
CREATE INDEX IF NOT EXISTS idx_lectures_teacher_lecture_date
  ON public.lectures (teacher_id, lecture_date)
  WHERE lecture_date IS NOT NULL;

-- Add an index for fixed lecture lookups (no lecture_date)
CREATE INDEX IF NOT EXISTS idx_lectures_teacher_day
  ON public.lectures (teacher_id, day_of_week)
  WHERE lecture_date IS NULL;
