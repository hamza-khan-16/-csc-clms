-- ── Fix HR approval: allow HR and admin to update hr_approved on any profile ──
-- The existing "own profile update" policy only allows users to update their
-- own profile (id = auth.uid()). This means HR cannot set hr_approved = true/false
-- on a teacher's profile — the update silently returns 0 rows.
-- This migration adds a separate policy for HR/admin to update onboarding fields.

CREATE POLICY "hr updates onboarding status"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'hr'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'hr'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- Also allow teachers to update their OWN hr_approved back to NULL when requesting again
-- (teacher resets their own rejected status to re-submit for review)
-- The existing "own profile update" policy already covers this since id = auth.uid().
-- No extra policy needed for teachers — they can update their own row.
