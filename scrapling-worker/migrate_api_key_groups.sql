-- Named API key groups for custom providers / rotation (JSON array of objects).
-- Shape (backward-compatible):
-- [
--   {
--     "id": "my_api",
--     "name": "My API",
--     "keys": ["k1", "k2"],
--     "provider": "openrouter" | "openai" | "groq" | "glm" | "gemini" | "",
--     "tiers": ["code" | "reasoning" | "fast" | "general"],
--     "models": ["anthropic/claude-3.7-sonnet", "..."],
--     "user_email": "autoro.tech@gmail.com",
--     "priority": 10
--   }
-- ]
ALTER TABLE public.service_settings
ADD COLUMN IF NOT EXISTS api_key_groups JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.service_settings.api_key_groups IS
  'Named groups of API keys; DeerFlow sync writes SWOOP_API_GROUP_<ID>_KEYS per group id.';
