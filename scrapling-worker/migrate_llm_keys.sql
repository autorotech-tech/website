-- Multiple API keys per LLM provider
ALTER TABLE public.service_settings
ADD COLUMN IF NOT EXISTS gemini_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS groq_keys   JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS glm_keys    JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS openai_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill Gemini into gemini_keys if single key exists
UPDATE public.service_settings
SET gemini_keys = CASE
  WHEN (gemini_api_key IS NOT NULL AND gemini_api_key <> '')
    THEN jsonb_build_array(gemini_api_key)
  ELSE gemini_keys
END
WHERE id = 1;

