-- Bookmarks Bro MVP (Week 1) core schema
-- Fast-track schema for sync ingest and job tracking.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ------------------------------------------------------------
-- Minimal multi-tenant foundation for isolated BB Supabase
-- (owner-only v1; can be extended to workspace_members later).
-- ------------------------------------------------------------

create table if not exists public.workspaces (
  id bigserial primary key,
  owner_id uuid not null,
  name text not null default 'Default Workspace',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspaces_owner on public.workspaces(owner_id);

alter table public.workspaces enable row level security;

drop policy if exists "workspaces_select_owner" on public.workspaces;
create policy "workspaces_select_owner"
on public.workspaces
for select
using (owner_id = auth.uid());

drop policy if exists "workspaces_insert_owner" on public.workspaces;
create policy "workspaces_insert_owner"
on public.workspaces
for insert
with check (owner_id = auth.uid());

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner"
on public.workspaces
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
on public.workspaces
for delete
using (owner_id = auth.uid());

create table if not exists public.browser_profiles (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  browser_type text not null check (browser_type in ('chrome','edge','brave','opera','firefox')),
  profile_external_id text not null,
  display_name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, browser_type, profile_external_id)
);

alter table public.browser_profiles enable row level security;
drop policy if exists "browser_profiles_rw_owner" on public.browser_profiles;
create policy "browser_profiles_rw_owner"
on public.browser_profiles
for all
using (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
)
with check (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
);

create table if not exists public.bookmarks_bro_bookmarks (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  profile_id bigint references public.browser_profiles(id) on delete set null,
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
  unique (workspace_id, url_hash)
);

create index if not exists idx_bbb_workspace on public.bookmarks_bro_bookmarks(workspace_id);
create index if not exists idx_bbb_profile on public.bookmarks_bro_bookmarks(profile_id);
create index if not exists idx_bbb_last_seen on public.bookmarks_bro_bookmarks(last_seen_at desc);

alter table public.bookmarks_bro_bookmarks enable row level security;
drop policy if exists "bookmarks_bro_bookmarks_rw_owner" on public.bookmarks_bro_bookmarks;
create policy "bookmarks_bro_bookmarks_rw_owner"
on public.bookmarks_bro_bookmarks
for all
using (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
)
with check (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
);

create table if not exists public.bookmark_page_content (
  bookmark_id bigint primary key references public.bookmarks_bro_bookmarks(id) on delete cascade,
  fetch_status text not null check (fetch_status in ('pending','ok','failed','blocked')),
  http_status int,
  content_text text,
  content_hash text,
  fetched_at timestamptz,
  fetch_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookmark_page_content enable row level security;
drop policy if exists "bookmark_page_content_rw_owner" on public.bookmark_page_content;
create policy "bookmark_page_content_rw_owner"
on public.bookmark_page_content
for all
using (
  bookmark_id in (
    select b.id
    from public.bookmarks_bro_bookmarks b
    join public.workspaces w on w.id = b.workspace_id
    where w.owner_id = auth.uid()
  )
)
with check (
  bookmark_id in (
    select b.id
    from public.bookmarks_bro_bookmarks b
    join public.workspaces w on w.id = b.workspace_id
    where w.owner_id = auth.uid()
  )
);

create table if not exists public.bookmark_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  profile_id bigint references public.browser_profiles(id) on delete set null,
  status text not null check (status in ('queued','running','completed','failed','partial','cancelled')),
  total_items int not null default 0,
  processed_items int not null default 0,
  failed_items int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_bsj_workspace on public.bookmark_sync_jobs(workspace_id);
create index if not exists idx_bsj_status on public.bookmark_sync_jobs(status);

alter table public.bookmark_sync_jobs enable row level security;
drop policy if exists "bookmark_sync_jobs_rw_owner" on public.bookmark_sync_jobs;
create policy "bookmark_sync_jobs_rw_owner"
on public.bookmark_sync_jobs
for all
using (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
)
with check (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
);

create table if not exists public.bookmark_job_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bookmark_sync_jobs(id) on delete cascade,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  bookmark_id bigint references public.bookmarks_bro_bookmarks(id) on delete cascade,
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

create index if not exists idx_bjt_pick on public.bookmark_job_tasks(status, priority, available_at);
create index if not exists idx_bjt_job on public.bookmark_job_tasks(job_id);

alter table public.bookmark_job_tasks enable row level security;
drop policy if exists "bookmark_job_tasks_rw_owner" on public.bookmark_job_tasks;
create policy "bookmark_job_tasks_rw_owner"
on public.bookmark_job_tasks
for all
using (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
)
with check (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
);
