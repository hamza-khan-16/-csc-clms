-- Add custom casual leave quota to profiles.
-- When null, the default of 12/year applies.
-- When set by admin, this overrides the default.
alter table public.profiles
  add column if not exists cl_quota integer default null check (cl_quota is null or (cl_quota >= 0 and cl_quota <= 365));

-- Update leave_balances view/function to use cl_quota when available.
-- This function is called when admin sets/changes the quota — it updates
-- the current year's casual leave balance to match.
create or replace function public.set_teacher_cl_quota(
  _teacher_id uuid,
  _quota integer
)
returns void
language plpgsql
security definer
as $$
declare
  _year integer := extract(year from now())::integer;
  _used integer;
begin
  -- Save quota to profile
  update public.profiles set cl_quota = _quota where id = _teacher_id;

  -- Recalculate current year's casual leave balance
  select coalesce(sum(
    case when status not in ('rejected','cancelled') then
      coalesce(paid_days,0) + coalesce(unpaid_days,0)
    else 0 end
  ), 0)
  into _used
  from public.leave_requests
  where teacher_id = _teacher_id
    and leave_type = 'casual'
    and extract(year from from_date) = _year;

  -- Upsert leave_balances row
  insert into public.leave_balances (teacher_id, leave_type, year, remaining_days, used_days)
  values (_teacher_id, 'casual', _year, greatest(_quota - _used, 0), _used)
  on conflict (teacher_id, leave_type, year)
  do update set
    remaining_days = greatest(_quota - excluded.used_days, 0),
    used_days = excluded.used_days;
end;
$$;

grant execute on function public.set_teacher_cl_quota(uuid, integer) to authenticated;
