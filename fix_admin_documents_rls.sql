-- Allow Admins to perform ALL operations (INSERT, UPDATE, DELETE, SELECT) on documents table
DROP POLICY IF EXISTS "Admins can perform all actions on documents" ON public.documents;

CREATE POLICY "Admins can perform all actions on documents"
ON public.documents
FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

