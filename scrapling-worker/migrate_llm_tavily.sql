-- Tavily Search API keys (DeerFlow web_search + extract); ротация в tavily_tools
ALTER TABLE public.service_settings
ADD COLUMN IF NOT EXISTS tavily_keys JSONB NOT NULL DEFAULT '[]'::jsonb;
