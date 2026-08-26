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
  "$ROOT/agent-api/job_responder_semantic.py" \
  "$ROOT/agent-api/job_responder_gemini_rag.py" \
  "$ROOT/agent-api/kb_file_ingest.py" \
  "$ROOT/agent-api/main.py"

echo "=== 2. Upload job_responder*.py + kb_file_ingest.py + main.py ==="
scp "${SSH_OPTS[@]}" \
  "$ROOT/agent-api/job_responder.py" \
  "$ROOT/agent-api/job_responder_semantic.py" \
  "$ROOT/agent-api/job_responder_gemini_rag.py" \
  "$ROOT/agent-api/kb_file_ingest.py" \
  "$ROOT/agent-api/main.py" \
  "$REMOTE:/tmp/"

echo "=== 3. docker cp + pypdf + restart autoro-agent-api ==="
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker cp /tmp/job_responder.py autoro-agent-api:/app/job_responder.py
docker cp /tmp/job_responder_semantic.py autoro-agent-api:/app/job_responder_semantic.py
docker cp /tmp/job_responder_gemini_rag.py autoro-agent-api:/app/job_responder_gemini_rag.py
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
    "/api/v1/job-responder/gemini-rag/status?workspaceId=1",
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

echo "=== 4b. Smoke file-capture + multi-source generate (then purge) ==="
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker exec autoro-agent-api python3 - <<'PY'
import json, time, uuid, urllib.request

def post_json(path, obj, timeout=50):
    req = urllib.request.Request(
        "http://127.0.0.1:8900" + path,
        data=json.dumps(obj).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())

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
    raise SystemExit(1)

kid = data.get("knowledgeItemId")
extra_ids = []
for i in range(3):
    title = f"jr-smoke-note-{i}.txt"
    st, td = post_json(
        "/api/v1/job-responder/resume/text-capture",
        {
            "workspaceId": "1",
            "title": title,
            "text": (
                f"Portfolio note {i}. Tools: python, n8n, playwright, docker. "
                f"Built automation pipelines and HH cover letters. Case {i}: reduced manual outreach."
            ),
            "kind": "job_experience",
            "category": "notes",
        },
        timeout=30,
    )
    print("text-capture", i, st, td.get("knowledgeItemId"))
    if td.get("knowledgeItemId"):
        extra_ids.append(int(td["knowledgeItemId"]))

selected = [int(kid)] + extra_ids if kid else extra_ids
gen = {
    "workspaceId": "1",
    "mode": "cover_letter",
    "host": "web",
    "locale": "ru",
    "selectedSourceIds": selected,
    "coverTemplate": (
        "[COVER_TEMPLATE]\nПриветствие: Здравствуйте!\nCTA: Готов обсудить.\n\n"
        "[CONTACTS]\nTelegram: @autoro_tech\nEmail: autoro.tech@gmail.com\n"
    ),
    "profileOverrides": {
        "telegram": "@autoro_tech",
        "email": "autoro.tech@gmail.com",
    },
    "vacancy": {
        "title": "n8n automation engineer",
        "company": "SmokeCo",
        "description": "Need Python n8n RAG automation engineer for HH cover letters and workflows.",
        "questions": [],
    },
}
gt0 = time.monotonic()
try:
    gst, gdata = post_json("/api/v1/job-responder/generate", gen, timeout=55)
    gelapsed = time.monotonic() - gt0
    text = (gdata.get("text") or "").strip()
    print(
        "generate",
        gst,
        f"{gelapsed:.2f}s",
        "ok=", gdata.get("ok"),
        "chars=", gdata.get("compactProfileChars"),
        "merged=", gdata.get("sourcesMerged"),
        "unified=", gdata.get("usedUnifiedProfile"),
        "text_len=", len(text),
        text[:180],
    )
    if gdata.get("ok") is False or not text:
        print("GENERATE_FAIL", gdata.get("error"), gdata.get("message"))
        raise SystemExit(2)
    if "меньше sources" in str(gdata.get("message") or "").lower():
        print("BAD_TIMEOUT_COPY", gdata.get("message"))
        raise SystemExit(3)
    # ## Контакты must be clean (Telegram+Email only; no smoke/experience dump)
    low = text.lower()
    if "## контакты" not in low:
        print("CONTACTS_HEADING_MISSING")
        print(text[-400:])
        raise SystemExit(8)
    section = text.lower().split("## контакты", 1)[-1]
    if "jr-smoke" in section or "example.com" in section:
        print("CONTACTS_POLLUTION smoke URL in ## Контакты")
        print(text[-500:])
        raise SystemExit(5)
    for junk in ("ai/agentic", "маркетинг", "e-commerce", "experience:", "skills:"):
        if junk in section:
            print("CONTACTS_POLLUTION experience in ## Контакты:", junk)
            print(text[-500:])
            raise SystemExit(6)
    if "@autoro_tech" not in text or "autoro.tech@gmail.com" not in text:
        print("CONTACTS_MISSING expected Telegram/Email")
        print(text[-500:])
        raise SystemExit(7)
    print("contacts-ok", "Telegram+Email present, no smoke/experience dump")
except Exception as e:
    gelapsed = time.monotonic() - gt0
    code = getattr(e, "code", None)
    payload = e.read()[:400] if hasattr(e, "read") else b""
    print("generate ERR", code, f"{gelapsed:.2f}s", payload or e)
    raise

# purge smoke
titles = ["jr-smoke-cv.pdf"] + [f"jr-smoke-note-{i}.txt" for i in range(3)]
st, pdata = post_json(
    "/api/v1/job-responder/resume/sources/delete",
    {"workspaceId": "1", "titles": titles},
    timeout=20,
)
print("purge-smoke", st, pdata)
PY
REMOTE

echo "=== 4c. Gemini File Search smoke (when JOB_RESPONDER_GEMINI_RAG=1 on VPS) ==="
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker exec autoro-agent-api python3 - <<'PY'
import os, json
if os.environ.get("JOB_RESPONDER_GEMINI_RAG", "0").strip() not in {"1", "true", "yes", "on"}:
    print("gemini-rag-smoke SKIP (flag off)")
    raise SystemExit(0)
from job_responder_gemini_rag import smoke_test
from main import pg_connect
res = smoke_test(pg_connect, workspace_id=1)
print("gemini-rag-smoke", json.dumps(res, ensure_ascii=False)[:800])
if not res.get("ok"):
    raise SystemExit(4)
PY
REMOTE

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker exec autoro-agent-api python3 - <<'PY'
import urllib.request, json
url = "http://127.0.0.1:8900/api/v1/job-responder/resume/sources/delete"
body = json.dumps({
    "workspaceId": "1",
    "titles": [
        "second-cv.pdf",
        "smoke-nul-cv.pdf",
        "jr-smoke-cv.pdf",
        "jr-smoke-note-0.txt",
        "jr-smoke-note-1.txt",
        "jr-smoke-note-2.txt",
    ],
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
