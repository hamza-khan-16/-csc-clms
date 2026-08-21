-- Password change requests table
-- Teachers request → HOD approves
-- HOD / Principal request → Admin approves
-- Admin cannot change their own password (enforced in application layer)

CREATE TABLE IF NOT EXISTS public.password_change_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  new_password_temp text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  hod_id           uuid REFERENCES public.profiles(id),
  hod_note         text,
  acted_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.password_change_requests TO authenticated;
GRANT UPDATE (status, hod_id, hod_note, acted_at, new_password_temp) ON public.password_change_requests TO authenticated;
GRANT ALL ON public.password_change_requests TO service_role;

ALTER TABLE public.password_change_requests ENABLE ROW LEVEL SECURITY;

-- Users can see their own requests
CREATE POLICY "teacher_see_own_pw_requests"
  ON public.password_change_requests FOR SELECT
  USING (teacher_id = auth.uid());

-- Users can insert their own requests (admin blocked in app layer)
CREATE POLICY "teacher_insert_pw_requests"
  ON public.password_change_requests FOR INSERT
  WITH CHECK (teacher_id = auth.uid());

-- HOD and admin can see all pending requests
-- (app layer filters: HOD sees only teachers in their dept; admin sees only hod/principal)
CREATE POLICY "hod_see_pw_requests"
  ON public.password_change_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('hod', 'admin')
    )
  );

-- HOD and admin can update (approve/reject)
CREATE POLICY "hod_update_pw_requests"
  ON public.password_change_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('hod', 'admin')
    )
  );

-- Single principal constraint
CREATE UNIQUE INDEX IF NOT EXISTS unique_principal
  ON public.user_roles (role)
  WHERE role = 'principal';

-- Single admin constraint
CREATE UNIQUE INDEX IF NOT EXISTS unique_admin
  ON public.user_roles (role)
  WHERE role = 'admin';
