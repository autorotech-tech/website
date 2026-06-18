-- Bookmarks Bro: изолированная схема + owner-only RLS
-- Применять в ОТДЕЛЬНОМ Supabase стеке (supabase-bb), чтобы не пересекаться с существующей KB.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

create schema if not exists bookmarks_bro;

-- Профиль устройства пользователя (Chrome/Edge/...).
create table if not exists bookmarks_bro.browser_profiles (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  browser_type text not null check (browser_type in ('chrome','edge','brave','opera','firefox')),
  profile_external_id text not null,
  display_name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, browser_type, profile_external_id)
);

create table if not exists bookmarks_bro.bookmarks (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_id bigint references bookmarks_bro.browser_profiles(id) on delete set null,
  source_bookmark_id text,
  parent_path text,
  title text not null,
  url text not null,
  url_normalized text not null,
  url_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, url_hash)
);
create index if not exists idx_bb_bookmarks_owner on bookmarks_bro.bookmarks(owner_id);
create index if not exists idx_bb_bookmarks_profile on bookmarks_bro.bookmarks(profile_id);
create index if not exists idx_bb_bookmarks_last_seen on bookmarks_bro.bookmarks(last_seen_at desc);

create table if not exists bookmarks_bro.page_content (
  bookmark_id bigint primary key references bookmarks_bro.bookmarks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  fetch_status text not null check (fetch_status in ('pending','ok','failed','blocked')),
  http_status int,
  content_text text,
  content_hash text,
  summary text,
  category text,
  tags jsonb,
  embedding vector(1536),
  fetched_at timestamptz,
  fetch_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bb_page_owner on bookmarks_bro.page_content(owner_id);
create index if not exists idx_bb_page_status on bookmarks_bro.page_content(fetch_status);

create table if not exists bookmarks_bro.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_id bigint references bookmarks_bro.browser_profiles(id) on delete set null,
  status text not null check (status in ('queued','running','completed','failed','partial','cancelled')),
  total_items int not null default 0,
  processed_items int not null default 0,
  failed_items int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists idx_bb_jobs_owner on bookmarks_bro.sync_jobs(owner_id);
create index if not exists idx_bb_jobs_status on bookmarks_bro.sync_jobs(status);

create table if not exists bookmarks_bro.job_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references bookmarks_bro.sync_jobs(id) on delete cascade,
  bookmark_id bigint references bookmarks_bro.bookmarks(id) on delete cascade,
  task_type text not null check (task_type in ('fetch_content','enrich','embed','link_check')),
  status text not null check (status in ('queued','running','done','failed','retry')),
  priority int not null default 100,
  attempts int not null default 0,
  max_attempts int not null default 3,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bb_tasks_pick on bookmarks_bro.job_tasks(status, priority, available_at);
create index if not exists idx_bb_tasks_owner on bookmarks_bro.job_tasks(owner_id);

-- --- RLS ---
alter table bookmarks_bro.browser_profiles enable row level security;
alter table bookmarks_bro.bookmarks enable row level security;
alter table bookmarks_bro.page_content enable row level security;
alter table bookmarks_bro.sync_jobs enable row level security;
alter table bookmarks_bro.job_tasks enable row level security;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'browser_profiles',
      'bookmarks',
      'page_content',
      'sync_jobs',
      'job_tasks'
    ])
  loop
    execute format('drop policy if exists p_%s_select on bookmarks_bro.%s', t, t);
    execute format('drop policy if exists p_%s_insert on bookmarks_bro.%s', t, t);
    execute format('drop policy if exists p_%s_update on bookmarks_bro.%s', t, t);
    execute format('drop policy if exists p_%s_delete on bookmarks_bro.%s', t, t);

    execute format('create policy p_%s_select on bookmarks_bro.%s for select using (owner_id = auth.uid())', t, t);
    execute format('create policy p_%s_insert on bookmarks_bro.%s for insert with check (owner_id = auth.uid())', t, t);
    execute format('create policy p_%s_update on bookmarks_bro.%s for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t, t);
    execute format('create policy p_%s_delete on bookmarks_bro.%s for delete using (owner_id = auth.uid())', t, t);
  end loop;
end$$;

-- Service role/full backend доступ:
grant usage on schema bookmarks_bro to service_role;
grant all on all tables in schema bookmarks_bro to service_role;
grant all on all sequences in schema bookmarks_bro to service_role;

