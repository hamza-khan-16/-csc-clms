-- ============================================================
-- Migration: Emergency Leave + Dual Approval Flow
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Add new enum values to leave_type
ALTER TYPE leave_type ADD VALUE IF NOT EXISTS 'emergency';

-- 2. Add new status: pending_principal (HOD approved, awaiting principal)
ALTER TYPE leave_status ADD VALUE IF NOT EXISTS 'pending_principal';

-- 3. Add auto_approved_at column to track emergency auto-approvals
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS auto_approved_at timestamptz DEFAULT NULL;

-- 4. (Optional but recommended) Supabase Edge Function for server-side auto-approval
--    If you don't have Edge Functions set up, the client-side timer in requests.tsx handles it.
--    To add a cron-based server auto-approval, create a Scheduled Edge Function:
--
--    File: supabase/functions/auto-approve-emergency/index.ts
--    Schedule: every 15 minutes
--
--    The function should run:
--      UPDATE leave_requests
--      SET status = 'approved',
--          auto_approved_at = now(),
--          paid_days = 0,
--          unpaid_days = total_days
--      WHERE leave_type = 'emergency'
--        AND status = 'pending_principal'
--        AND created_at <= now() - INTERVAL '5 hours';

-- 5. Update RLS policies to allow principal to see pending_principal rows
--    (If your existing policy filters by status, add pending_principal to the list)
--    Example — adjust to match your actual policy names:
-- DROP POLICY IF EXISTS "principal_can_see_actionable" ON leave_requests;
-- CREATE POLICY "principal_can_see_actionable" ON leave_requests
--   FOR SELECT USING (
--     has_role('principal', auth.uid()) AND
--     status IN ('hod_recommended', 'pending_principal', 'approved', 'rejected')
--   );
