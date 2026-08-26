#!/usr/bin/env bash
# Ensure Swoop scrape / agent API key exists in service_settings and sync to local .env.
#
# Scrape API auth: header X-API-Key → service_settings.agent_api_key (not a separate DB column).
# Dev convenience alias in .env: AUTORO_SCRAPE_API_KEY (= same value as AGENT_API_KEY / VITE_BOOKMARKS_API_KEY).
#
# Usage:
#   bash scripts/generate-scrape-api-key.sh           # ensure on VPS, sync local .env
#   bash scripts/generate-scrape-api-key.sh --force   # regenerate on VPS (rotates all agent-api clients)
#   npm run swoop:scrape-key
#
# Admin UI: https://swoop.autoro.tech/admin/settings → Scraping Agent — Public API

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE_SH="${ROOT}/remote_cmd.sh"
DASH_ENV="/home/vladx/autoro-dashboard/.env"
ENV_FILE="${ROOT}/.env"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      grep '^#' "$0" | head -14 | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

upsert_env() {
  local file="$1" key="$2" val="$3"
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

if [[ ! -f "$REMOTE_SH" ]]; then
  echo "ERROR: $REMOTE_SH not found" >&2
  exit 1
fi

remote_py='
import os, secrets, string, sys, psycopg2
force = sys.argv[1] == "1"
alphabet = string.ascii_letters + string.digits
def gen_key():
    return "ak_" + "".join(secrets.choice(alphabet) for _ in range(40))
conn = psycopg2.connect(
    host=os.environ.get("PGHOST", "supabase-db"),
    port=int(os.environ.get("PGPORT") or 5433),
    dbname=os.environ.get("PGDATABASE", "postgres"),
    user=os.environ.get("PGUSER", "supabase_admin"),
    password=os.environ.get("PGPASSWORD", ""),
)
try:
    with conn.cursor() as cur:
        cur.execute("SELECT agent_api_key, agent_enabled FROM public.service_settings WHERE id = 1 LIMIT 1")
        row = cur.fetchone()
        key = (row[0] if row else "") or ""
        enabled = bool(row[1]) if row else False
        if force or not str(key).strip():
            key = gen_key()
            cur.execute(
                """INSERT INTO public.service_settings (id, agent_api_key, agent_enabled, updated_at)
                   VALUES (1, %s, true, now())
                   ON CONFLICT (id) DO UPDATE SET
                     agent_api_key = EXCLUDED.agent_api_key,
                     agent_enabled = true,
                     updated_at = now()""",
                (key,),
            )
            action = "generated"
        elif not enabled:
            cur.execute("UPDATE public.service_settings SET agent_enabled = true, updated_at = now() WHERE id = 1")
            action = "enabled"
        else:
            action = "existing"
    conn.commit()
    print(action + "\t" + key)
finally:
    conn.close()
'

run_remote() {
  bash "$REMOTE_SH" "docker exec autoro-agent-api python3 -c $(printf '%q' "$remote_py") $FORCE"
}

echo "→ Scrape API key (service_settings.agent_api_key on VPS)…"
result=""
for attempt in 1 2 3; do
  if result="$(run_remote 2>/dev/null)" && [[ -n "$result" ]]; then
    break
  fi
  [[ "$attempt" -lt 3 ]] && sleep "$((attempt * 4))"
done

if [[ -z "$result" ]]; then
  echo "ERROR: SSH/DB failed after retries" >&2
  exit 1
fi

action="${result%%$'\t'*}"
api_key="${result#*$'\t'}"

if [[ -z "$api_key" ]]; then
  echo "ERROR: empty agent_api_key" >&2
  exit 1
fi

echo "  action: $action"
echo "  key prefix: ${api_key:0:12}… (len ${#api_key})"

# Sync VPS dashboard .env for n8n / scripts (no echo of secret)
bash "$REMOTE_SH" bash -s "$api_key" "$DASH_ENV" <<'REMOTE' || true
set -euo pipefail
KEY="$1"
FILE="$2"
touch "$FILE"
for name in AGENT_API_KEY AUTORO_SCRAPE_API_KEY; do
  if grep -q "^${name}=" "$FILE" 2>/dev/null; then
    sed -i "s|^${name}=.*|${name}=${KEY}|" "$FILE"
  else
    echo "${name}=${KEY}" >> "$FILE"
  fi
done
REMOTE

upsert_env "$ENV_FILE" "AUTORO_SCRAPE_API_KEY" "$api_key"
upsert_env "$ENV_FILE" "VITE_BOOKMARKS_API_KEY" "$api_key"
upsert_env "${ROOT}/agent-api/.env" "AGENT_API_KEY" "$api_key"
upsert_env "${ROOT}/agent-api/.env" "AUTORO_SCRAPE_API_KEY" "$api_key"

echo "✓ Written to .env and agent-api/.env (gitignored)"
echo ""
echo "Use in requests:"
echo "  source .env   # or: export AUTORO_SCRAPE_API_KEY=\$(grep ^AUTORO_SCRAPE_API_KEY= .env | cut -d= -f2-)"
echo "  curl -sS -X POST 'https://swoop.autoro.tech/api/v1/scrape' \\"
echo "    -H \"X-API-Key: \$AUTORO_SCRAPE_API_KEY\" \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"url\":\"https://example.com\",\"mode\":\"fetcher\",\"output_format\":\"markdown\"}'"
echo ""
echo "Admin: https://swoop.autoro.tech/admin/settings → Scraping Agent — Public API (Generate / Copy)"
