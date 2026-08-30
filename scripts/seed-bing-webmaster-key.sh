#!/usr/bin/env bash
# Seed Bing Webmaster API key into Swoop service_settings (VPS).
# Reads key from a local env file; does not print it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
ENV_FILE="${BING_WEBMASTER_ENV_FILE:-$HOME/Desktop/n8n/Bing webmaster API.env}"
SSH_OPTS=(-i "$SSH_KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file" >&2
  exit 1
fi

BK="$(python3 -c "
import re, pathlib
text = pathlib.Path(r'''$ENV_FILE''').read_text()
m = re.search(r'[0-9a-fA-F]{32}', text)
if not m:
    raise SystemExit('no 32-char hex key in env file')
print(m.group(0), end='')
")"

if [[ ${#BK} -ne 32 ]]; then
  echo "unexpected key length ${#BK}" >&2
  exit 1
fi

echo "seeding bing webmaster key (len=${#BK})"
scp "${SSH_OPTS[@]}" "$ROOT/scripts/seed_bing_webmaster.py" "$REMOTE:/tmp/seed_bing_webmaster.py"
ssh "${SSH_OPTS[@]}" "$REMOTE" "docker cp /tmp/seed_bing_webmaster.py autoro-agent-api:/tmp/seed_bing_webmaster.py && docker exec -e BK='$BK' autoro-agent-api python3 /tmp/seed_bing_webmaster.py"
ssh "${SSH_OPTS[@]}" "$REMOTE" 'docker exec autoro-agent-api python3 -c "
import os, json, urllib.request, psycopg2
conn = psycopg2.connect(
    host=os.environ.get(\"PGHOST\", \"supabase-db\"),
    port=int(os.environ.get(\"PGPORT\") or 5433),
    dbname=os.environ.get(\"PGDATABASE\", \"postgres\"),
    user=os.environ.get(\"PGUSER\", \"supabase_admin\"),
    password=os.environ.get(\"PGPASSWORD\", \"\"),
)
cur = conn.cursor()
cur.execute(\"select agent_api_key from public.service_settings where id=1\")
ak = (cur.fetchone() or [\"\"])[0] or \"\"
conn.close()
for path in (\"/api/v1/bing/webmaster/sites\", \"/api/v1/bing/webmaster/quota\"):
    req = urllib.request.Request(
        \"http://127.0.0.1:8900\" + path,
        headers={\"X-API-Key\": ak, \"Accept\": \"application/json\"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = json.loads(resp.read().decode())
            if path.endswith(\"/sites\"):
                print(json.dumps({
                    \"sites_http\": resp.getcode(),
                    \"ok\": body.get(\"ok\"),
                    \"count\": body.get(\"count\"),
                    \"urls\": [s.get(\"url\") for s in (body.get(\"sites\") or [])],
                    \"verified\": [s.get(\"is_verified\") for s in (body.get(\"sites\") or [])],
                }))
            else:
                quota = body.get(\"quota\") if isinstance(body.get(\"quota\"), dict) else {}
                print(json.dumps({
                    \"quota_http\": resp.getcode(),
                    \"ok\": body.get(\"ok\"),
                    \"site_url\": body.get(\"site_url\"),
                    \"daily\": quota.get(\"DailyQuota\"),
                    \"monthly\": quota.get(\"MonthlyQuota\"),
                }))
    except Exception as exc:
        print(json.dumps({\"path\": path, \"error\": type(exc).__name__, \"msg\": str(exc)[:200]}))
"'
