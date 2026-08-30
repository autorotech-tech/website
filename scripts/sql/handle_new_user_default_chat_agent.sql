-- Default Chat Agent for every new signup (Google / email).
-- Idempotent: safe to re-run. Does not change existing profile roles.

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
