CREATE TYPE public.app_role AS ENUM ('teacher','hod','principal');
CREATE TYPE public.leave_type AS ENUM ('casual','maternity','bereavement','other');
CREATE TYPE public.leave_session AS ENUM ('full_day','forenoon','afternoon');
CREATE TYPE public.leave_status AS ENUM ('pending_hod','hod_recommended','approved','rejected');
CREATE TYPE public.proxy_status AS ENUM ('pending','accepted','rejected');

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  courses text NOT NULL DEFAULT '',
  classes text NOT NULL DEFAULT 'FY, SY, TY',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT SELECT ON public.departments TO anon;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id text NOT NULL UNIQUE,
  full_name text NOT NULL,
  designation text NOT NULL DEFAULT 'Assistant Professor',
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.my_department()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.dept_of(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.profiles WHERE id = _user_id;
$$;

CREATE TABLE public.lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  day_of_week int NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  subject text NOT NULL,
  class_name text NOT NULL,
  room text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lectures TO authenticated;
GRANT ALL ON public.lectures TO service_role;
ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL,
  occasion text NOT NULL,
  kind text NOT NULL DEFAULT 'National',
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  leave_type public.leave_type NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  session public.leave_session NOT NULL DEFAULT 'full_day',
  reason text NOT NULL,
  status public.leave_status NOT NULL DEFAULT 'pending_hod',
  total_days numeric NOT NULL DEFAULT 0,
  paid_days numeric NOT NULL DEFAULT 0,
  unpaid_days numeric NOT NULL DEFAULT 0,
  hod_note text,
  principal_note text,
  hod_acted_at timestamptz,
  principal_acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.proxy_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  lecture_id uuid REFERENCES public.lectures(id) ON DELETE SET NULL,
  proxy_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  subject text NOT NULL,
  class_name text NOT NULL,
  proxy_teacher_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.proxy_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proxy_assignments TO authenticated;
GRANT ALL ON public.proxy_assignments TO service_role;
ALTER TABLE public.proxy_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.count_working_days(_from date, _to date, _dept uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d date; n numeric := 0;
BEGIN
  d := _from;
  WHILE d <= _to LOOP
    IF EXTRACT(DOW FROM d) <> 0
       AND NOT EXISTS (
         SELECT 1 FROM public.holidays h
         WHERE h.holiday_date = d AND (h.department_id IS NULL OR h.department_id = _dept)
       )
    THEN n := n + 1;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_leave_accounting()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  days numeric;
  used_month numeric := 0;
  used_year numeric := 0;
  yearly_cap numeric;
  remaining numeric;
BEGIN
  NEW.department_id := public.dept_of(NEW.teacher_id);
  days := public.count_working_days(NEW.from_date, NEW.to_date, NEW.department_id);
  IF NEW.session <> 'full_day' THEN
    days := LEAST(days, 1) * 0.5;
  END IF;
  NEW.total_days := days;

  SELECT COALESCE(SUM(total_days),0) INTO used_year
  FROM public.leave_requests
  WHERE teacher_id = NEW.teacher_id AND leave_type = NEW.leave_type
    AND status <> 'rejected' AND id <> NEW.id
    AND date_part('year', from_date) = date_part('year', NEW.from_date);

  SELECT COALESCE(SUM(total_days),0) INTO used_month
  FROM public.leave_requests
  WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
    AND status <> 'rejected' AND id <> NEW.id
    AND date_trunc('month', from_date) = date_trunc('month', NEW.from_date);

  yearly_cap := CASE NEW.leave_type
    WHEN 'casual' THEN 12 WHEN 'maternity' THEN 90
    WHEN 'bereavement' THEN 5 ELSE 7 END;

  remaining := GREATEST(yearly_cap - used_year, 0);
  IF NEW.leave_type = 'casual' THEN
    remaining := LEAST(remaining, GREATEST(2 - used_month, 0));
  END IF;

  NEW.paid_days := LEAST(days, remaining);
  NEW.unpaid_days := days - NEW.paid_days;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leave_accounting
BEFORE INSERT OR UPDATE OF from_date, to_date, session, leave_type
ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.apply_leave_accounting();

CREATE OR REPLACE FUNCTION public.register_profile(_user_id text, _full_name text, _designation text, _department_id uuid, _role public.app_role)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE final_role public.app_role := _role;
        final_dept uuid := _department_id;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF _role = 'principal' THEN
    final_dept := NULL;
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'principal' AND user_id <> auth.uid()) THEN
      RAISE EXCEPTION 'A principal is already registered for this college';
    END IF;
  ELSE
    IF final_dept IS NULL THEN
      RAISE EXCEPTION 'Please select a department';
    END IF;
    IF _role = 'hod' AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE role = 'hod' AND department_id = final_dept AND user_id <> auth.uid()
    ) THEN
      RAISE EXCEPTION 'This department already has a HOD';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, user_id, full_name, designation, department_id)
  VALUES (auth.uid(), _user_id, _full_name, _designation, final_dept)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name, designation = EXCLUDED.designation,
        department_id = EXCLUDED.department_id;

  INSERT INTO public.user_roles (user_id, role, department_id)
  VALUES (auth.uid(), final_role, final_dept)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN final_role::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_department() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dept_of(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.count_working_days(date, date, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_profile(text, text, text, uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_leave_accounting() FROM anon, authenticated;

CREATE POLICY "read departments" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "public read departments" ON public.departments FOR SELECT TO anon USING (true);
CREATE POLICY "principal manages departments" ON public.departments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'principal')) WITH CHECK (public.has_role(auth.uid(),'principal'));

CREATE POLICY "read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "read lectures" ON public.lectures FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage own lectures" ON public.lectures FOR ALL TO authenticated
  USING (teacher_id = auth.uid() OR (public.has_role(auth.uid(),'hod') AND department_id = public.my_department()) OR public.has_role(auth.uid(),'principal'))
  WITH CHECK (teacher_id = auth.uid() OR (public.has_role(auth.uid(),'hod') AND department_id = public.my_department()) OR public.has_role(auth.uid(),'principal'));

CREATE POLICY "read holidays" ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage holidays" ON public.holidays FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'principal') OR (public.has_role(auth.uid(),'hod') AND department_id = public.my_department()))
  WITH CHECK (public.has_role(auth.uid(),'principal') OR (public.has_role(auth.uid(),'hod') AND department_id = public.my_department()));

CREATE POLICY "read leaves" ON public.leave_requests FOR SELECT TO authenticated USING (
  teacher_id = auth.uid()
  OR public.has_role(auth.uid(),'principal')
  OR (public.has_role(auth.uid(),'hod') AND department_id = public.my_department())
);
CREATE POLICY "create own leave" ON public.leave_requests FOR INSERT TO authenticated WITH CHECK (teacher_id = auth.uid());
CREATE POLICY "approvers update leaves" ON public.leave_requests FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'principal')
  OR (public.has_role(auth.uid(),'hod') AND department_id = public.my_department())
);
CREATE POLICY "cancel own pending leave" ON public.leave_requests FOR DELETE TO authenticated
  USING (teacher_id = auth.uid() AND status = 'pending_hod');

