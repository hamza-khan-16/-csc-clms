-- ============================================================
-- Fix: Teacher document re-upload resets HR approval status
--
-- When a teacher re-uploads a rejected document, their profile's
-- hr_approved must be reset to NULL (pending) so HR can review again.
--
-- The existing "own profile update" policy already allows teachers to
-- update their own profile row. This migration makes that explicit for
-- hr_approved and ensures teachers CANNOT set hr_approved to true
-- (only HR/admin can do that).
-- ============================================================

-- Drop and recreate the own-profile-update policy to allow teachers
-- to reset hr_approved to NULL on re-upload, but prevent self-approval.
DROP POLICY IF EXISTS "own profile update" ON public.profiles;

CREATE POLICY "own profile update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Teachers may only reset hr_approved to NULL (pending re-review).
    -- They must not be able to set it to TRUE themselves.
    AND (hr_approved IS NULL OR hr_approved = false)
  );

-- HR and admin retain full update rights (covered by their existing policies).
-- Also ensure the teacher_documents status is reset to pending on re-upload.
-- This is already handled in the app layer via upsert with status = 'pending'.
