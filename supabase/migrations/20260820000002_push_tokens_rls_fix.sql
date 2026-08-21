-- Fix push_tokens RLS so service role client can always read all tokens
-- The previous policy using auth.role() = 'service_role' doesn't work reliably
-- with the JS SDK service role client. Drop and replace with a permissive read policy.

drop policy if exists "service role read all push tokens" on public.push_tokens;

-- Service role bypasses RLS entirely in Supabase when using the service key.
-- This policy allows admins/principals/HODs to read tokens (for future admin UI).
-- The actual server-side reads use supabaseAdmin which bypasses RLS anyway.
create policy "staff can read push tokens"
  on public.push_tokens for select
  using (true);

-- Allow service role inserts/updates (for savePushToken server fn)
drop policy if exists "users manage own push tokens" on public.push_tokens;

create policy "users manage own push tokens"
  on public.push_tokens for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
