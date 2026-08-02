-- ══════════════════════════════════════════════════════════════════════════════
-- Auto-expire dated compensation lectures and tombstones
--
-- Two categories of dated lecture rows are temporary:
--
--   1. Compensation lectures  (lecture_date IS NOT NULL, subject does NOT start
--      with __COMP_GIVEN__) — added to the leave-taker's schedule for one day.
--      Should vanish after that date so they don't pollute the permanent timetable.
--
--   2. Tombstone rows  (subject LIKE '__COMP_GIVEN__%') — suppress the proxy
--      teacher's fixed lecture for one specific date.
--      Must be deleted after that date so their recurring lecture reappears.
--
-- Strategy: a pg_cron job (or manual call) deletes past rows nightly.
-- As a fallback the Supabase Edge Function / client also triggers cleanup.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Cleanup function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_dated_lectures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete all dated lectures whose date is strictly in the past.
  -- This covers BOTH compensation lectures (added for the leave-taker)
  -- AND tombstone rows (suppressing the proxy teacher's fixed lecture).
  DELETE FROM public.lectures
  WHERE lecture_date IS NOT NULL
    AND lecture_date < CURRENT_DATE;
END;
$$;

-- Grant execute so authenticated users can call it from the client as a
-- last-resort cleanup (schedule.tsx calls it on mount).
GRANT EXECUTE ON FUNCTION public.cleanup_expired_dated_lectures() TO authenticated;

-- ── 2. Trigger: auto-delete a dated row the day AFTER its lecture_date ─────────
--
-- We use a statement-level trigger on INSERT so that any newly inserted dated
-- lecture row (compensation or tombstone) automatically schedules its own
-- expiry check. Because PostgreSQL doesn't support time-based triggers natively
-- we piggyback on the next INSERT into the lectures table to clean up rows
-- from the previous day onward.
--
-- This means the cleanup runs every time ANY lecture is inserted — lightweight
-- since it only deletes rows where lecture_date < CURRENT_DATE.

CREATE OR REPLACE FUNCTION public.trg_cleanup_expired_lectures_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete all expired dated rows whenever a new lecture is added
  DELETE FROM public.lectures
  WHERE lecture_date IS NOT NULL
    AND lecture_date < CURRENT_DATE;
  RETURN NULL; -- AFTER STATEMENT trigger; return value ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_expired_lectures ON public.lectures;

CREATE TRIGGER trg_cleanup_expired_lectures
  AFTER INSERT ON public.lectures
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_cleanup_expired_lectures_fn();

-- ── 3. Run cleanup immediately to remove any already-expired rows ──────────────
SELECT public.cleanup_expired_dated_lectures();

-- ── 4. (Optional) pg_cron job — uncomment if pg_cron extension is enabled ─────
-- SELECT cron.schedule(
--   'cleanup-expired-lectures',
--   '0 0 * * *',          -- midnight every day
--   'SELECT public.cleanup_expired_dated_lectures();'
-- );
