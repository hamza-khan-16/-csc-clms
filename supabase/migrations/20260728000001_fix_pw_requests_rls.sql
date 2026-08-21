-- Fix overlapping RLS policies on password_change_requests
-- Drop old policies and replace with unified ones

DROP POLICY IF EXISTS "teacher_see_own_pw_requests" ON public.password_change_requests;
DROP POLICY IF EXISTS "hod_see_pw_requests" ON public.password_change_requests;
DROP POLICY IF EXISTS "hod_update_pw_requests" ON public.password_change_requests;
DROP POLICY IF EXISTS "teacher_insert_pw_requests" ON public.password_change_requests;

-- Unified SELECT: own requests OR hod/admin/principal role
CREATE POLICY "pw_requests_select"
  ON public.password_change_requests FOR SELECT
  USING (
    teacher_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('hod', 'admin', 'principal')
    )
  );

-- INSERT: only for own record
CREATE POLICY "pw_requests_insert"
  ON public.password_change_requests FOR INSERT
  WITH CHECK (teacher_id = auth.uid());

-- UPDATE: only hod/admin/principal can approve/reject
CREATE POLICY "pw_requests_update"
  ON public.password_change_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('hod', 'admin', 'principal')
    )
  );
