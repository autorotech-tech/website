-- Migration to support Personal Telegram Assistant (Phase 3.0 & 3.1)

create table if not exists public.telegram_link_codes (
  code text primary key,
  user_id uuid not null,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.telegram_link_codes enable row level security;

drop policy if exists "telegram_link_codes_rw_owner" on public.telegram_link_codes;
create policy "telegram_link_codes_rw_owner"
on public.telegram_link_codes
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());


create table if not exists public.telegram_workspace_links (
  telegram_user_id text not null,
  chat_id text primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  linked_at timestamptz not null default now()
);

alter table public.telegram_workspace_links enable row level security;

drop policy if exists "telegram_workspace_links_rw_owner" on public.telegram_workspace_links;
create policy "telegram_workspace_links_rw_owner"
on public.telegram_workspace_links
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());


create table if not exists public.user_telegram_bots (
  workspace_id bigint primary key references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  bot_token_encrypted text not null,
  bot_username text not null,
  webhook_secret text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_telegram_bots enable row level security;

drop policy if exists "user_telegram_bots_rw_owner" on public.user_telegram_bots;
create policy "user_telegram_bots_rw_owner"
on public.user_telegram_bots
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());
