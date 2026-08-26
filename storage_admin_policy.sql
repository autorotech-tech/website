-- Allow Admins to perform ALL operations on storage.objects bucket 'user_uploads'
-- First, drop existing policy if it conflicts or is too restrictive (optional, but cleaner to add a specific admin policy)

CREATE POLICY "Admins can do everything in user_uploads"
ON storage.objects
FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

