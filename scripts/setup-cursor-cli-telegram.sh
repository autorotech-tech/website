#!/usr/bin/env bash
# Настройка Cursor CLI для Telegram /cursor (n8n → agent-api → host bridge).
#
# Что делает на VPS:
# 1) ставит Cursor Agent CLI (`agent`) если нет
# 2) поднимает scripts/cursor-cli-bridge.py (systemd user или nohup)
# 3) прописывает HERMES_* / CURSOR_* в autoro-dashboard/.env
# 4) копирует agent-api/main.py и пересоздаёт agent-api
# 5) прописывает HERMES_AGENT_API_URL/KEY в n8n (+ task-runners) и рестартит
#
# Usage (с Mac):
#   export CURSOR_API_KEY='key_...'   # обязательно для реального ответа
#   bash scripts/setup-cursor-cli-telegram.sh
#
# Env:
#   REMOTE / SSH_KEY / REMOTE_DASHBOARD_DIR / REMOTE_N8N_DIR / CURSOR_BRIDGE_TOKEN
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
DASH="${REMOTE_DASHBOARD_DIR:-/home/vladx/autoro-dashboard}"
N8N_DIR="${REMOTE_N8N_DIR:-/home/vladx/projects/n8n}"
WORKSPACE_DEFAULT="${HERMES_CURSOR_WORKSPACE:-/home/vladx/autoro.tech/website}"
BRIDGE_TOKEN="${CURSOR_BRIDGE_TOKEN:-autoro_cursor_bridge_v1}"
BRIDGE_PORT="${CURSOR_BRIDGE_PORT:-8791}"

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "[warn] CURSOR_API_KEY не задан локально — bridge поднимется, но agent вернёт Authentication required." >&2
  echo "       Получите ключ в Cursor Dashboard → API Keys и: export CURSOR_API_KEY=..." >&2
fi

echo "[1/6] Upload bridge + agent-api main.py ..."
scp -i "$KEY" -o ConnectTimeout=25 \
  "$ROOT/scripts/cursor-cli-bridge.py" \
  "$ROOT/agent-api/main.py" \
  "$ROOT/docker-compose.yml" \
  "$REMOTE:/tmp/"

CURSOR_KEY_ARG="${CURSOR_API_KEY:-__NONE__}"
ssh -i "$KEY" -o ConnectTimeout=25 "$REMOTE" bash -s -- "$DASH" "$N8N_DIR" "$WORKSPACE_DEFAULT" "$BRIDGE_TOKEN" "$BRIDGE_PORT" "$CURSOR_KEY_ARG" <<'REMOTE'
set -euo pipefail
DASH="$1"
N8N_DIR="$2"
WORKSPACE="$3"
BRIDGE_TOKEN="$4"
BRIDGE_PORT="$5"
_raw_key="${6:-}"
if [[ "$_raw_key" == "__NONE__" ]]; then
  CURSOR_API_KEY_VAL=""
else
  CURSOR_API_KEY_VAL="$_raw_key"
fi

mkdir -p "$HOME/bin" "$HOME/.config/autoro" "$HOME/.local/bin"
cp -f /tmp/cursor-cli-bridge.py "$HOME/bin/cursor-cli-bridge.py"
chmod +x "$HOME/bin/cursor-cli-bridge.py"

# Install Cursor Agent CLI if missing
if ! command -v agent >/dev/null 2>&1 && [[ ! -x "$HOME/.local/bin/agent" ]]; then
  echo "[2/6] Installing Cursor Agent CLI ..."
  curl -fsS https://cursor.com/install | bash
else
  echo "[2/6] Cursor Agent CLI already present"
fi
export PATH="$HOME/.local/bin:$PATH"
command -v agent || true
agent --version || true

# Upsert dashboard .env keys (no echo of secrets)
ENVF="$DASH/.env"
touch "$ENVF"
upsert() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENVF" 2>/dev/null; then
    # portable sed
    python3 - "$ENVF" "$key" "$val" <<'PY'
import sys
from pathlib import Path
path, key, val = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines = path.read_text(errors="replace").splitlines()
out=[]
found=False
for ln in lines:
    if ln.startswith(key+"="):
        out.append(f"{key}={val}")
        found=True
    else:
        out.append(ln)
if not found:
    out.append(f"{key}={val}")
path.write_text("\n".join(out).rstrip()+"\n")
PY
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENVF"
  fi
}

upsert HERMES_ENABLE_CURSOR_CLI 1
upsert HERMES_CURSOR_BRIDGE_TOKEN "$BRIDGE_TOKEN"
upsert CURSOR_BRIDGE_TOKEN "$BRIDGE_TOKEN"
upsert HERMES_CURSOR_TIMEOUT_SEC 240
if [[ -n "$CURSOR_API_KEY_VAL" ]]; then
  upsert CURSOR_API_KEY "$CURSOR_API_KEY_VAL"
