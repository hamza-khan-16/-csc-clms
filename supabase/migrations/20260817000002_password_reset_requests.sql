-- ============================================================
-- Password reset requests: teacher submits a request,
-- admin sees it and sets a temporary password directly.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  college_id  text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- Teacher can insert their own request
CREATE POLICY "teacher inserts own reset request"
  ON public.password_reset_requests FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid());

-- Admin can read all, update status
CREATE POLICY "admin reads reset requests"
  ON public.password_reset_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin updates reset requests"
  ON public.password_reset_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
