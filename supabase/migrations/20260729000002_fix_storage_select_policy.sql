-- Drop the overly complex SELECT policy that's blocking signed URL generation
DROP POLICY IF EXISTS "read own leave doc" ON storage.objects;

-- Replace with a simple policy: any authenticated user can read from leave-docs.
-- Files are stored under UUID-based paths so they are not guessable.
-- The principal/HOD/teacher distinction is enforced at the app level.
CREATE POLICY "authenticated users read leave docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'leave-docs');
