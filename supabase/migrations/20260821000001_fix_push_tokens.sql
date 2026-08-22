-- Clean up corrupted push_tokens data.
-- The same onesignal_id was mapped to multiple user_ids because
-- the sync-all ran while different users were logged in on the same device.
-- 
-- Strategy: for each onesignal_id, keep only the most recently updated row.
DELETE FROM public.push_tokens
WHERE id NOT IN (
  SELECT DISTINCT ON (onesignal_id) id
  FROM public.push_tokens
  ORDER BY onesignal_id, updated_at DESC
);
