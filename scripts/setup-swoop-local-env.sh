#!/usr/bin/env bash
# Pull Swoop + Keept secrets from VPS → .env + agent-api/.env (gitignored).
#
# Usage:
#   bash scripts/setup-swoop-local-env.sh
#
# Requires: SSH to VPS (remote_cmd.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE_SH="${ROOT}/remote_cmd.sh"
DASH_ENV="/home/vladx/autoro-dashboard/.env"
BB_ENV="/home/vladx/supabase-bookmarks-prod/docker/.env.bookmarks"
BB_DOCKER_ENV="/home/vladx/supabase-bookmarks-prod/docker/.env"

if [[ ! -f "$REMOTE_SH" ]]; then
  echo "ERROR: $REMOTE_SH not found" >&2
  exit 1
fi

remote() {
  bash "$REMOTE_SH" "$@"
}

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

remote_val() {
  local file="$1"
  local key="$2"
  remote "grep '^${key}=' '${file}' 2>/dev/null" | head -1 | cut -d= -f2- | tr -d '\r' || true
}

echo "→ Fetching Swoop dashboard .env from VPS…"
MAIN_URL="$(remote_val "$DASH_ENV" "VITE_SUPABASE_URL")"
MAIN_ANON="$(remote_val "$DASH_ENV" "VITE_SUPABASE_ANON_KEY")"
SERVICE_ROLE="$(remote_val "$DASH_ENV" "SUPABASE_SERVICE_ROLE_KEY")"
AGENT_API_KEY="$(remote_val "$DASH_ENV" "AGENT_API_KEY")"
OPENROUTER="$(remote_val "$DASH_ENV" "OPENROUTER_API_KEY")"

echo "→ Fetching BB Supabase .env from VPS…"
BB_ANON="$(remote_val "$BB_ENV" "ANON_KEY")"
BB_PG_PASS="$(remote_val "$BB_ENV" "POSTGRES_PASSWORD")"
if [[ -z "$BB_PG_PASS" ]]; then
  BB_PG_PASS="$(remote_val "$BB_DOCKER_ENV" "POSTGRES_PASSWORD")"
fi

if [[ -z "$MAIN_ANON" ]]; then
  echo "ERROR: VITE_SUPABASE_ANON_KEY not found ($DASH_ENV)" >&2
  exit 1
fi

MAIN_URL="${MAIN_URL:-https://swoop.autoro.tech/supabase}"

echo "→ Writing $ENV_FILE …"
upsert_env "$ENV_FILE" "VITE_SUPABASE_URL" "$MAIN_URL"
upsert_env "$ENV_FILE" "VITE_SUPABASE_ANON_KEY" "$MAIN_ANON"
upsert_env "$ENV_FILE" "VITE_AUTH_REDIRECT_TO" "https://swoop.autoro.tech/"
upsert_env "$ENV_FILE" "VITE_DISABLE_ANTI_DEBUG" "true"
if [[ -n "$AGENT_API_KEY" ]]; then
  upsert_env "$ENV_FILE" "VITE_BOOKMARKS_API_KEY" "$AGENT_API_KEY"
  upsert_env "$ENV_FILE" "AUTORO_SCRAPE_API_KEY" "$AGENT_API_KEY"
fi
upsert_env "$ENV_FILE" "VITE_AGENT_API_PROXY_TARGET" "http://127.0.0.1:8900"

# Keept / BB (local dev against staging BB)
if [[ -n "$BB_ANON" ]]; then
  upsert_env "$ENV_FILE" "VITE_BB_SUPABASE_URL" "https://swoop.autoro.tech/bb-supabase"
  upsert_env "$ENV_FILE" "VITE_BB_SUPABASE_ANON_KEY" "$BB_ANON"
fi

echo "→ Writing $AGENT_ENV …"
upsert_env "$AGENT_ENV" "SUPABASE_URL" "$MAIN_URL"
upsert_env "$AGENT_ENV" "SUPABASE_ANON_KEY" "$MAIN_ANON"
if [[ -n "$SERVICE_ROLE" ]]; then
  upsert_env "$AGENT_ENV" "SUPABASE_SERVICE_ROLE_KEY" "$SERVICE_ROLE"
fi
if [[ -n "$AGENT_API_KEY" ]]; then
  upsert_env "$AGENT_ENV" "AGENT_API_KEY" "$AGENT_API_KEY"
  upsert_env "$AGENT_ENV" "AUTORO_SCRAPE_API_KEY" "$AGENT_API_KEY"
fi
if [[ -n "$OPENROUTER" ]]; then
  upsert_env "$AGENT_ENV" "OPENROUTER_API_KEY" "$OPENROUTER"
fi
upsert_env "$AGENT_ENV" "BOOKMARKS_SUPABASE_URL" "https://swoop.autoro.tech/bb-supabase"
if [[ -n "$BB_ANON" ]]; then
  upsert_env "$AGENT_ENV" "BOOKMARKS_SUPABASE_ANON_KEY" "$BB_ANON"
fi
upsert_env "$AGENT_ENV" "BOOKMARKS_PGHOST" "supabase-db-bookmarks"
upsert_env "$AGENT_ENV" "BOOKMARKS_PGPORT" "5433"
upsert_env "$AGENT_ENV" "BOOKMARKS_PGDATABASE" "postgres"
upsert_env "$AGENT_ENV" "BOOKMARKS_PGUSER" "postgres"
if [[ -n "$BB_PG_PASS" ]]; then
  upsert_env "$AGENT_ENV" "BOOKMARKS_PGPASSWORD" "$BB_PG_PASS"
fi

# Copy remaining dashboard keys (PG*, webhooks) without printing values
echo "→ Merging PG / backend keys from dashboard .env…"
while IFS= read -r line; do
  [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] || continue
  key="${line%%=*}"
  val="${line#*=}"
  case "$key" in
    VITE_*|NODE_ENV) continue ;;
    BOOKMARKS_*) continue ;;
  esac
  upsert_env "$AGENT_ENV" "$key" "$val"
done < <(remote "cat '$DASH_ENV' 2>/dev/null")

echo "✓ Local env synced (.env + agent-api/.env — gitignored)"
echo "  Deploy staging: npm run keept:deploy:staging"
echo "  Dev: npm run dev"