fi

# After agent install, prefer in-container agent (docker cannot reach host:8791 on this VPS).
REAL_AGENT="$(readlink -f "$HOME/.local/bin/agent" 2>/dev/null || true)"
if [[ -n "$REAL_AGENT" ]]; then
  CONT_AGENT="${REAL_AGENT/$HOME\/.local//opt/cursor-local}"
  upsert HERMES_CURSOR_BRIDGE_URL ""
  # quoted value for docker-compose .env
  python3 -c "from pathlib import Path;p=Path('$ENVF');c='$CONT_AGENT';cmd='\"%s --print --output-format json\"'%c;lines=[];
[lines.append('HERMES_CURSOR_CLI_CMD='+cmd) if ln.startswith('HERMES_CURSOR_CLI_CMD=') else lines.append(ln) for ln in p.read_text().splitlines()];
p.write_text('\\n'.join(lines)+('\\n' if not any(l.startswith('HERMES_CURSOR_CLI_CMD=') for l in lines) else '\\n'));
print('set HERMES_CURSOR_CLI_CMD to', cmd)"
  upsert HERMES_CURSOR_WORKSPACE "/workspace"
else
  upsert HERMES_CURSOR_BRIDGE_URL "http://172.17.0.1:${BRIDGE_PORT}"
  upsert HERMES_CURSOR_CLI_CMD "agent --print --output-format json"
  upsert HERMES_CURSOR_WORKSPACE "$WORKSPACE"
fi

# Sync compose env block if dashboard compose is a copy
if [[ -f /tmp/docker-compose.yml && -f "$DASH/docker-compose.yml" ]]; then
  # Only merge cursor-related lines into existing agent-api env if missing
  if ! grep -q 'HERMES_ENABLE_CURSOR_CLI' "$DASH/docker-compose.yml"; then
    python3 - "$DASH/docker-compose.yml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
needle = "      - BOOKMARKS_CHAT_MAX_TOKENS=${BOOKMARKS_CHAT_MAX_TOKENS:-8192}\n"
insert = needle + """      - HERMES_ENABLE_CURSOR_CLI=${HERMES_ENABLE_CURSOR_CLI:-0}
      - HERMES_CURSOR_BRIDGE_URL=${HERMES_CURSOR_BRIDGE_URL:-}
      - HERMES_CURSOR_BRIDGE_TOKEN=${HERMES_CURSOR_BRIDGE_TOKEN:-}
      - HERMES_CURSOR_CLI_CMD=${HERMES_CURSOR_CLI_CMD:-agent --print --output-format json}
      - HERMES_CURSOR_WORKSPACE=${HERMES_CURSOR_WORKSPACE:-}
      - HERMES_CURSOR_TIMEOUT_SEC=${HERMES_CURSOR_TIMEOUT_SEC:-240}
      - CURSOR_API_KEY=${CURSOR_API_KEY:-}
"""
if needle in text and "HERMES_ENABLE_CURSOR_CLI" not in text:
    p.write_text(text.replace(needle, insert, 1))
    print("patched dashboard docker-compose.yml")
else:
    print("compose already patched or needle missing")
PY
  fi
fi

# Bridge env file
BRIDGE_ENV="$HOME/.config/autoro/cursor-bridge.env"
umask 077
python3 -c "
from pathlib import Path
path = Path('$BRIDGE_ENV')
token = '''$BRIDGE_TOKEN'''
port = '''$BRIDGE_PORT'''
workspace = '''$WORKSPACE'''
api_key = '''$CURSOR_API_KEY_VAL'''
dash_env = Path('''$ENVF''')
home_bin = str(Path.home() / '.local' / 'bin')
lines = [
    f'CURSOR_BRIDGE_TOKEN={token}',
    'CURSOR_BRIDGE_HOST=0.0.0.0',
    f'CURSOR_BRIDGE_PORT={port}',
    'HERMES_CURSOR_CLI_CMD=agent --print --output-format json',
    f'HERMES_CURSOR_WORKSPACE={workspace}',
    'HERMES_CURSOR_TIMEOUT_SEC=240',
    f'PATH={home_bin}:/usr/local/bin:/usr/bin:/bin',
]
if api_key:
    lines.append(f'CURSOR_API_KEY={api_key}')
elif dash_env.is_file():
    for ln in dash_env.read_text(errors='replace').splitlines():
        if ln.startswith('CURSOR_API_KEY=') and len(ln) > len('CURSOR_API_KEY='):
            lines.append(ln)
            break
