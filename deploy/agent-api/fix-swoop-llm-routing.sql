-- Swoop Admin / Postgres: fix LLM routing + api_key_groups providers.
-- Apply on VPS: docker exec -i supabase-db psql -U supabase_admin -d postgres < deploy/agent-api/fix-swoop-llm-routing.sql
--
-- Goals:
-- 1) Tag api_key_groups with provider (stop cross-pool pollution)
-- 2) Route without OpenRouter (GLM → Groq → Gemini)
-- 3) Short fallback chain

BEGIN;

-- 1) Provider tags for existing groups (match by name; idempotent).
UPDATE public.service_settings
SET api_key_groups = (
  SELECT jsonb_agg(
    CASE
      WHEN lower(coalesce(elem->>'name','')) LIKE '%gemini%' THEN elem || '{"provider":"gemini"}'::jsonb
      WHEN lower(coalesce(elem->>'name','')) LIKE '%groq%' THEN elem || '{"provider":"groq"}'::jsonb
      WHEN lower(coalesce(elem->>'name','')) LIKE '%glm%' THEN elem || '{"provider":"glm"}'::jsonb
      WHEN lower(coalesce(elem->>'name','')) LIKE '%openrouter%' THEN elem || '{"provider":"openrouter"}'::jsonb
      ELSE elem
    END
  )
  FROM jsonb_array_elements(coalesce(api_key_groups, '[]'::jsonb)) AS elem
)
WHERE id = 1;

-- 2) LLM routing: no OpenRouter; GLM first for general/fast.
UPDATE public.service_settings
SET agent_llm_routing = '{
  "tiers": {
    "fast": [
      {"provider": "glm", "model": "glm-4-flash"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"},
      {"provider": "gemini", "model": "gemini-2.5-flash"}
    ],
    "general": [
      {"provider": "glm", "model": "glm-4-flash"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"},
      {"provider": "gemini", "model": "gemini-2.5-flash"}
    ],
    "code": [
      {"provider": "glm", "model": "glm-4.7"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"},
      {"provider": "gemini", "model": "gemini-2.5-flash"}
    ],
    "reasoning": [
      {"provider": "glm", "model": "glm-4.7"},
      {"provider": "gemini", "model": "gemini-2.5-flash"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"}
    ]
  },
  "fallback": [
    {"provider": "glm", "model": "glm-4-flash"}
  ],
  "key_pool_strategy": "fill-first"
}'::jsonb
WHERE id = 1;

COMMIT;

-- Verify:
-- SELECT jsonb_pretty(agent_llm_routing) FROM public.service_settings WHERE id=1;
-- SELECT elem->>'name' AS name, elem->>'provider' AS provider FROM public.service_settings, jsonb_array_elements(api_key_groups) elem WHERE id=1;
