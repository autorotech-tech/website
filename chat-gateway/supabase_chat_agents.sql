-- Chat Agent (product) tables for Supabase
-- Minimal schema to support:
-- - bots (chat_agents)
-- - allowed domains (chat_agent_domains)
-- Used by chat-gateway via service-role key (server-side).

create table if not exists public.chat_agents (
  id uuid default gen_random_uuid() primary key,
  owner_user_id uuid references auth.users on delete cascade not null,
  name text not null,
  status text default 'active', -- active|disabled
  default_lang text default 'en',
  data_region text default 'global', -- global|ru (future)
  -- One client = one workflow: store n8n webhook URL per bot.
  n8n_webhook_url text,
  telegram_bot_token text,
  whatsapp_phone_id text,
  bot_role text default 'support', -- support|sales
  created_at timestamptz default now()
);

alter table public.chat_agents add column if not exists bot_role text default 'support';

alter table public.chat_agents enable row level security;

create table if not exists public.chat_agent_domains (
  id bigserial primary key,
  bot_id uuid references public.chat_agents(id) on delete cascade not null,
  domain text not null,
  created_at timestamptz default now(),
  unique (bot_id, domain)
);

alter table public.chat_agent_domains enable row level security;

create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  bot_id uuid references public.chat_agents(id) on delete cascade not null,
  session_id text not null,
  platform text not null,
  role text not null, -- 'user' | 'assistant' | 'system'
  content text not null,
  created_at timestamptz default now()
);

alter table public.chat_messages enable row level security;

-- RPC match_bot_documents for native RAG search scoped by bot_id inside JSONB metadata
create or replace function match_bot_documents(
  query_embedding vector(768),
  match_count int DEFAULT null,
  filter jsonb DEFAULT '{}'
) returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;


-- Policies: owners can manage their bots/domains
drop policy if exists "chat_agents_select_own" on public.chat_agents;
create policy "chat_agents_select_own" on public.chat_agents
  for select using (auth.uid() = owner_user_id);

drop policy if exists "chat_agents_insert_own" on public.chat_agents;
create policy "chat_agents_insert_own" on public.chat_agents
  for insert with check (auth.uid() = owner_user_id);

drop policy if exists "chat_agents_update_own" on public.chat_agents;
create policy "chat_agents_update_own" on public.chat_agents
  for update using (auth.uid() = owner_user_id);

drop policy if exists "chat_agents_delete_own" on public.chat_agents;
create policy "chat_agents_delete_own" on public.chat_agents
  for delete using (auth.uid() = owner_user_id);

drop policy if exists "chat_agent_domains_select_own" on public.chat_agent_domains;
create policy "chat_agent_domains_select_own" on public.chat_agent_domains
  for select using (
    exists (
      select 1 from public.chat_agents a
      where a.id = chat_agent_domains.bot_id and a.owner_user_id = auth.uid()
    )
  );

drop policy if exists "chat_agent_domains_insert_own" on public.chat_agent_domains;
create policy "chat_agent_domains_insert_own" on public.chat_agent_domains
  for insert with check (
    exists (
      select 1 from public.chat_agents a
      where a.id = chat_agent_domains.bot_id and a.owner_user_id = auth.uid()
    )
  );

drop policy if exists "chat_agent_domains_delete_own" on public.chat_agent_domains;
create policy "chat_agent_domains_delete_own" on public.chat_agent_domains
  for delete using (
    exists (
      select 1 from public.chat_agents a
      where a.id = chat_agent_domains.bot_id and a.owner_user_id = auth.uid()
    )
  );