out = []
for ln in lines:
    if '=' not in ln:
        continue
    k, v = ln.split('=', 1)
    if any(c in v for c in ' \t'):
        v = '\"' + v.replace('\"', '\\\"') + '\"'
    out.append(f'{k}={v}')
path.write_text('\\n'.join(out) + '\\n')
print('wrote', path)
"

echo "[3/6] Restart cursor-cli-bridge ..."
pkill -f 'cursor-cli-bridge.py' 2>/dev/null || true
sleep 1
set -a
# shellcheck disable=SC1090
source "$BRIDGE_ENV"
set +a
nohup python3 "$HOME/bin/cursor-cli-bridge.py" >> "$HOME/.config/autoro/cursor-bridge.log" 2>&1 &
sleep 1
curl -sfS "http://127.0.0.1:${BRIDGE_PORT}/health" | head -c 300 || echo "bridge health failed"
echo

echo "[4/6] Deploy agent-api main.py + recreate ..."
docker cp /tmp/main.py autoro-agent-api:/app/main.py || true
cd "$DASH"
# Avoid multi-file compose merges that pull invalid services (kong).
docker-compose -f docker-compose.yml up -d --no-deps --force-recreate agent-api
sleep 8
docker ps --filter name=autoro-agent-api --format '{{.Names}} {{.Status}}'
echo "[5/6] Configure n8n HERMES_AGENT_API_* ..."
AGENT_KEY="$(docker exec autoro-agent-api python3 - <<'PY'
import os, psycopg2
c = psycopg2.connect(
    host=os.environ.get("PGHOST", "supabase-db"),
    port=int(os.environ.get("PGPORT") or 5433),
    dbname=os.environ.get("PGDATABASE", "postgres"),
    user=os.environ.get("PGUSER", "supabase_admin"),
    password=os.environ.get("PGPASSWORD", ""),
)
cur = c.cursor()
cur.execute("select agent_api_key from public.service_settings where id=1")
print((cur.fetchone() or [""])[0] or "")
PY
)"
N8N_ENV="$N8N_DIR/.env"
if [[ -f "$N8N_ENV" ]]; then
  upsert_n8n() {
    local key="$1" val="$2"
    python3 - "$N8N_ENV" "$key" "$val" <<'PY'
import sys
from pathlib import Path
path, key, val = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines = path.read_text(errors="replace").splitlines()
out=[]; found=False
for ln in lines:
    if ln.startswith(key+"="):
        out.append(f"{key}={val}"); found=True
    else:
        out.append(ln)
if not found:
    out.append(f"{key}={val}")
path.write_text("\n".join(out).rstrip()+"\n")
PY
  }
  upsert_n8n HERMES_AGENT_API_URL "http://autoro-agent-api:8900/api/v1/hermes/run"
  # Fallback public URL if containers not on same network:
  # upsert_n8n HERMES_AGENT_API_URL "https://swoop.autoro.tech/api/v1/hermes/run"
  if [[ -n "$AGENT_KEY" ]]; then
    upsert_n8n HERMES_AGENT_API_KEY "$AGENT_KEY"
  fi
  upsert_n8n TELEGRAM_HERMES_USE_AGENT_API 1
  upsert_n8n AUTORO_AGENT_API_BASE "http://autoro-agent-api:8900"
  cd "$N8N_DIR"
  docker-compose up -d --no-deps --force-recreate n8n n8n-task-runners 2>/dev/null \
    || docker compose up -d --no-deps --force-recreate n8n n8n-task-runners 2>/dev/null \
    || { docker restart n8n n8n-task-runners || true; }
  sleep 5
  docker exec n8n printenv HERMES_AGENT_API_URL || true
  docker exec n8n-task-runners printenv HERMES_AGENT_API_URL 2>/dev/null || true
else
  echo "[warn] $N8N_ENV not found — set HERMES_AGENT_API_URL manually"
fi

echo "[6/6] Smoke hermes/run mode=cursor ..."
# From host via localhost nginx or container
docker exec autoro-agent-api python3 - <<PY
import json, os, urllib.request
key = """$AGENT_KEY""".strip()
req = urllib.request.Request(
    "http://127.0.0.1:8900/api/v1/hermes/run",
    data=json.dumps({
        "mode": "cursor",
        "prompt": "Reply with exactly: pong",
        "context": {"cursor_mode": "ask"},
    }).encode(),
    headers={"Content-Type": "application/json", "X-API-Key": key},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode()
        print("HTTP", resp.status)
        print(body[:500])
except Exception as e:
    print("SMOKE_ERR", type(e).__name__, str(e)[:400])
PY
REMOTE

echo "Done. If smoke shows Authentication required — export CURSOR_API_KEY and re-run."
echo "Telegram: /cursor <задача> (n8n Personal Assistant Memory must be Active)."
