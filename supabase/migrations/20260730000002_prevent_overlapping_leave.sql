-- ============================================================
-- Fix: Prevent overlapping leave requests for the same teacher
--
-- Rule:
--   A teacher CANNOT apply for leave on dates that are already
--   covered by an active (non-rejected) leave request.
--   If a previous request was rejected, they can apply again.
--
-- "Active" means status NOT IN ('rejected').
-- We enforce this via a BEFORE INSERT trigger that raises an
-- exception if any date overlap exists with an active leave.
--
-- Why a trigger and not a constraint index?
--   Date-range exclusion constraints in Postgres require the
--   btree_gist extension and work cleanly for simple cases.
--   However, we need to exclude 'rejected' rows, which isn't
--   directly possible in an exclusion constraint's WHERE clause
--   combined with a multi-column condition in Supabase's managed
--   Postgres. A trigger gives us clear error messaging too.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_overlapping_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  overlap_id   uuid;
  overlap_from date;
  overlap_to   date;
BEGIN
  -- Find any active (non-rejected) leave request by the same teacher
  -- whose date range overlaps with the new request.
  SELECT id, from_date, to_date
    INTO overlap_id, overlap_from, overlap_to
    FROM public.leave_requests
   WHERE teacher_id = NEW.teacher_id
     AND status <> 'rejected'
     AND id <> NEW.id          -- allow trigger to fire on UPDATE too
     AND from_date <= NEW.to_date
     AND to_date   >= NEW.from_date
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'You already have an active leave request (%) from % to %. '
      'Please wait for it to be resolved or cancel it before applying again.',
      overlap_id,
      to_char(overlap_from, 'DD Mon YYYY'),
      to_char(overlap_to,   'DD Mon YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_overlapping_leave() FROM anon, authenticated;

-- Fire BEFORE INSERT so the insert is aborted cleanly.
-- Also fire on UPDATE of the date range in case an admin/HOD edits dates.
DROP TRIGGER IF EXISTS prevent_overlapping_leave_trigger ON public.leave_requests;
CREATE TRIGGER prevent_overlapping_leave_trigger
  BEFORE INSERT OR UPDATE OF from_date, to_date
  ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_overlapping_leave();
