ALTER TABLE public.scrapling_gologin_config
ADD COLUMN IF NOT EXISTS gemini_api_key TEXT NOT NULL DEFAULT '';
