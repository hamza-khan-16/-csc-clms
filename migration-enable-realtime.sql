-- Enable Supabase Realtime for live updates without page reload
-- Run this in your Supabase SQL Editor

-- Add key tables to the realtime publication
-- (supabase_realtime is the default publication Supabase uses)

ALTER PUBLICATION supabase_realtime ADD TABLE leave_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE compensation_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE proxy_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE lectures;
ALTER PUBLICATION supabase_realtime ADD TABLE notices;

-- If any of the above fail with "already exists", that's fine — it just means
-- that table was already added to replication. You can run them one by one.
