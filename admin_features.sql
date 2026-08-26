-- Добавляем статусы для документов и задач
alter table public.documents 
add column if not exists virus_status text default 'pending'; -- pending, clean, infected

alter table public.tasks 
add column if not exists rag_status text default 'pending'; -- pending, processing, ready

-- Политики Storage для Админа (bucket 'user_uploads')
-- Нужно убедиться, что RLS на storage.objects включен и добавить политику
-- (В Supabase Storage политики создаются через API или SQL в схеме storage)

create policy "Admins can select all storage objects"
on storage.objects for select
using (
  bucket_id = 'user_uploads' 
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  )
);

