-- ============================================================
-- Fix: HR role cannot see any leave_requests in the HR panel
--
-- ROOT CAUSE
-- ----------
-- The "read leaves" RLS policy on leave_requests only permits:
--   teacher_id = auth.uid()   (own leave)
--   principal, admin          (full access)
--   hod                       (own department)
--
-- The 'hr' role is absent. So when HR queries leave_requests
-- (even with .in("teacher_id", [...ids])), Supabase returns 0 rows
-- silently — causing the Leaves tab and Payroll summary to appear
-- empty despite data existing.
--
-- FIX
-- ---
-- Drop and recreate the "read leaves" policy to include hr.
-- HR needs to see ALL teachers' leaves (not just own dept) for
-- the payroll report and individual leave tab in the HR panel.
-- ============================================================

DROP POLICY IF EXISTS "read leaves" ON public.leave_requests;

CREATE POLICY "read leaves"
  ON public.leave_requests FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (public.has_role(auth.uid(), 'hod') AND department_id = public.my_department())
  );
