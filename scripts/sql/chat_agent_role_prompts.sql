-- Admin-editable Chat Agent role prompts (sales / support).
-- Empty system_prompt → chat-gateway uses AskPQuoc / pquoc.com code defaults.
-- Idempotent.

create table if not exists public.chat_agent_role_prompts (
  role text primary key check (role in ('sales', 'support')),
  system_prompt text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.chat_agent_role_prompts enable row level security;

drop policy if exists "chat_agent_role_prompts_admin_all" on public.chat_agent_role_prompts;
create policy "chat_agent_role_prompts_admin_all"
  on public.chat_agent_role_prompts
  for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

grant select, insert, update, delete on table public.chat_agent_role_prompts to authenticated;
grant all on table public.chat_agent_role_prompts to service_role;

insert into public.chat_agent_role_prompts (role, system_prompt)
values ('sales', ''), ('support', '')
on conflict (role) do nothing;
