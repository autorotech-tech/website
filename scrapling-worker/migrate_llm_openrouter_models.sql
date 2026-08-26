-- Add OpenRouter model slugs to service_settings
ALTER TABLE public.service_settings
ADD COLUMN IF NOT EXISTS openrouter_default_model TEXT NOT NULL DEFAULT 'google/gemini-2.0-flash-001';

ALTER TABLE public.service_settings
ADD COLUMN IF NOT EXISTS openrouter_qwen_model TEXT NOT NULL DEFAULT 'qwen/qwen3.6-plus-preview:free';

