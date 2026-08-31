-- Audit log for leave request actions (cancellations, status changes, etc.)
CREATE TABLE IF NOT EXISTS leave_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id  uuid REFERENCES leave_requests(id) ON DELETE SET NULL,
  action            text NOT NULL,
  actor_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leave_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins and principals can read all logs
CREATE POLICY "admins can read audit log"
  ON leave_audit_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'principal', 'hr')
    )
  );

-- Authenticated users can insert their own audit entries
CREATE POLICY "authenticated users can insert audit entries"
  ON leave_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- Index for fast lookups by leave request
CREATE INDEX IF NOT EXISTS idx_leave_audit_log_request
  ON leave_audit_log(leave_request_id);

CREATE INDEX IF NOT EXISTS idx_leave_audit_log_actor
  ON leave_audit_log(actor_id);
