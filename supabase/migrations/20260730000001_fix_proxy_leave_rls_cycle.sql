-- ============================================================
-- Fix: Circular RLS reference between leave_requests and proxy_assignments
--
-- Root cause:
--   "read proxies" policy on proxy_assignments queries leave_requests.
--   "proxy teacher reads assigned leave" policy (added in 20260730000000)
--   on leave_requests queries proxy_assignments.
--   → Mutual recursion → PostgreSQL throws a 500.
--
-- Fix:
--   1. Drop the recursive policy from leave_requests.
--   2. Create a SECURITY DEFINER helper function that reads
--      proxy_assignments bypassing RLS — safe because we only
--      expose it as a boolean check for the calling user's own rows.
--   3. Re-create the leave_requests policy using that helper.
--   4. Fix the "read proxies" policy similarly so it no longer
--      touches leave_requests (it's not needed — absentee_teacher_id
--      is now on proxy_assignments directly, added in the same migration).
-- ============================================================

-- ── Step 1: Drop the offending policy ────────────────────────
DROP POLICY IF EXISTS "proxy teacher reads assigned leave" ON public.leave_requests;

-- ── Step 2: SECURITY DEFINER helper — bypasses RLS on proxy_assignments ──
-- Returns true if the given user is a proxy teacher for the given leave request.
-- SECURITY DEFINER means it runs as the function owner (postgres), not the caller,
-- so it can read proxy_assignments without triggering that table's RLS policies
-- (which would otherwise loop back into leave_requests).
CREATE OR REPLACE FUNCTION public.is_proxy_for_leave(_leave_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.proxy_assignments
    WHERE leave_request_id = _leave_id
      AND proxy_teacher_id = _user_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_proxy_for_leave(uuid, uuid) FROM anon;

-- ── Step 3: Re-create the policy using the helper ────────────
CREATE POLICY "proxy teacher reads assigned leave"
  ON public.leave_requests FOR SELECT TO authenticated
  USING (
    public.is_proxy_for_leave(id, auth.uid())
  );

-- ── Step 4: Fix "read proxies" on proxy_assignments ──────────
-- The original policy has an EXISTS subquery on leave_requests, which now
-- causes the cycle in the other direction.
-- Since migration 20260730000000 added absentee_teacher_id directly on
-- proxy_assignments, we can use that column instead — no join needed.
DROP POLICY IF EXISTS "read proxies" ON public.proxy_assignments;

CREATE POLICY "read proxies" ON public.proxy_assignments FOR SELECT TO authenticated USING (
  proxy_teacher_id = auth.uid()
  OR absentee_teacher_id = auth.uid()
  OR public.has_role(auth.uid(), 'principal')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'hod')
);
