-- ============================================================
-- Medical & Duty Leave
-- Flow:
--   Teacher applies → HOD approves (no principal needed) → approved
--   HOD marks: "Document Required" with a doc_status = 'required'
--   Teacher uploads document later
--   Principal sees these leaves in a "Documents Remaining" section
--   After document upload: principal reviews & gives final sign-off
--   (doc_status: 'required' | 'uploaded' | 'verified')
-- ============================================================

-- 1. Extend the leave_type enum
ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'medical';
ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'duty';

-- 2. Add document-related columns to leave_requests
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS doc_status   text CHECK (doc_status IN ('required','uploaded','verified')),
  ADD COLUMN IF NOT EXISTS doc_url      text,   -- Supabase Storage path after upload
  ADD COLUMN IF NOT EXISTS doc_note     text,   -- Principal note on document
  ADD COLUMN IF NOT EXISTS doc_acted_at timestamptz;

-- 3. Update leave_status enum: add 'hod_approved' for direct HOD-final leaves
-- (We reuse the existing 'approved' status for fully complete cases;
--  'hod_approved' means HOD approved but document still pending principal sign-off)
ALTER TYPE public.leave_status ADD VALUE IF NOT EXISTS 'hod_approved';

-- 4. Supabase Storage bucket for leave documents (run in dashboard if storage not set up)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('leave-docs', 'leave-docs', false)
-- ON CONFLICT DO NOTHING;

-- 5. Update apply_leave_accounting trigger to handle medical/duty yearly caps
CREATE OR REPLACE FUNCTION public.apply_leave_accounting()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  days numeric;
  used_month numeric := 0;
  used_year numeric := 0;
  yearly_cap numeric;
  remaining numeric;
BEGIN
  NEW.department_id := public.dept_of(NEW.teacher_id);
  days := public.count_working_days(NEW.from_date, NEW.to_date, NEW.department_id);
  IF NEW.session <> 'full_day' THEN
    days := LEAST(days, 1) * 0.5;
  END IF;
  NEW.total_days := days;

  SELECT COALESCE(SUM(total_days),0) INTO used_year
  FROM public.leave_requests
  WHERE teacher_id = NEW.teacher_id AND leave_type = NEW.leave_type
    AND status <> 'rejected' AND id <> NEW.id
    AND date_part('year', from_date) = date_part('year', NEW.from_date);

  SELECT COALESCE(SUM(total_days),0) INTO used_month
  FROM public.leave_requests
  WHERE teacher_id = NEW.teacher_id AND leave_type = 'casual'
    AND status <> 'rejected' AND id <> NEW.id
    AND date_trunc('month', from_date) = date_trunc('month', NEW.from_date);

  yearly_cap := CASE NEW.leave_type
    WHEN 'casual'     THEN 12
    WHEN 'maternity'  THEN 90
    WHEN 'bereavement'THEN 5
    WHEN 'medical'    THEN 15
    WHEN 'duty'       THEN 30
    ELSE 7
  END;

  remaining := GREATEST(yearly_cap - used_year, 0);
  IF NEW.leave_type = 'casual' THEN
    remaining := LEAST(remaining, GREATEST(2 - used_month, 0));
  END IF;

  -- Medical/duty: HOD decides paid/unpaid; set to 0 until principal verifies doc
  IF NEW.leave_type IN ('medical', 'duty') THEN
    NEW.paid_days   := 0;
    NEW.unpaid_days := days;
  ELSE
    NEW.paid_days   := LEAST(days, remaining);
    NEW.unpaid_days := days - NEW.paid_days;
  END IF;

  RETURN NEW;
END;
$$;
