-- Migration: Add phone number field to profiles
-- Run this in your Supabase SQL Editor

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL;

-- Optional: add a comment for documentation
COMMENT ON COLUMN profiles.phone IS 'Mobile number for WhatsApp password reset by HOD';
