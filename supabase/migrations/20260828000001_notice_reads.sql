-- Track which notices each user has acknowledged
CREATE TABLE IF NOT EXISTS notice_reads (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notice_id)
);

ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own rows
CREATE POLICY "users manage own reads"
  ON notice_reads FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