CREATE POLICY "read proxies" ON public.proxy_assignments FOR SELECT TO authenticated USING (
  proxy_teacher_id = auth.uid()
  OR public.has_role(auth.uid(),'principal')
  OR public.has_role(auth.uid(),'hod')
  OR EXISTS (SELECT 1 FROM public.leave_requests l WHERE l.id = leave_request_id AND l.teacher_id = auth.uid())
);
CREATE POLICY "hod manages proxies" ON public.proxy_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'hod') OR public.has_role(auth.uid(),'principal'))
  WITH CHECK (public.has_role(auth.uid(),'hod') OR public.has_role(auth.uid(),'principal'));
CREATE POLICY "proxy teacher responds" ON public.proxy_assignments FOR UPDATE TO authenticated
  USING (proxy_teacher_id = auth.uid());

INSERT INTO public.departments (name, courses, classes) VALUES
  ('Computer Science','B.Sc, M.Sc','FY, SY, TY'),
  ('Information Technology','B.Sc, M.Sc','FY, SY, TY'),
  ('Electronics','B.Sc, M.Sc','FY, SY, TY'),
  ('Mechanical','B.Tech','FY, SY, TY'),
  ('Civil','B.Tech','FY, SY, TY'),
  ('Artificial Intelligence','B.Tech','FY, SY, TY');

INSERT INTO public.holidays (holiday_date, occasion, kind) VALUES
  ('2026-01-26','Republic Day','National'),
  ('2026-03-04','Holi','National'),
  ('2026-03-21','Id-ul-Fitr','National'),
  ('2026-04-14','Dr. Ambedkar Jayanti','National'),
  ('2026-05-01','Maharashtra Day','National'),
  ('2026-05-27','Id-ul-Zuha','National'),
  ('2026-08-15','Independence Day','National'),
  ('2026-09-14','Ganesh Chaturthi','National'),
  ('2026-10-02','Gandhi Jayanti','National'),
  ('2026-11-08','Diwali','National'),
  ('2026-11-09','Diwali (Balipratipada)','National'),
  ('2026-12-25','Christmas','National');