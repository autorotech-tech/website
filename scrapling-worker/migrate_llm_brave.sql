-- Add Brave Search API keys array to service_settings
ALTER TABLE public.service_settings
ADD COLUMN IF NOT EXISTS brave_keys JSONB NOT NULL DEFAULT '[]'::jsonb;
