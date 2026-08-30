-- Создаем профили для тех, у кого их нет
insert into public.profiles (id, email)
select id, email from auth.users
where id not in (select id from public.profiles);

-- Назначаем админов
update public.profiles
set role = 'admin'
where email in ('autoro.tech@gmail.com', 'tech@autoro.tech');

