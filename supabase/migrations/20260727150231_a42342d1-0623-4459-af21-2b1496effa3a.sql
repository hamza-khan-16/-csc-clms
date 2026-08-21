ALTER TABLE public.profiles ADD COLUMN monthly_salary numeric NOT NULL DEFAULT 60000;
ALTER TABLE public.lectures ADD COLUMN lecture_date date;
ALTER TABLE public.leave_requests
  ADD COLUMN payment_decision text CHECK (payment_decision IN ('paid','unpaid')),
  ADD COLUMN applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.apply_leave_accounting()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  days numeric;
  used_month numeric := 0;
  used_year numeric := 0;
  remaining numeric;
BEGIN
  NEW.department_id := public.dept_of(NEW.teacher_id);
  days := public.count_working_days(NEW.from_date, NEW.to_date, NEW.department_id);
  IF NEW.session <> 'full_day' THEN
    days := LEAST(days, 1) * 0.5;
  END IF;
  NEW.total_days := days;

  IF NEW.leave_type = 'casual' THEN
    SELECT COALESCE(SUM(total_days),0) INTO used_year
    FROM public.leave_requests
    WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
      AND status <> 'rejected' AND id <> NEW.id
      AND date_part('year', from_date) = date_part('year', NEW.from_date);

    SELECT COALESCE(SUM(total_days),0) INTO used_month
    FROM public.leave_requests
    WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
      AND status <> 'rejected' AND id <> NEW.id
      AND date_trunc('month', from_date) = date_trunc('month', NEW.from_date);

    remaining := LEAST(GREATEST(12 - used_year, 0), GREATEST(2 - used_month, 0));
    IF NEW.payment_decision = 'unpaid' THEN
      remaining := 0;
    ELSIF NEW.payment_decision = 'paid' THEN
      remaining := days;
    END IF;
    NEW.paid_days := LEAST(days, remaining);
    NEW.unpaid_days := days - NEW.paid_days;
  ELSE
    IF NEW.payment_decision = 'paid' THEN
      NEW.paid_days := days;
      NEW.unpaid_days := 0;
    ELSIF NEW.payment_decision = 'unpaid' THEN
      NEW.paid_days := 0;
      NEW.unpaid_days := days;
    ELSE
      NEW.paid_days := 0;
      NEW.unpaid_days := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_accounting ON public.leave_requests;
CREATE TRIGGER leave_accounting
BEFORE INSERT OR UPDATE OF from_date, to_date, session, leave_type, payment_decision
ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.apply_leave_accounting();

REVOKE EXECUTE ON FUNCTION public.apply_leave_accounting() FROM anon, authenticated;

DROP POLICY IF EXISTS "create own leave" ON public.leave_requests;
CREATE POLICY "create leave" ON public.leave_requests FOR INSERT TO authenticated WITH CHECK (
  teacher_id = auth.uid()
  OR public.has_role(auth.uid(),'principal')
  OR (public.has_role(auth.uid(),'hod') AND public.dept_of(teacher_id) = public.my_department())
);

CREATE TABLE public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notices TO authenticated;
GRANT ALL ON public.notices TO service_role;
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read notices" ON public.notices FOR SELECT TO authenticated USING (
  department_id IS NULL OR department_id = public.my_department()
);
CREATE POLICY "principal posts notices" ON public.notices FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'principal') AND created_by = auth.uid());
CREATE POLICY "hod posts dept notices" ON public.notices FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'hod') AND created_by = auth.uid() AND department_id = public.my_department());
CREATE POLICY "delete own notices" ON public.notices FOR DELETE TO authenticated
  USING (created_by = auth.uid());