-- Scenarios: YAML-based automation scripts for GoLogin browser profiles
-- v1: tables + RLS

CREATE TABLE IF NOT EXISTS public.scrapling_scenarios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    yaml_content TEXT NOT NULL DEFAULT '',
    created_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE public.scrapling_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_scenarios"
    ON public.scrapling_scenarios
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.scrapling_scenario_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    scenario_id     UUID NOT NULL REFERENCES public.scrapling_scenarios(id) ON DELETE CASCADE,
    profile_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
    concurrency     INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'queued',
    results         JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    created_by      UUID REFERENCES auth.users(id)
);

ALTER TABLE public.scrapling_scenario_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_scenario_runs"
    ON public.scrapling_scenario_runs
    FOR ALL
    USING (true)
    WITH CHECK (true);
