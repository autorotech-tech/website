#!/usr/bin/env bash
# Деплой Job Responder API на VPS: job_responder.py + main.py -> autoro-agent-api
# Usage: bash scripts/deploy-job-responder-api.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15)

echo "=== 1. Syntax check ==="
python3 -m py_compile "$ROOT/agent-api/job_responder.py" "$ROOT/agent-api/main.py"

echo "=== 2. Upload job_responder.py + main.py ==="
scp "${SSH_OPTS[@]}" \
  "$ROOT/agent-api/job_responder.py" \
  "$ROOT/agent-api/main.py" \
  "$REMOTE:/tmp/"

echo "=== 3. docker cp + restart autoro-agent-api ==="
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker cp /tmp/job_responder.py autoro-agent-api:/app/job_responder.py
docker cp /tmp/main.py autoro-agent-api:/app/main.py
docker restart autoro-agent-api
sleep 10
docker ps --filter name=autoro-agent-api --format '{{.Names}} {{.Status}}'
echo "--- internal routes (python) ---"
docker exec autoro-agent-api python3 - <<'PY'
import urllib.request
for path in (
    "/api/v1/job-responder/resume/status?workspaceId=1",
    "/api/v1/job-responder/resume/sources?workspaceId=1",
):
    url = "http://127.0.0.1:8900" + path
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            print(path, r.status, r.read()[:180])
    except Exception as e:
        code = getattr(e, "code", None)
        body = e.read()[:180] if hasattr(e, "read") else b""
        print(path, "ERR", code, body or e)
PY
REMOTE

echo "=== 4. Public URL ==="
curl -sS -m 20 -o /tmp/jr-pub.txt -w 'public status:%{http_code}\n' \
  'https://swoop.autoro.tech/api/v1/job-responder/resume/status?workspaceId=1' || true
head -c 240 /tmp/jr-pub.txt; echo

echo "✅ Job Responder API: https://swoop.autoro.tech/api/v1/job-responder/resume/status"
