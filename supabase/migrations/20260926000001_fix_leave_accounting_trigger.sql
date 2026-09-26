-- Fix 1: Trigger was missing payment_decision in UPDATE OF column list.
-- Fix 2: Yearly casual quota now reads cl_quota from profiles (admin-set, default 12).
-- Fix 3: Unpaid leaves deduct ALL calendar days including Sundays/holidays.
-- Fix 4: Cross-month leaves now split days per calendar month for quota calculation.
--         e.g. 28 Sept–3 Oct: 3 days counted against Sept quota, 3 against Oct quota.

CREATE OR REPLACE FUNCTION public.apply_leave_accounting()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  all_days      numeric;
  yearly_quota  integer;
  used_year     numeric := 0;
  remaining     numeric := 0;
  paid          numeric := 0;

  -- For cross-month split
  cur_month_start date;
  cur_month_end   date;
  month_days      numeric;
  used_month      numeric;
  month_remaining numeric;
BEGIN
  NEW.department_id := public.dept_of(NEW.teacher_id);

  -- Total calendar days (includes Sundays/holidays — unpaid loses every day)
  all_days := (NEW.to_date - NEW.from_date) + 1;
  IF NEW.session <> 'full_day' THEN
    all_days := LEAST(all_days, 1) * 0.5;
  END IF;
  NEW.total_days := all_days;

  IF NEW.leave_type = 'casual' THEN
    -- Admin-set yearly quota per teacher (default 12)
    SELECT COALESCE(cl_quota, 12) INTO yearly_quota
    FROM public.profiles WHERE id = NEW.teacher_id;

    -- Total casual days used this year across all months (for yearly cap)
    SELECT COALESCE(SUM(total_days), 0) INTO used_year
    FROM public.leave_requests
    WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
      AND status <> 'rejected' AND id <> NEW.id
      AND date_part('year', from_date) = date_part('year', NEW.from_date);

    IF NEW.payment_decision = 'unpaid' THEN
      -- Principal decided unpaid — all days are unpaid regardless of quota
      NEW.paid_days   := 0;
      NEW.unpaid_days := all_days;

    ELSIF NEW.payment_decision = 'paid' THEN
      -- Principal decided paid — all days are paid regardless of quota
      NEW.paid_days   := all_days;
      NEW.unpaid_days := 0;

    ELSE
      -- No principal decision yet — calculate based on quota
      -- Split the leave across calendar months and check each month's 2-day limit
      paid := 0;
      cur_month_start := date_trunc('month', NEW.from_date)::date;

      LOOP
        -- Last day of current month being processed
        cur_month_end := (date_trunc('month', cur_month_start) + interval '1 month' - interval '1 day')::date;

        -- Days of THIS leave that fall in this month
        month_days := (LEAST(NEW.to_date, cur_month_end) - GREATEST(NEW.from_date, cur_month_start)) + 1;

        -- How many casual days already used in this month (other leaves)
        SELECT COALESCE(SUM(
          -- For cross-month leaves, count only the days that fall in this month
          LEAST(to_date, cur_month_end) - GREATEST(from_date, cur_month_start) + 1
        ), 0) INTO used_month
        FROM public.leave_requests
        WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
          AND status <> 'rejected' AND id <> NEW.id
          AND from_date <= cur_month_end
          AND to_date   >= cur_month_start
          AND date_part('year', from_date) = date_part('year', NEW.from_date);

        -- Monthly cap: 2 days per month, also bounded by yearly remaining
        month_remaining := LEAST(
          GREATEST(2 - used_month, 0),
          GREATEST(yearly_quota - used_year - paid, 0)
        );

        -- Paid days from this month's portion
        paid := paid + LEAST(month_days, month_remaining);

        -- Move to next month
        cur_month_start := (date_trunc('month', cur_month_start) + interval '1 month')::date;
        EXIT WHEN cur_month_start > NEW.to_date;
      END LOOP;

      NEW.paid_days   := LEAST(paid, all_days);
      NEW.unpaid_days := all_days - NEW.paid_days;
    END IF;

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

DROP TRIGGER IF EXISTS leave_accounting ON public.leave_requests;
CREATE TRIGGER leave_accounting
BEFORE INSERT OR UPDATE OF from_date, to_date, session, leave_type, payment_decision
ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.apply_leave_accounting();
