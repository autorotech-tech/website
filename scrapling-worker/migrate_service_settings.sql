-- Centralized service settings table (single-row)
CREATE TABLE IF NOT EXISTS public.service_settings (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    gemini_api_key  TEXT NOT NULL DEFAULT '',
    gologin_api_token TEXT NOT NULL DEFAULT '',
    agent_api_key   TEXT NOT NULL DEFAULT '',
    agent_enabled   BOOLEAN NOT NULL DEFAULT false,
    agent_rate_limit INTEGER NOT NULL DEFAULT 30,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.service_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_service_settings"
    ON public.service_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.service_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Track job source (admin UI vs public API)
ALTER TABLE public.scrapling_jobs
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';

-- Add api_client_ip for rate limiting / audit
ALTER TABLE public.scrapling_jobs
ADD COLUMN IF NOT EXISTS api_client_ip TEXT;
