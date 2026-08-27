-- Migration v3: batch/crawl/AI extraction fields for scrapling_jobs
-- Run on Supabase Postgres instance

ALTER TABLE public.scrapling_jobs
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS urls jsonb,
  ADD COLUMN IF NOT EXISTS crawl_depth int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_pages int NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS link_selector text,
  ADD COLUMN IF NOT EXISTS ai_prompt text,
  ADD COLUMN IF NOT EXISTS solve_cloudflare boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS network_idle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS headless boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS proxy text,
  ADD COLUMN IF NOT EXISTS progress jsonb;

COMMENT ON COLUMN public.scrapling_jobs.job_type IS 'single | batch | crawl';
COMMENT ON COLUMN public.scrapling_jobs.urls IS 'Array of URLs for batch mode (JSONB)';
COMMENT ON COLUMN public.scrapling_jobs.crawl_depth IS 'Max link-follow depth for crawl mode';
COMMENT ON COLUMN public.scrapling_jobs.max_pages IS 'Max pages to scrape in crawl/batch mode';
COMMENT ON COLUMN public.scrapling_jobs.link_selector IS 'CSS/XPath selector to find links in crawl mode';
COMMENT ON COLUMN public.scrapling_jobs.ai_prompt IS 'Natural-language prompt for AI data extraction';
COMMENT ON COLUMN public.scrapling_jobs.solve_cloudflare IS 'Bypass Cloudflare Turnstile (Stealth mode only)';
COMMENT ON COLUMN public.scrapling_jobs.network_idle IS 'Wait for network idle (Dynamic mode only)';
COMMENT ON COLUMN public.scrapling_jobs.headless IS 'Run browser headless';
COMMENT ON COLUMN public.scrapling_jobs.proxy IS 'Proxy server URL';
COMMENT ON COLUMN public.scrapling_jobs.progress IS 'Progress: {completed, total, errors}';
