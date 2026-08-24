#!/usr/bin/env bash
# Деплой Job Responder API на VPS: job_responder.py + kb_file_ingest.py + main.py -> autoro-agent-api
# Usage: bash scripts/deploy-job-responder-api.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15)

echo "=== 1. Syntax check ==="
python3 -m py_compile \
  "$ROOT/agent-api/job_responder.py" \
  "$ROOT/agent-api/kb_file_ingest.py" \
  "$ROOT/agent-api/main.py"

echo "=== 2. Upload job_responder.py + kb_file_ingest.py + main.py ==="
scp "${SSH_OPTS[@]}" \
  "$ROOT/agent-api/job_responder.py" \
  "$ROOT/agent-api/kb_file_ingest.py" \
  "$ROOT/agent-api/main.py" \
  "$REMOTE:/tmp/"

echo "=== 3. docker cp + pypdf + restart autoro-agent-api ==="
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker cp /tmp/job_responder.py autoro-agent-api:/app/job_responder.py
docker cp /tmp/kb_file_ingest.py autoro-agent-api:/app/kb_file_ingest.py
docker cp /tmp/main.py autoro-agent-api:/app/main.py
docker exec autoro-agent-api python3 -m pip install -q --no-cache-dir 'pypdf>=4.0' || true
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

echo "=== 4b. Smoke file-capture + generate (then purge) ==="
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker exec autoro-agent-api python3 - <<'PY'
import json, time, uuid, urllib.request

pdf = (
    b"%PDF-1.4\n"
    b"% smoke multi-block CV\n"
    b"(Vlad Holodin smoke CV page 1. Skills: Python, n8n, FastAPI, RAG.)\n"
    b"(Experience: automated job responder ingest and cover letters for HH.)\n"
    b"(Education: bachelor computer science. Portfolio https://example.com/jr-smoke)\n"
    b"%%EOF\n"
)
print("smoke pdf bytes", len(pdf))

boundary = "----jrSmoke" + uuid.uuid4().hex
parts = []
def add_field(name, value):
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
add_field("workspaceId", "1")
add_field("kind", "job_resume")
add_field("category", "cv")
add_field("title", "jr-smoke-cv.pdf")
parts.append(
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"jr-smoke-cv.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".encode()
    + pdf
    + b"\r\n"
)
parts.append(f"--{boundary}--\r\n".encode())
body = b"".join(parts)
req = urllib.request.Request(
    "http://127.0.0.1:8900/api/v1/job-responder/resume/file-capture",
    data=body,
    method="POST",
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
)
t0 = time.monotonic()
try:
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read()
        elapsed = time.monotonic() - t0
        print("file-capture", r.status, f"{elapsed:.2f}s", raw[:500])
        data = json.loads(raw.decode())
except Exception as e:
    elapsed = time.monotonic() - t0
    code = getattr(e, "code", None)
    payload = e.read()[:500] if hasattr(e, "read") else b""
    print("file-capture ERR", code, f"{elapsed:.2f}s", payload or e)
    data = {}
    raise SystemExit(1)

kid = data.get("knowledgeItemId")
gen = {
    "workspaceId": "1",
    "mode": "cover_letter",
    "host": "web",
    "locale": "ru",
    "selectedSourceIds": [kid] if kid else [],
    "vacancy": {
        "title": "n8n automation engineer",
        "company": "SmokeCo",
        "description": "Need Python n8n RAG automation engineer for HH cover letters and workflows.",
        "questions": [],
    },
}
gt0 = time.monotonic()
greq = urllib.request.Request(
    "http://127.0.0.1:8900/api/v1/job-responder/generate",
    data=json.dumps(gen).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(greq, timeout=50) as r:
        graw = r.read()
        gelapsed = time.monotonic() - gt0
        print("generate", r.status, f"{gelapsed:.2f}s", graw[:400])
except Exception as e:
    gelapsed = time.monotonic() - gt0
    code = getattr(e, "code", None)
    payload = e.read()[:400] if hasattr(e, "read") else b""
    print("generate ERR", code, f"{gelapsed:.2f}s", payload or e)

# purge smoke
dreq = urllib.request.Request(
    "http://127.0.0.1:8900/api/v1/job-responder/resume/sources/delete",
    data=json.dumps({"workspaceId": "1", "titles": ["jr-smoke-cv.pdf"]}).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(dreq, timeout=20) as r:
    print("purge-smoke", r.status, r.read()[:300])
PY
REMOTE
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker exec autoro-agent-api python3 - <<'PY'
import os, urllib.request, json
url = "http://127.0.0.1:8900/api/v1/job-responder/resume/sources/delete"
body = json.dumps({
    "workspaceId": "1",
    "titles": ["second-cv.pdf", "smoke-nul-cv.pdf", "jr-smoke-cv.pdf"],
}).encode()
req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        print("purge", r.status, r.read()[:400])
except Exception as e:
    code = getattr(e, "code", None)
    payload = e.read()[:400] if hasattr(e, "read") else b""
    print("purge ERR", code, payload or e)
PY
REMOTE

echo "=== 5. Public URL ==="
curl -sS -m 20 -o /tmp/jr-pub.txt -w 'public status:%{http_code}\n' \
  'https://swoop.autoro.tech/api/v1/job-responder/resume/status?workspaceId=1' || true
head -c 240 /tmp/jr-pub.txt; echo

echo "✅ Job Responder API: https://swoop.autoro.tech/api/v1/job-responder/resume/status"
