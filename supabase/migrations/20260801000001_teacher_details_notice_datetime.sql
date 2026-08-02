-- ── Teacher profile extras ────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS experience_years  integer,
  ADD COLUMN IF NOT EXISTS date_of_joining   date,
  ADD COLUMN IF NOT EXISTS subjects_taught   text;   -- comma-separated list of subjects

-- ── Notice date/time ──────────────────────────────────────────────────────────
ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS event_date  date,
  ADD COLUMN IF NOT EXISTS event_time  time;

-- make body nullable (it already has a default but let's also allow null)
ALTER TABLE public.notices
  ALTER COLUMN body DROP NOT NULL;
