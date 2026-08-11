-- ── Add Date of Birth to teacher profiles ────────────────────────────────────
-- Stored as text in format "DD-MM" (day+month only) or "DD-MM-YYYY" (full).
-- Year is optional — users can enter just day & month without the year.
-- Only HODs and Principals can see a teacher's DOB (enforced in the frontend).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth text DEFAULT NULL;

COMMENT ON COLUMN public.profiles.date_of_birth IS
  'Teacher date of birth. Format: "DD-MM" (day+month only) or "DD-MM-YYYY" (full). Year is optional.';
