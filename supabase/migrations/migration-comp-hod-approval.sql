-- Migration: HOD approval step for compensation assignments
-- Run this in your Supabase SQL editor

-- 1. Add 'hod_pending' as a valid status for compensation_assignments
DO $$
BEGIN
  ALTER TABLE compensation_assignments
    DROP CONSTRAINT IF EXISTS compensation_assignments_status_check;

  ALTER TABLE compensation_assignments
    ADD CONSTRAINT compensation_assignments_status_check
    CHECK (status IN ('pending', 'hod_pending', 'accepted', 'rejected'));
END $$;

-- 2. Set default status to 'pending' if not already set
ALTER TABLE compensation_assignments
  ALTER COLUMN status SET DEFAULT 'pending';

-- 3. HODs can update compensation_assignments for teachers in their dept
DROP POLICY IF EXISTS "hod_can_update_comp_status" ON compensation_assignments;

CREATE POLICY "hod_can_update_comp_status"
  ON compensation_assignments
  FOR UPDATE
  TO authenticated
  USING (
    -- Teacher updating their own
    from_teacher_id = auth.uid()
    OR to_teacher_id = auth.uid()
    -- HOD updating for their dept (role is in user_roles, dept is in profiles)
    OR EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN profiles hod_p ON hod_p.id = ur.user_id
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'hod'
        AND hod_p.department_id IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM profiles t
            WHERE t.id = compensation_assignments.from_teacher_id
              AND t.department_id = hod_p.department_id
          )
          OR EXISTS (
            SELECT 1 FROM profiles t
            WHERE t.id = compensation_assignments.to_teacher_id
              AND t.department_id = hod_p.department_id
          )
        )
    )
  )
  WITH CHECK (true);

-- 4. HODs can read compensation_assignments for their dept
DROP POLICY IF EXISTS "hod_can_read_comp_assignments" ON compensation_assignments;

CREATE POLICY "hod_can_read_comp_assignments"
  ON compensation_assignments
  FOR SELECT
  TO authenticated
  USING (
    from_teacher_id = auth.uid()
    OR to_teacher_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN profiles hod_p ON hod_p.id = ur.user_id
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('hod', 'principal', 'admin')
        AND hod_p.department_id IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM profiles t
            WHERE t.id = compensation_assignments.from_teacher_id
              AND t.department_id = hod_p.department_id
          )
          OR EXISTS (
            SELECT 1 FROM profiles t
            WHERE t.id = compensation_assignments.to_teacher_id
              AND t.department_id = hod_p.department_id
          )
        )
    )
  );