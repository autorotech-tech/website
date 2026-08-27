-- 1. Создаем таблицу профилей (для ролей)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  role text default 'user',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Политики для profiles
create policy "Public profiles are viewable by everyone." on public.profiles
  for select using (true);

create policy "Users can insert their own profile." on public.profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on public.profiles
  for update using (auth.uid() = id);

-- Триггер для автоматического создания профиля при регистрации
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do update set email = excluded.email;
  insert into public.chat_agents (owner_user_id, name, status, default_lang, data_region, bot_role)
  select new.id, 'Sales consultant', 'active', 'ru', 'global', 'sales'
  where not exists (
    select 1 from public.chat_agents where owner_user_id = new.id
  );
  return new;
end;
$$ language plpgsql security definer;

-- Удаляем триггер если есть, чтобы не дублировать
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Создаем таблицу документов
create table if not exists public.documents (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  filename text not null,
  file_path text not null,
  file_type text,
  file_size bigint,
  status text default 'uploaded', -- uploaded, processing, analyzed, error
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.documents enable row level security;

-- Политики для documents
create policy "Users can see own documents" on public.documents
  for select using (auth.uid() = user_id);

create policy "Users can insert own documents" on public.documents
  for insert with check (auth.uid() = user_id);

create policy "Users can delete own documents" on public.documents
  for delete using (auth.uid() = user_id);

-- Политика для админа (чтение и удаление всего)
create policy "Admins can see all documents" on public.documents
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "Admins can delete all documents" on public.documents
  for delete using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- 3. Настройка Storage
-- В Supabase Storage бакеты создаются через API или SQL (в схеме storage)
insert into storage.buckets (id, name, public)
values ('user_uploads', 'user_uploads', false)
on conflict (id) do nothing;

-- Политики Storage
-- Разрешить пользователю загружать в свою папку: user_uploads/{user_id}/*
create policy "User can upload own files" on storage.objects
  for insert with check (
    bucket_id = 'user_uploads' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "User can view own files" on storage.objects
  for select using (
    bucket_id = 'user_uploads' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "User can delete own files" on storage.objects
  for delete using (
    bucket_id = 'user_uploads' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Политики Storage для Админа
create policy "Admin can view all files" on storage.objects
  for select using (
    bucket_id = 'user_uploads' and
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "Admin can delete all files" on storage.objects
  for delete using (
    bucket_id = 'user_uploads' and
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Назначение админа (подставьте email)
-- update public.profiles set role = 'admin' where email = 'autoro.tech@gmail.com';

