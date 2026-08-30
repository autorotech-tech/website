-- Setup storage bucket for blog images
INSERT INTO storage.buckets (id, name, public)
VALUES ('blog-images', 'blog-images', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated uploads (only for autoro.tech@gmail.com)
CREATE POLICY IF NOT EXISTS "Allow authenticated uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'blog-images' AND auth.email() = 'autoro.tech@gmail.com');

-- Policy: Allow public read access
CREATE POLICY IF NOT EXISTS "Allow public read access"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'blog-images');

-- Verify setup
SELECT id, name, public FROM storage.buckets WHERE id = 'blog-images';
SELECT policyname, cmd, qual FROM pg_policies 
WHERE tablename = 'objects' 
AND schemaname = 'storage' 
AND (policyname LIKE '%blog%' OR qual::text LIKE '%blog-images%');

