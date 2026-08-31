-- Add a direct FK from leave_requests.teacher_id → profiles(id)
-- Previously it only referenced auth.users(id), which PostgREST cannot join through.
-- This enables PostgREST to resolve profiles(...) joins on leave_requests queries
-- without needing separate fetchPeople() calls.
-- Safe to add: profiles.id = auth.users.id, so every existing teacher_id in
-- leave_requests already has a matching profiles row.

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_teacher_id_profiles_fkey
  FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
