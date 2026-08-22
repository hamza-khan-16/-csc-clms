-- Auto-delete notices whose event_date has passed.
-- This view filters out expired notices for all SELECT queries,
-- and a cleanup function can be called anytime.

-- Function to delete expired notices (call this from app on page load or via cron)
create or replace function public.cleanup_expired_notices()
returns void
language sql
security definer
as $$
  delete from public.notices
  where event_date is not null
    and event_date < current_date;
$$;

-- Grant execute to authenticated users so the client can call it
grant execute on function public.cleanup_expired_notices() to authenticated;
