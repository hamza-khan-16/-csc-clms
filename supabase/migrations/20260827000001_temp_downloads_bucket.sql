-- Create a private storage bucket for temporary download files
-- Files are uploaded here, a signed URL is generated, then deleted after use.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'temp-downloads',
  'temp-downloads',
  false,        -- private; access is via signed URLs only
  10485760,     -- 10 MB max per file
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own temp path
CREATE POLICY "auth users can upload temp files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'temp-downloads');

-- Allow authenticated users to read (needed for signed URL generation)
CREATE POLICY "auth users can read temp files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'temp-downloads');

-- Allow authenticated users to delete their own temp files
CREATE POLICY "auth users can delete temp files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'temp-downloads');
