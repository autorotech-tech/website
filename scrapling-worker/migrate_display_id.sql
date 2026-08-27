-- Sequential display ID for scrapling jobs (human-readable #1, #2, ...)
CREATE SEQUENCE IF NOT EXISTS public.scrapling_jobs_display_id_seq;

ALTER TABLE public.scrapling_jobs
ADD COLUMN IF NOT EXISTS display_id BIGINT;

-- Backfill existing rows in chronological order
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.scrapling_jobs
  WHERE display_id IS NULL
)
UPDATE public.scrapling_jobs j
SET display_id = ordered.rn
FROM ordered
WHERE j.id = ordered.id;

-- Set sequence to max(display_id) so new rows get next value
SELECT setval(
  'public.scrapling_jobs_display_id_seq',
  (SELECT COALESCE(MAX(display_id), 1) FROM public.scrapling_jobs)
);

-- Default for new rows
ALTER TABLE public.scrapling_jobs
ALTER COLUMN display_id SET DEFAULT nextval('public.scrapling_jobs_display_id_seq'::regclass);
