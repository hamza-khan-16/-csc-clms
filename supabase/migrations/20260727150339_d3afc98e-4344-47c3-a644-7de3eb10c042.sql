ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;
UPDATE public.profiles SET approved = true WHERE approved = false;

CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT approved FROM public.profiles WHERE id = _user_id), false);
$$;

CREATE OR REPLACE FUNCTION public.register_profile(_user_id text, _full_name text, _designation text, _department_id uuid, _role app_role)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE final_dept uuid := _department_id;
        is_approved boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF _role = 'admin' THEN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin' AND user_id <> auth.uid()) THEN
      RAISE EXCEPTION 'An administrator is already registered for this college';
    END IF;
    final_dept := NULL;
    is_approved := true;
  ELSIF _role = 'teacher' THEN
    IF final_dept IS NULL THEN RAISE EXCEPTION 'Please select a department'; END IF;
    is_approved := false;
  ELSE
    RAISE EXCEPTION 'HOD and principal accounts can only be created by the administrator';
  END IF;

  INSERT INTO public.profiles (id, user_id, full_name, designation, department_id, approved)
  VALUES (auth.uid(), _user_id, _full_name, _designation, final_dept, is_approved)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name, designation = EXCLUDED.designation,
        department_id = EXCLUDED.department_id;

  INSERT INTO public.user_roles (user_id, role, department_id)
  VALUES (auth.uid(), _role, final_dept)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _role::text;
END;
$$;

GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT DELETE ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "admin manages profiles" ON public.profiles;
CREATE POLICY "admin manages profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin manages roles" ON public.user_roles;
CREATE POLICY "admin manages roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin manages departments" ON public.departments;
CREATE POLICY "admin manages departments" ON public.departments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin manages holidays" ON public.holidays;
CREATE POLICY "admin manages holidays" ON public.holidays FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin manages notices" ON public.notices;
CREATE POLICY "admin manages notices" ON public.notices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin manages leaves" ON public.leave_requests;
CREATE POLICY "admin manages leaves" ON public.leave_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin manages lectures" ON public.lectures;
CREATE POLICY "admin manages lectures" ON public.lectures FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin manages proxies" ON public.proxy_assignments;
CREATE POLICY "admin manages proxies" ON public.proxy_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "create leave" ON public.leave_requests;
CREATE POLICY "create leave" ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    ((teacher_id = auth.uid()) AND public.is_approved(auth.uid()))
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'hod') AND (public.dept_of(teacher_id) = public.my_department()))
  );

-- Issue a college ID when a registration is accepted
CREATE OR REPLACE FUNCTION public.assign_college_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE base text;
        candidate text;
        n int := 1;
BEGIN
  IF NEW.approved AND (TG_OP = 'INSERT' OR COALESCE(OLD.approved, false) = false) THEN
    base := lower(regexp_replace(split_part(btrim(NEW.full_name), ' ', 1), '[^a-zA-Z0-9]', '', 'g'));
    IF base = '' THEN base := 'staff'; END IF;
    candidate := base || '@CSC.COM';
    WHILE EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = candidate AND p.id <> NEW.id) LOOP
      n := n + 1;
      candidate := base || n::text || '@CSC.COM';
    END LOOP;
    NEW.user_id := candidate;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_college_id() FROM anon, authenticated;

DROP TRIGGER IF EXISTS assign_college_id_trigger ON public.profiles;
CREATE TRIGGER assign_college_id_trigger
BEFORE INSERT OR UPDATE OF approved ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.assign_college_id();