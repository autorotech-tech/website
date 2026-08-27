-- Pipeline metadata on published posts (safe if columns already exist)
ALTER TABLE IF EXISTS blog_posts
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS pipeline_slug text,
  ADD COLUMN IF NOT EXISTS source text;

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_pipeline_slug_uidx
  ON blog_posts (pipeline_slug)
  WHERE pipeline_slug IS NOT NULL;
