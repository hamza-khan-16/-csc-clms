-- ============================================================
-- Compensation Assignments
-- When a teacher (proxy) covers a colleague's leave, they may
-- "gift" one of their own upcoming lectures to that colleague
-- as compensation. HOD can see and manage these.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.compensation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_assignment_id uuid NOT NULL REFERENCES public.proxy_assignments(id) ON DELETE CASCADE,
  from_teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
  compensation_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compensation_assignments TO authenticated;
GRANT ALL ON public.compensation_assignments TO service_role;
ALTER TABLE public.compensation_assignments ENABLE ROW LEVEL SECURITY;

-- Proxy teacher (from) can create and manage their own offers
CREATE POLICY "proxy teacher manages own compensation"
  ON public.compensation_assignments FOR ALL TO authenticated
  USING (from_teacher_id = auth.uid())
  WITH CHECK (from_teacher_id = auth.uid());

-- Recipient teacher can view offers sent to them
CREATE POLICY "recipient views own compensation"
  ON public.compensation_assignments FOR SELECT TO authenticated
  USING (to_teacher_id = auth.uid());

-- Recipient teacher can accept or reject
CREATE POLICY "recipient responds to compensation"
  ON public.compensation_assignments FOR UPDATE TO authenticated
  USING (to_teacher_id = auth.uid())
  WITH CHECK (to_teacher_id = auth.uid());

-- HOD, principal, admin can view all
-- NOTE: has_role signature is has_role(uuid, app_role)
CREATE POLICY "approvers view all compensation"
  ON public.compensation_assignments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'hod'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );
