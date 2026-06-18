#!/usr/bin/env bash
set -euo pipefail

BOOKMARKS_ENV_SOURCE="${BOOKMARKS_ENV_SOURCE:-/home/vladx/supabase-bookmarks-prod/docker/.env.bookmarks}"
AGENT_COMPOSE_DIR="${AGENT_COMPOSE_DIR:-/home/vladx/autoro-dashboard}"
AGENT_OVERRIDE_FILE="${AGENT_OVERRIDE_FILE:-/home/vladx/bookmarks-bro-supabase/docker-compose.agent-api.bookmarks.override.yml}"

docker network inspect bookmarks_bro_supabase_net >/dev/null 2>&1 || docker network create bookmarks_bro_supabase_net
docker network connect bookmarks_bro_supabase_net supabase-db-bookmarks 2>/dev/null || true
docker network connect bookmarks_bro_supabase_net supabase-kong-bookmarks 2>/dev/null || true

awk -F= '
BEGIN{
  print "BOOKMARKS_SUPABASE_URL=http://supabase-kong-bookmarks:8000";
  print "BOOKMARKS_PGHOST=supabase-db-bookmarks";
  print "BOOKMARKS_PGPORT=5432";
  print "BOOKMARKS_PGDATABASE=postgres";
  print "BOOKMARKS_PGUSER=postgres";
}
$1=="ANON_KEY"{print "BOOKMARKS_SUPABASE_ANON_KEY="$2}
$1=="POSTGRES_PASSWORD"{print "BOOKMARKS_PGPASSWORD="$2}
' "${BOOKMARKS_ENV_SOURCE}" > /tmp/bookmarks_agent.env

cd "${AGENT_COMPOSE_DIR}"
set -a
# shellcheck disable=SC1091
source /tmp/bookmarks_agent.env
set +a

docker-compose -f docker-compose.yml -f "${AGENT_OVERRIDE_FILE}" up -d --build agent-api
docker inspect autoro-agent-api --format '{{range .Config.Env}}{{println .}}{{end}}' | awk '/^BOOKMARKS_/{print}'
