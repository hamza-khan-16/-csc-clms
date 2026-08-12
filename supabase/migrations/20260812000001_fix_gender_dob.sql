-- ── Fix gender values: normalise any capitalised legacy values to lowercase ────
-- The profiles.gender column requires 'female' | 'male' | 'other' (lowercase)
-- but earlier UI code stored capitalised values like 'Female', 'Male', 'Other',
-- and also 'Prefer not to say' which violates the check constraint.
-- This migration normalises them all.

UPDATE public.profiles
SET gender = LOWER(gender)
WHERE gender IN ('Male', 'Female', 'Other');

-- Remove any 'Prefer not to say' values (not in check constraint)
UPDATE public.profiles
SET gender = NULL
WHERE gender NOT IN ('male', 'female', 'other') AND gender IS NOT NULL;

-- ── Fix date_of_birth: convert any legacy YYYY-MM-DD (HTML date input) to DD-MM-YYYY ──
-- Earlier code used type="date" which stored ISO format (YYYY-MM-DD).
-- New format is DD-MM or DD-MM-YYYY.
UPDATE public.profiles
SET date_of_birth = (
  SPLIT_PART(date_of_birth, '-', 3) || '-' ||
  SPLIT_PART(date_of_birth, '-', 2) || '-' ||
  SPLIT_PART(date_of_birth, '-', 1)
)
WHERE date_of_birth ~ '^\d{4}-\d{2}-\d{2}$';
