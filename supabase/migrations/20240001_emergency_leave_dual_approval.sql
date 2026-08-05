-- Emergency leave has been removed from the system.
-- The leave_type enum no longer includes 'emergency'.
-- The status 'pending_principal' is added by a later migration.
-- auto_approved_at column is kept for historical data only.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS auto_approved_at timestamptz DEFAULT NULL;
