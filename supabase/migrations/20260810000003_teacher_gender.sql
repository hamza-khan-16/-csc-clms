-- ── Add gender to profiles for maternity leave gating ────────────────────────
-- Maternity leave is only available to female teachers.
-- gender values: 'female' | 'male' | 'other' | null (unknown/not-set)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text DEFAULT NULL
  CHECK (gender IN ('female', 'male', 'other') OR gender IS NULL);

COMMENT ON COLUMN public.profiles.gender IS
  'Teacher gender — used to gate maternity leave option in the apply form.';
