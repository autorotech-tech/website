-- Keept: moderation queue for PII / prompt-injection flagged captures (Google Intensive Phase C)

create table if not exists public.capture_moderation_queue (
    id uuid primary key default gen_random_uuid(),
    workspace_id bigint not null references public.workspaces(id) on delete cascade,
    knowledge_item_id bigint references public.knowledge_items(id) on delete set null,
    session_id varchar(128),
    source varchar(64) not null,
    url text,
    original_title text,
    raw_text text not null,
    redacted_text text not null,
    redacted_categories jsonb not null default '[]'::jsonb,
    prompt_injection boolean not null default false,
    status varchar(32) not null default 'pending_approval',
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

create index if not exists idx_moderation_workspace_status
    on public.capture_moderation_queue(workspace_id, status);
