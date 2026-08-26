-- 1. Создаем таблицу заданий
create table if not exists public.tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  status text default 'draft', -- draft, in_progress, completed, error
  instructions text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.tasks enable row level security;

-- Политики для tasks
create policy "Users can see own tasks" on public.tasks
  for select using (auth.uid() = user_id);

create policy "Users can insert own tasks" on public.tasks
  for insert with check (auth.uid() = user_id);

create policy "Users can update own tasks" on public.tasks
  for update using (auth.uid() = user_id);

create policy "Users can delete own tasks" on public.tasks
  for delete using (auth.uid() = user_id);

-- Политики для админа
create policy "Admins can see all tasks" on public.tasks
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- 2. Обновляем таблицу documents (добавляем task_id)
alter table public.documents 
add column if not exists task_id uuid references public.tasks(id) on delete cascade;

-- Обновляем RLS для documents (чтобы доступ был и через task_id, но базовая политика user_id уже работает)
-- Можно добавить индекс для скорости
create index if not exists idx_documents_task_id on public.documents(task_id);

