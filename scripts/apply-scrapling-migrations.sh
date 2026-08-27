#!/usr/bin/env bash
# Apply scrapling_jobs schema migrations on main Supabase Postgres (supabase-db).
set -euo pipefail

REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60)

for f in \
  "$ROOT/scrapling-worker/migrate_service_settings.sql" \
  "$ROOT/migrate_scrapling_v3.sql" \
  "$ROOT/migrate_scrapling_v4.sql"
do
  [[ -f "$f" ]] || { echo "missing: $f" >&2; exit 1; }
done

tar czf /tmp/scrapling-migrate.tgz \
  -C "$ROOT/scrapling-worker" migrate_service_settings.sql \
  -C "$ROOT" migrate_scrapling_v3.sql migrate_scrapling_v4.sql

scp "${SSH_OPTS[@]}" /tmp/scrapling-migrate.tgz "$REMOTE:/tmp/scrapling-migrate.tgz"

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p /tmp/scrapling-migrate
tar xzf /tmp/scrapling-migrate.tgz -C /tmp/scrapling-migrate
DB=supabase-db
for sql in migrate_service_settings.sql migrate_scrapling_v3.sql migrate_scrapling_v4.sql; do
  echo "=== $sql ==="
  docker exec -i "$DB" psql -U postgres -d postgres < "/tmp/scrapling-migrate/$sql"
done
docker exec "$DB" psql -U postgres -d postgres -c "\d public.scrapling_jobs" | head -40
REMOTE

echo "✅ Scrapling migrations applied on $REMOTE"
