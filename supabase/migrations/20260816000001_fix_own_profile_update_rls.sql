-- ============================================================
-- Fix: Teachers can update gender / date_of_birth regardless of hr_approved
--
-- ROOT CAUSE
-- ----------
-- Migration 20260814000001_teacher_reupload_resets_hr_status.sql recreated
-- the "own profile update" policy with this WITH CHECK:
--
--   WITH CHECK (
--     id = auth.uid()
--     AND (hr_approved IS NULL OR hr_approved = false)
--   )
--
-- Postgres evaluates WITH CHECK against the *entire row after the update*.
-- So if a teacher's hr_approved = true (HR already approved them) and they
-- try to save their gender or DOB, the row after update still has
-- hr_approved = true → the check fails → RLS policy error.
--
-- CORRECT INTENT
-- --------------
-- Teachers should be able to update their own profile fields freely.
-- The only restriction is: they must NOT be able to set hr_approved = true
-- (only HR/admin can grant approval).
--
-- FIX
-- ---
-- The WITH CHECK is rewritten to block only self-approval escalation:
-- if the *incoming* value for hr_approved is true, it must already have
-- been true before (i.e., the teacher is not changing it to true).
-- This is expressed by checking that hr_approved in the new row is NOT
-- transitioning from a non-true value to true.
--
-- Since plain SQL in WITH CHECK cannot compare old vs new values directly,
-- we use the simplest safe alternative:
--   - Allow the update if the new hr_approved is NOT true  (NULL or false), OR
--   - Allow the update if hr_approved was already true before the update
--     (teacher is just saving other fields without touching hr_approved).
--
-- The second condition is read from the current row via a sub-select.
-- ============================================================

DROP POLICY IF EXISTS "own profile update" ON public.profiles;

CREATE POLICY "own profile update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND (
      -- Teacher is not writing true into hr_approved, OR
      hr_approved IS NOT TRUE
      OR
      -- hr_approved was already true before this update (teacher left it unchanged)
      (SELECT hr_approved FROM public.profiles WHERE id = auth.uid()) = true
    )
  );

-- HR and admin retain their separate full-update policy
-- ("hr updates onboarding status" from 20260815000002) — no change needed there.
