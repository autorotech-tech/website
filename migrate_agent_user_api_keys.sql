-- Per-user API keys for Swoop agent-api (Replit / Google AI Studio / OpenAI-compatible clients).
-- Raw key shown once at creation; only SHA-256 hash is stored.
-- Prefix: auk_… (user) vs ak_… (service agent_api_key in service_settings).

CREATE TABLE IF NOT EXISTS public.agent_user_api_keys (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT 'default',
    key_prefix      TEXT NOT NULL,
    key_hash        TEXT NOT NULL UNIQUE,
    scopes          TEXT[] NOT NULL DEFAULT ARRAY['api:v1']::TEXT[],
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_user_api_keys_user_id
    ON public.agent_user_api_keys (user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_user_api_keys_key_hash
    ON public.agent_user_api_keys (key_hash)
    WHERE revoked_at IS NULL;

ALTER TABLE public.agent_user_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_user_api_keys_select_own" ON public.agent_user_api_keys;
CREATE POLICY "agent_user_api_keys_select_own"
    ON public.agent_user_api_keys FOR SELECT
    USING (auth.uid() = user_id);

-- Mutations go through agent-api (service role / supabase_admin), not direct client inserts of hashes.
DROP POLICY IF EXISTS "agent_user_api_keys_no_client_write" ON public.agent_user_api_keys;
CREATE POLICY "agent_user_api_keys_no_client_write"
    ON public.agent_user_api_keys FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS "agent_user_api_keys_no_client_update" ON public.agent_user_api_keys;
CREATE POLICY "agent_user_api_keys_no_client_update"
    ON public.agent_user_api_keys FOR UPDATE
    USING (false);

DROP POLICY IF EXISTS "agent_user_api_keys_no_client_delete" ON public.agent_user_api_keys;
CREATE POLICY "agent_user_api_keys_no_client_delete"
    ON public.agent_user_api_keys FOR DELETE
    USING (false);

COMMENT ON TABLE public.agent_user_api_keys IS
  'Personal Swoop API tokens (auk_…). Validated by agent-api alongside service agent_api_key.';
