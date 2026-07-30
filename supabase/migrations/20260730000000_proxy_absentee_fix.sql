-- ── Fix 1: Allow proxy teachers to read the leave_requests they're covering ──
CREATE POLICY "proxy teacher reads assigned leave"
  ON public.leave_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.proxy_assignments pa
      WHERE pa.leave_request_id = id
        AND pa.proxy_teacher_id = auth.uid()
    )
  );

-- ── Fix 2: Add absentee_teacher_id column to proxy_assignments ────────────
ALTER TABLE public.proxy_assignments
  ADD COLUMN IF NOT EXISTS absentee_teacher_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill existing rows from the leave_requests join
UPDATE public.proxy_assignments pa
SET absentee_teacher_id = lr.teacher_id
FROM public.leave_requests lr
WHERE pa.leave_request_id = lr.id
  AND pa.absentee_teacher_id IS NULL;
