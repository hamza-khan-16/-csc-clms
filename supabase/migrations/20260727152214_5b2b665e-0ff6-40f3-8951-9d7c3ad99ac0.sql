CREATE POLICY "hod approves dept teachers" ON public.profiles
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'hod') AND department_id = public.my_department())
WITH CHECK (public.has_role(auth.uid(),'hod') AND department_id = public.my_department());