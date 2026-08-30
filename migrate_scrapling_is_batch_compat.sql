-- Compat columns for agent-api /api/v1/scrape INSERT (worker still uses job_type/urls/max_pages)
ALTER TABLE public.scrapling_jobs
  ADD COLUMN IF NOT EXISTS is_batch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS batch_urls jsonb,
  ADD COLUMN IF NOT EXISTS is_crawl boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crawl_max_pages integer NOT NULL DEFAULT 20;
