-- Create storage buckets for blog media
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('blog-images', 'blog-images', true),
  ('blog-audio', 'blog-audio', true),
  ('blog-media', 'blog-media', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated uploads (only for autoro.tech@gmail.com)
-- Drop existing policies if they exist, then create new ones
DROP POLICY IF EXISTS "Allow admin blog image uploads" ON storage.objects;
CREATE POLICY "Allow admin blog image uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'blog-images' 
  AND (SELECT email FROM auth.users WHERE id = auth.uid()) = 'autoro.tech@gmail.com'
);

DROP POLICY IF EXISTS "Allow admin blog audio uploads" ON storage.objects;
CREATE POLICY "Allow admin blog audio uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'blog-audio' 
  AND (SELECT email FROM auth.users WHERE id = auth.uid()) = 'autoro.tech@gmail.com'
);

DROP POLICY IF EXISTS "Allow admin blog media uploads" ON storage.objects;
CREATE POLICY "Allow admin blog media uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'blog-media' 
  AND (SELECT email FROM auth.users WHERE id = auth.uid()) = 'autoro.tech@gmail.com'
);

-- Policy: Allow public read access
DROP POLICY IF EXISTS "Allow public read blog images" ON storage.objects;
CREATE POLICY "Allow public read blog images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'blog-images');

DROP POLICY IF EXISTS "Allow public read blog audio" ON storage.objects;
CREATE POLICY "Allow public read blog audio"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'blog-audio');

DROP POLICY IF EXISTS "Allow public read blog media" ON storage.objects;
CREATE POLICY "Allow public read blog media"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'blog-media');

-- Policy: Allow admin updates
DROP POLICY IF EXISTS "Allow admin blog image updates" ON storage.objects;
CREATE POLICY "Allow admin blog image updates"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'blog-images' 
  AND (SELECT email FROM auth.users WHERE id = auth.uid()) = 'autoro.tech@gmail.com'
);

DROP POLICY IF EXISTS "Allow admin blog audio updates" ON storage.objects;
CREATE POLICY "Allow admin blog audio updates"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'blog-audio' 
  AND (SELECT email FROM auth.users WHERE id = auth.uid()) = 'autoro.tech@gmail.com'
);

-- Policy: Allow admin deletes
DROP POLICY IF EXISTS "Allow admin blog image deletes" ON storage.objects;
CREATE POLICY "Allow admin blog image deletes"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'blog-images' 
  AND (SELECT email FROM auth.users WHERE id = auth.uid()) = 'autoro.tech@gmail.com'
);

DROP POLICY IF EXISTS "Allow admin blog audio deletes" ON storage.objects;
CREATE POLICY "Allow admin blog audio deletes"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'blog-audio' 
  AND (SELECT email FROM auth.users WHERE id = auth.uid()) = 'autoro.tech@gmail.com'
);

-- Verify setup
SELECT id, name, public FROM storage.buckets WHERE id IN ('blog-images', 'blog-audio', 'blog-media');

