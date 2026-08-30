#!/usr/bin/env bash
# Ensure Swoop admin emails have profiles.role=admin in main Supabase Postgres.
set -euo pipefail

REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60)

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E '^supabase-db$' | head -1)
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E '^supabase-db-' | grep -v bookmarks | grep -v pquoc | head -1)
fi
if [[ -z "$DB_CONTAINER" ]]; then
  echo "ERROR: supabase db container not found" >&2
  docker ps --format '{{.Names}}' | head -20
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres <<'SQL'
insert into public.profiles (id, email)
select id, email from auth.users
where id not in (select id from public.profiles)
on conflict do nothing;

update public.profiles
set role = 'admin'
where lower(email) in ('autoro.tech@gmail.com', 'tech@autoro.tech');

select email, role from public.profiles
where lower(email) in ('autoro.tech@gmail.com', 'tech@autoro.tech');
SQL
REMOTE

echo "✅ Admin roles updated. Log out / log in on swoop.autoro.tech"
