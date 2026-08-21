-- Enable Realtime on profiles table so teachers get live updates
-- when HR approves/rejects their onboarding (hr_approved column changes).
-- This allows the teacher's UI to update automatically without a page refresh.

ALTER TABLE public.profiles REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
