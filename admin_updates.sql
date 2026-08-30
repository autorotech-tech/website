-- 1. Добавляем статус блокировки
alter table public.profiles 
add column if not exists is_blocked boolean default false;

-- 2. Политики для profiles
-- Admins can update any profile (to block/unblock)
create policy "Admins can update all profiles" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- 3. Глобальная политика блокировки (сложно сделать одну на все, поэтому обновляем политики таблиц)
-- Вместо переписывания всех политик, мы будем проверять блокировку на уровне API/Frontend, 
-- или добавить условие `AND NOT (select is_blocked from profiles where id = auth.uid())` во все политики.
-- Пока сделаем просто поле, и учтем его в админке.

-- 4. Политики для Tasks (расширение прав админа)
-- Admins can delete all tasks
create policy "Admins can delete all tasks" on public.tasks
  for delete using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- 5. Политики для Documents (расширение прав админа)
-- Admins can delete all documents (уже есть через cascade delete tasks, но добавим прямое)
create policy "Admins can delete all documents" on public.documents
  for delete using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Admins can select all documents
create policy "Admins can select all documents" on public.documents
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

