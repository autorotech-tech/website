-- Маршрутизация LLM для Agent API (Swoop admin): цепочки provider+model по tier.
ALTER TABLE public.service_settings
  ADD COLUMN IF NOT EXISTS agent_llm_routing jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.service_settings.agent_llm_routing IS
  'JSON: { "tiers": { "code"|"reasoning"|"fast"|"general": [{ "provider", "model" }] }, "fallback": [...] }. provider: openrouter|groq|glm|openai|gemini|api_key_groups|env_openai. Пустой model — дефолт env/Swoop.';
