#!/usr/bin/env bash
# Принудительный refresh кэша OpenRouter через agent-api (читает agent_api_key из Postgres).
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/home/vladx/autoro-dashboard}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env}"
LOG_DIR="${LOG_DIR:-/home/vladx/logs}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/swoop-openrouter-refresh.log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

AGENT_KEY=""
if docker ps --filter name=autoro-agent-api --filter status=running -q | grep -q .; then
  AGENT_KEY="$(docker exec autoro-agent-api python3 - <<'PY' 2>/dev/null || true
import os, psycopg2
conn = psycopg2.connect(
    host=os.environ.get("PGHOST","supabase-db"),
    port=int(os.environ.get("PGPORT") or 5433),
    dbname=os.environ.get("PGDATABASE","postgres"),
    user=os.environ.get("PGUSER","supabase_admin"),
    password=os.environ.get("PGPASSWORD",""),
)
cur = conn.cursor()
cur.execute("SELECT agent_api_key FROM public.service_settings WHERE id=1 LIMIT 1")
row = cur.fetchone()
print((row[0] or "").strip() if row else "")
conn.close()
PY
)"
fi

if [[ -z "$AGENT_KEY" ]]; then
  log "skip: agent_api_key not found"
  exit 0
fi

code=$(curl -sS -m 120 -o /tmp/or-refresh.json -w '%{http_code}' \
  -X POST "http://127.0.0.1/api/v1/admin/openrouter/refresh" \
  -H "Host: swoop.autoro.tech" \
  -H "X-API-Key: $AGENT_KEY" || echo 000)

if [[ "$code" == "200" ]]; then
  log "ok $(tr -d '\n' < /tmp/or-refresh.json | head -c 200)"
else
  log "fail HTTP $code $(head -c 200 /tmp/or-refresh.json 2>/dev/null || true)"
  exit 1
fi
