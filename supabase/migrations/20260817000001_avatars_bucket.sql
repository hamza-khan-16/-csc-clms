-- ============================================================
-- Create avatars storage bucket for teacher profile photos
-- ============================================================

-- Create the bucket (public so signed URLs work)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Policy: authenticated users can upload their own avatar
CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND name = auth.uid()::text || '.jpg');

-- Policy: users can update/replace their own avatar
CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND name = auth.uid()::text || '.jpg');

-- Policy: authenticated users can read any avatar (for AppShell display)
CREATE POLICY "Authenticated users read avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');
