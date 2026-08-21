-- Push token table to store OneSignal player/subscription IDs per user per device
create table if not exists public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  onesignal_id  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(user_id, onesignal_id)
);

alter table public.push_tokens enable row level security;

-- Users can only manage their own tokens
create policy "users manage own push tokens"
  on public.push_tokens for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admins/service role can read all (for sending notifications)
create policy "service role read all push tokens"
  on public.push_tokens for select
  using (auth.role() = 'service_role');
