-- ============================================================
-- CSC CLMS v27 Migration
-- Run this in Supabase → SQL Editor
-- ============================================================

-- 1. Add new columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender               TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth        DATE,
  ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS account_locked       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill password_changed_at for existing users (use created_at as proxy)
UPDATE public.profiles
SET password_changed_at = created_at
WHERE password_changed_at IS NULL;

-- 3. College ID format: migrate old Firstname.CSC.COM → firstname@CSC.COM
--    (only runs on profiles that still use the old dot format)
UPDATE public.profiles
SET user_id = LOWER(SPLIT_PART(user_id, '.', 1)) || '@CSC.COM'
WHERE user_id ILIKE '%.CSC.COM'
  AND user_id NOT ILIKE '%@CSC.COM';

-- 4. Fix sign-in lookup: make sure the ilike query in login.functions matches
--    the new @ format. No schema change needed — the server fn already uses ilike.

-- ============================================================
-- Done. No RLS changes needed for the new columns:
-- profiles is already readable/writable by the owner via existing policies.
-- The new columns (account_locked, failed_login_attempts) are only written
-- server-side via the service-role key (supabaseAdmin), never from the client.
-- ============================================================
