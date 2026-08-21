-- ── Auto-Approve Pending Leaves ──────────────────────────────────────────────
-- Leaves that remain in 'pending_hod' for more than 2 days are automatically
-- approved. This is enforced via a Supabase pg_cron job that runs every hour.
-- Only 'pending_hod' leaves are affected; approved/rejected ones are untouched.

-- Function: auto-approve leaves older than 2 days
CREATE OR REPLACE FUNCTION public.auto_approve_stale_leaves()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.leave_requests
  SET
    status     = 'approved',
    updated_at = now()
  WHERE
    status = 'pending_hod'
    AND created_at <= now() - INTERVAL '2 days';
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_stale_leaves() TO service_role;

-- Schedule the function to run every hour via pg_cron (requires pg_cron extension)
-- If pg_cron is not available in your Supabase plan, run this manually or via
-- a Supabase Edge Function cron trigger.
DO $$
BEGIN
  -- Only schedule if pg_cron extension is available
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    PERFORM cron.schedule(
      'auto-approve-pending-leaves',   -- job name (unique)
      '0 * * * *',                      -- every hour
      'SELECT public.auto_approve_stale_leaves()'
    );
  END IF;
END;
$$;

-- Ensure leave_requests has an updated_at column (add if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'leave_requests'
      AND column_name  = 'updated_at'
  ) THEN
    ALTER TABLE public.leave_requests
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END;
$$;

-- Backfill updated_at for existing rows
UPDATE public.leave_requests
SET updated_at = created_at
WHERE updated_at IS NULL OR updated_at = '1970-01-01';
