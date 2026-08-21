-- ============================================================
-- Medical Leave Paid Quota: 10 days per year auto-paid
--
-- Rule:
--   Each teacher gets 10 paid medical leave days per year.
--   Days within that quota are always paid (paid_days = total_days,
--   unpaid_days = 0) — no principal decision required.
--   Days BEYOND the quota require the principal to decide
--   paid or unpaid (enforced in the frontend via medicalSplit).
--
-- This migration adds a helper function that the frontend can
-- call (or triggers can use) to compute the split, and also
-- adjusts the paid/unpaid columns when a medical leave is
-- approved without an explicit payment_decision (i.e. within quota).
-- ============================================================

/**
 * Returns how many medical leave days a teacher has already taken
 * this calendar year (approved or hod_approved, excluding rejected).
 */
CREATE OR REPLACE FUNCTION public.medical_days_taken_this_year(_teacher_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(total_days)::integer,
    0
  )
  FROM public.leave_requests
  WHERE teacher_id = _teacher_id
    AND leave_type = 'medical'
    AND status IN ('hod_approved', 'approved')
    AND EXTRACT(YEAR FROM from_date) = EXTRACT(YEAR FROM CURRENT_DATE);
$$;

GRANT EXECUTE ON FUNCTION public.medical_days_taken_this_year(uuid) TO authenticated;

/**
 * Auto-set paid_days / unpaid_days for medical leaves based on the
 * 10-day paid quota. Called BEFORE INSERT on leave_requests
 * so that the initial paid_days/unpaid_days are set correctly
 * even before the principal acts.
 *
 * The principal's explicit decision (via UPDATE) takes precedence
 * for over-quota days.
 */
CREATE OR REPLACE FUNCTION public.set_medical_leave_quota_days()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  already_taken  integer;
  quota          integer := 10;
  within_quota   integer;
  over_quota     integer;
BEGIN
  -- Only applies to medical leaves
  IF NEW.leave_type <> 'medical' THEN
    RETURN NEW;
  END IF;

  -- How many medical days has this teacher already used this year?
  SELECT public.medical_days_taken_this_year(NEW.teacher_id)
    INTO already_taken;

  -- Compute split
  within_quota := GREATEST(0, LEAST(NEW.total_days::integer, quota - already_taken));
  over_quota   := NEW.total_days::integer - within_quota;

  -- Set initial paid/unpaid — over-quota days default to paid until
  -- principal explicitly marks them as unpaid
  NEW.paid_days   := within_quota + over_quota;  -- tentatively all paid
  NEW.unpaid_days := 0;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_medical_leave_quota_days_trigger ON public.leave_requests;
CREATE TRIGGER set_medical_leave_quota_days_trigger
  BEFORE INSERT
  ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_medical_leave_quota_days();
