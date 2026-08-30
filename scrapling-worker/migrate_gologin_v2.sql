-- GoLogin configuration table (single-row settings)
CREATE TABLE IF NOT EXISTS public.scrapling_gologin_config (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    api_token text NOT NULL DEFAULT '',
    profiles jsonb NOT NULL DEFAULT '[]'::jsonb,
    proxy_type text NOT NULL DEFAULT 'residential',
    default_country text NOT NULL DEFAULT '',
    wait_until text NOT NULL DEFAULT 'networkidle',
    wait_timeout_sec integer NOT NULL DEFAULT 60,
    updated_at timestamptz DEFAULT now()
);

INSERT INTO public.scrapling_gologin_config (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.scrapling_gologin_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_gologin_config" ON public.scrapling_gologin_config;
CREATE POLICY "allow_all_gologin_config" ON public.scrapling_gologin_config
    FOR ALL USING (true) WITH CHECK (true);

-- Add GoLogin-specific columns to scrapling_jobs
ALTER TABLE public.scrapling_jobs
    ADD COLUMN IF NOT EXISTS gologin_profile_id text DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS gologin_proxy_type text DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS gologin_wait_until text DEFAULT NULL;
