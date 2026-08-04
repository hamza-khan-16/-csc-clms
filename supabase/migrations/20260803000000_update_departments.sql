-- ══════════════════════════════════════════════════════════════════════════════
-- Update departments to match Chandrabhan Sharma College course structure
-- Two departments: Science & Technology | Commerce & Arts
-- ══════════════════════════════════════════════════════════════════════════════

-- Delete old generic departments (keep any that teachers are already assigned to
-- by updating names instead of deleting, to preserve foreign key references)

-- Wipe old department rows and replace with correct ones
-- We use UPDATE/INSERT pattern to avoid breaking existing profile foreign keys

-- First: rename existing departments to match the two real ones
-- Then insert the rest if they don't exist

-- Safest approach: update all existing rows to one dept, insert second
DO $$
DECLARE
  sci_id  uuid;
  comm_id uuid;
BEGIN
  -- Get or create "Science & Technology" department
  SELECT id INTO sci_id FROM public.departments WHERE name = 'Science & Technology' LIMIT 1;
  IF sci_id IS NULL THEN
    -- Reuse first existing row to preserve any FK references
    SELECT id INTO sci_id FROM public.departments ORDER BY created_at LIMIT 1;
    IF sci_id IS NOT NULL THEN
      UPDATE public.departments SET
        name    = 'Science & Technology',
        courses = 'B.Sc.IT (Information Technology), B.Sc.DS (Data Science), B.Sc. (AI & ML) (Artificial Intelligence & Machine Learning), B.Sc. (CS & DF) (Cyber Security & Digital Forensics), B.Sc. (VFX) (Animation & Visual Effects), BCA (Computer Applications)',
        classes = 'FY, SY, TY'
      WHERE id = sci_id;
    ELSE
      INSERT INTO public.departments (name, courses, classes)
      VALUES (
        'Science & Technology',
        'B.Sc.IT (Information Technology), B.Sc.DS (Data Science), B.Sc. (AI & ML) (Artificial Intelligence & Machine Learning), B.Sc. (CS & DF) (Cyber Security & Digital Forensics), B.Sc. (VFX) (Animation & Visual Effects), BCA (Computer Applications)',
        'FY, SY, TY'
      )
      RETURNING id INTO sci_id;
    END IF;
  END IF;

  -- Get or create "Commerce & Arts" department
  SELECT id INTO comm_id FROM public.departments WHERE name = 'Commerce & Arts' LIMIT 1;
  IF comm_id IS NULL THEN
    -- Reuse second existing row to preserve any FK references
    SELECT id INTO comm_id FROM public.departments
    WHERE id != sci_id ORDER BY created_at LIMIT 1;
    IF comm_id IS NOT NULL THEN
      UPDATE public.departments SET
        name    = 'Commerce & Arts',
        courses = 'B.COM (Commerce), BAF (Accounting & Finance), BBI (Banking & Insurance), BFM (Financial Markets), BAMMC (Multimedia & Mass Communication), BMS (Management Studies)',
        classes = 'FY, SY, TY'
      WHERE id = comm_id;
    ELSE
      INSERT INTO public.departments (name, courses, classes)
      VALUES (
        'Commerce & Arts',
        'B.COM (Commerce), BAF (Accounting & Finance), BBI (Banking & Insurance), BFM (Financial Markets), BAMMC (Multimedia & Mass Communication), BMS (Management Studies)',
        'FY, SY, TY'
      )
      RETURNING id INTO comm_id;
    END IF;
  END IF;

  -- Delete any remaining old departments that are neither of the two above
  -- (safe only if no profiles reference them — reassign orphans to Science & Technology)
  UPDATE public.profiles
  SET department_id = sci_id
  WHERE department_id NOT IN (sci_id, comm_id)
     OR department_id IS NULL;

  UPDATE public.user_roles
  SET department_id = sci_id
  WHERE department_id NOT IN (sci_id, comm_id)
     OR department_id IS NULL;

  DELETE FROM public.departments
  WHERE id NOT IN (sci_id, comm_id);
END $$;
