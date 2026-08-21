-- ══════════════════════════════════════════════════════════════════════════════
-- HR Admin Panel — Migration
-- 1. Add 'hr' to app_role enum
-- 2. Add hr_approved column to profiles
-- 3. Create teacher_documents table (degree, marksheet, salary slip, experience)
-- 4. Create hr-docs storage bucket + RLS policies
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Extend the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr';

-- 2. Add hr_approved to profiles
--    NULL  = no HR decision yet (pending)
--    true  = HR approved → all features unlocked
--    false = HR rejected → teacher sees rejection reason
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hr_approved boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hr_rejection_reason text DEFAULT NULL;

COMMENT ON COLUMN public.profiles.hr_approved IS
  'NULL = awaiting HR document review, true = approved, false = rejected (see hr_rejection_reason)';

-- 3. Teacher onboarding documents table
CREATE TABLE IF NOT EXISTS public.teacher_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type      text NOT NULL
    CHECK (doc_type IN ('degree', 'marksheet', 'salary_slip', 'experience_letter')),
  file_path     text NOT NULL,          -- path inside hr-docs bucket
  original_name text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  hr_note       text,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (teacher_id, doc_type)         -- one slot per doc type per teacher
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teacher_documents TO authenticated;
GRANT ALL ON public.teacher_documents TO service_role;
ALTER TABLE public.teacher_documents ENABLE ROW LEVEL SECURITY;

-- Teacher can see and upload their own documents
CREATE POLICY "teacher views own docs"
  ON public.teacher_documents FOR SELECT TO authenticated
  USING (teacher_id = auth.uid());

CREATE POLICY "teacher uploads own docs"
  ON public.teacher_documents FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "teacher replaces own docs"
  ON public.teacher_documents FOR UPDATE TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- HR, principal, admin can view all documents
CREATE POLICY "hr views all docs"
  ON public.teacher_documents FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'hr'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- HR can update document status (approve/reject individual docs)
CREATE POLICY "hr reviews docs"
  ON public.teacher_documents FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'hr'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'hr'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- 4. Storage bucket for HR onboarding documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hr-docs', 'hr-docs', false,
  10485760,   -- 10 MB per file
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: teacher uploads to their own folder
CREATE POLICY "teacher uploads hr doc"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hr-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "teacher reads own hr doc"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'hr-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "teacher replaces hr doc"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hr-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- HR / admin / principal can read all documents
CREATE POLICY "hr reads all hr docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'hr-docs'
    AND (
      public.has_role(auth.uid(), 'hr'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );
