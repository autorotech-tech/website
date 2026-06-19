#!/usr/bin/env bash
# Pull Keept staging secrets from VPS → local .env + agent-api/.env (gitignored).
#
# Usage:
#   bash scripts/setup-keept-local-env.sh
#   bash scripts/setup-keept-local-env.sh --github-secrets   # also push to AuthRAG repo secrets
#
# Requires: SSH to VPS (see remote_cmd.sh / ~/.ssh/config Host autoro)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE_SH="${ROOT}/remote_cmd.sh"
BB_ENV="/home/vladx/supabase-bookmarks-prod/docker/.env.bookmarks"
DASH_ENV="/home/vladx/autoro-dashboard/.env"
PUSH_GH=0

for arg in "$@"; do
  case "$arg" in
    --github-secrets) PUSH_GH=1 ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
  esac
done

if [[ ! -x "$REMOTE_SH" ]] && [[ ! -f "$REMOTE_SH" ]]; then
  echo "ERROR: $REMOTE_SH not found" >&2
  exit 1
fi

remote() {
  bash "$REMOTE_SH" "$@"
}

echo "→ Fetching BB Supabase vars from VPS…"
ANON_KEY="$(remote "grep '^ANON_KEY=' '$BB_ENV' 2>/dev/null" | cut -d= -f2- | tr -d '\r' || true)"
POSTGRES_PASSWORD="$(remote "grep '^POSTGRES_PASSWORD=' '$BB_ENV' 2>/dev/null" | cut -d= -f2- | tr -d '\r' || true)"
AGENT_API_KEY="$(remote "grep '^AGENT_API_KEY=' '$DASH_ENV' 2>/dev/null" | cut -d= -f2- | tr -d '\r' || true)"

if [[ -z "$ANON_KEY" ]]; then
  echo "ERROR: ANON_KEY not found on VPS ($BB_ENV)" >&2
  exit 1
fi

ENV_FILE="$ROOT/.env"
AGENT_ENV="$ROOT/agent-api/.env"

upsert_env() {
  local file="$1"
  local key="$2"
  local val="$3"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    if [[ "$(uname)" == Darwin ]]; then
      sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
    else
      sed -i "s|^${key}=.*|${key}=${val}|" "$file"
    fi
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "→ Writing $ENV_FILE (Keept frontend + smoke)…"
upsert_env "$ENV_FILE" "VITE_SUPABASE_URL" "https://swoop.autoro.tech/bb-supabase"
upsert_env "$ENV_FILE" "VITE_SUPABASE_ANON_KEY" "$ANON_KEY"
upsert_env "$ENV_FILE" "VITE_AGENT_API_PROXY_TARGET" "http://127.0.0.1:8900"
if [[ -n "$AGENT_API_KEY" ]]; then
  upsert_env "$ENV_FILE" "VITE_BOOKMARKS_API_KEY" "$AGENT_API_KEY"
fi

echo "→ Writing $AGENT_ENV (local agent-api → BB stack)…"
upsert_env "$AGENT_ENV" "BOOKMARKS_SUPABASE_URL" "https://swoop.autoro.tech/bb-supabase"
upsert_env "$AGENT_ENV" "BOOKMARKS_SUPABASE_ANON_KEY" "$ANON_KEY"
upsert_env "$AGENT_ENV" "BOOKMARKS_PGHOST" "supabase-db-bookmarks"
upsert_env "$AGENT_ENV" "BOOKMARKS_PGPORT" "5432"
upsert_env "$AGENT_ENV" "BOOKMARKS_PGDATABASE" "postgres"
upsert_env "$AGENT_ENV" "BOOKMARKS_PGUSER" "postgres"
if [[ -n "$POSTGRES_PASSWORD" ]]; then
  upsert_env "$AGENT_ENV" "BOOKMARKS_PGPASSWORD" "$POSTGRES_PASSWORD"
fi

echo "✓ Local env ready (.env + agent-api/.env are gitignored)"
echo "  npm run dev"
echo "  cd agent-api && uvicorn main:app --port 8900"

if [[ "$PUSH_GH" -eq 1 ]]; then
  bash "$SCRIPT_DIR/setup-keept-github-secrets.sh"
fi
