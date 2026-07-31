-- ============================================================
-- Enforce: leave requests cannot be applied for past dates
--
-- Rule: from_date must be >= current date (in IST / server local date).
-- Applied on INSERT only — admin back-fills and system-generated
-- records (e.g. auto-approve) are handled via SECURITY DEFINER
-- functions that bypass this trigger, so we limit it to the
-- authenticated INSERT path via a separate trigger condition.
--
-- mark-leave (HOD/Principal) also uses INSERT, but those are
-- legitimate same-day or future records, so the rule still holds.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_past_date_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.from_date < CURRENT_DATE THEN
    RAISE EXCEPTION
      'Leave cannot be applied for a past date (%). Please select today or a future date.',
      to_char(NEW.from_date, 'DD Mon YYYY')
      USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_past_date_leave() FROM anon, authenticated;

DROP TRIGGER IF EXISTS prevent_past_date_leave_trigger ON public.leave_requests;
CREATE TRIGGER prevent_past_date_leave_trigger
  BEFORE INSERT
  ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_past_date_leave();
