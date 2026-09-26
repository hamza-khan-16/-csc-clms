-- Fix 1: Trigger was missing payment_decision in UPDATE OF column list.
--         Updating payment_decision alone didn't fire the trigger, so the
--         principal's paid/unpaid decision had no effect on paid_days/unpaid_days.
--
-- Fix 2: Yearly casual leave quota was hardcoded as 12. It now reads cl_quota
--         from the teacher's profile (set by admin). Falls back to 12 if not set.
--
-- Fix 3: When principal decides UNPAID, ALL calendar days in the leave range are
--         deducted including Sundays and holidays sandwiched in the leave.

CREATE OR REPLACE FUNCTION public.apply_leave_accounting()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  all_days    numeric;
  used_month  numeric := 0;
  used_year   numeric := 0;
  yearly_quota integer;
  remaining   numeric;
BEGIN
  NEW.department_id := public.dept_of(NEW.teacher_id);

  -- Count every calendar day in the range (includes Sundays and holidays).
  -- Unpaid leaves deduct every day the teacher was absent.
  all_days := (NEW.to_date - NEW.from_date) + 1;

  IF NEW.session <> 'full_day' THEN
    all_days := LEAST(all_days, 1) * 0.5;
  END IF;
  NEW.total_days := all_days;

  IF NEW.leave_type = 'casual' THEN
    -- Read admin-configured yearly quota for this teacher (default 12 if not set)
    SELECT COALESCE(cl_quota, 12) INTO yearly_quota
    FROM public.profiles
    WHERE id = NEW.teacher_id;

    SELECT COALESCE(SUM(total_days), 0) INTO used_year
    FROM public.leave_requests
    WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
      AND status <> 'rejected' AND id <> NEW.id
      AND date_part('year', from_date) = date_part('year', NEW.from_date);

    SELECT COALESCE(SUM(total_days), 0) INTO used_month
    FROM public.leave_requests
    WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
      AND status <> 'rejected' AND id <> NEW.id
      AND date_trunc('month', from_date) = date_trunc('month', NEW.from_date);

    -- Base remaining from admin-set yearly quota and fixed 2/month limit
    remaining := LEAST(GREATEST(yearly_quota - used_year, 0), GREATEST(2 - used_month, 0));

    -- Principal's decision always overrides the quota calculation
    IF    NEW.payment_decision = 'unpaid' THEN remaining := 0;
    ELSIF NEW.payment_decision = 'paid'   THEN remaining := all_days;
    END IF;

    NEW.paid_days   := LEAST(all_days, remaining);
    NEW.unpaid_days := all_days - NEW.paid_days;

  ELSE
    -- Non-casual: purely based on principal's payment_decision
    IF    NEW.payment_decision = 'paid'   THEN NEW.paid_days := all_days; NEW.unpaid_days := 0;
    ELSIF NEW.payment_decision = 'unpaid' THEN NEW.paid_days := 0;        NEW.unpaid_days := all_days;
    ELSE                                       NEW.paid_days := 0;        NEW.unpaid_days := 0;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate trigger with payment_decision in the UPDATE OF column list.
-- This is critical — without it, updating payment_decision doesn't fire the trigger.
DROP TRIGGER IF EXISTS leave_accounting ON public.leave_requests;
CREATE TRIGGER leave_accounting
BEFORE INSERT OR UPDATE OF from_date, to_date, session, leave_type, payment_decision
ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.apply_leave_accounting();
