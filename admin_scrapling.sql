-- Supabase schema for Scrapling integration
-- Таблица очереди задач веб-скрапинга для Scrapling-воркера

create table if not exists public.scrapling_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  url text not null,
  mode text not null default 'fetcher',            -- fetcher | stealth | dynamic
  selector text,

  status text not null default 'queued',           -- queued | running | done | error
  result_path text,                                -- путь в bucket user_uploads (scrapling-results/...)
  result_preview text,                             -- краткий фрагмент результата
  error_message text
);

alter table public.scrapling_jobs enable row level security;

-- Админы могут управлять всеми задачами Scrapling
create policy if not exists "Admins can manage scrapling jobs"
on public.scrapling_jobs
for all
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

