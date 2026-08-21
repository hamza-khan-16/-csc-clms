-- ============================================================
-- Fix: Document upload RLS errors
--
-- Storage path used by the app: {leaveId}/{timestamp}-{filename}
-- So inside the bucket, storage.foldername(name)[1] = leaveId
--
-- Two fixes:
--   1. Storage bucket + policies so teachers can upload
--   2. leave_requests UPDATE policy so teachers can set doc_url/doc_status
-- ============================================================

-- ── 1. Ensure the bucket exists ─────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('leave-docs', 'leave-docs', false)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Drop any previously created policies to avoid conflicts
DROP POLICY IF EXISTS "teacher uploads own leave doc"   ON storage.objects;
DROP POLICY IF EXISTS "read own leave doc"              ON storage.objects;
DROP POLICY IF EXISTS "teacher replaces own leave doc"  ON storage.objects;
DROP POLICY IF EXISTS "teacher uploads doc to own approved leave" ON public.leave_requests;

-- ── 3. Storage RLS policies ──────────────────────────────────
-- Path inside bucket: {leaveId}/{timestamp}-{filename}
-- foldername(name)[1] = leaveId

-- Teachers upload to their own leave folder
CREATE POLICY "teacher uploads own leave doc"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'leave-docs'
    AND EXISTS (
      SELECT 1 FROM public.leave_requests lr
      WHERE lr.id::text = (storage.foldername(name))[1]
        AND lr.teacher_id = auth.uid()
    )
  );

-- Teachers can upsert (re-upload) to their own leave folder
CREATE POLICY "teacher replaces own leave doc"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'leave-docs'
    AND EXISTS (
      SELECT 1 FROM public.leave_requests lr
      WHERE lr.id::text = (storage.foldername(name))[1]
        AND lr.teacher_id = auth.uid()
    )
  );

-- Teachers read their own docs; approvers read all in their scope
CREATE POLICY "read own leave doc"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'leave-docs'
    AND EXISTS (
      SELECT 1 FROM public.leave_requests lr
      WHERE lr.id::text = (storage.foldername(name))[1]
        AND (
          lr.teacher_id = auth.uid()
          OR public.has_role(auth.uid(), 'principal')
          OR public.has_role(auth.uid(), 'admin')
          OR (
            public.has_role(auth.uid(), 'hod')
            AND lr.department_id = public.my_department()
          )
        )
    )
  );

-- ── 4. Allow teachers to write doc_url / doc_status ─────────
-- The existing "approvers update leaves" policy only covers HOD/principal/admin.
-- Teachers need to update their own approved leave to attach a document.
CREATE POLICY "teacher uploads doc to own approved leave"
  ON public.leave_requests FOR UPDATE TO authenticated
  USING (
    teacher_id = auth.uid()
    AND status IN ('hod_approved', 'approved')
  )
  WITH CHECK (
    teacher_id = auth.uid()
    AND status IN ('hod_approved', 'approved')
  );
