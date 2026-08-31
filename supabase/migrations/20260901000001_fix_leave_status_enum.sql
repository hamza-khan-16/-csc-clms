-- Add missing leave_status enum values used throughout the application.
-- 'pending_principal' was referenced in code but never added to the Postgres enum.
-- 'cancelled' is used in .not() filters and in the leave_audit_log action field.
-- Without these, any query touching these status values returns a 400 Bad Request.

ALTER TYPE public.leave_status ADD VALUE IF NOT EXISTS 'pending_principal';
ALTER TYPE public.leave_status ADD VALUE IF NOT EXISTS 'cancelled';
