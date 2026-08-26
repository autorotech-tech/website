#!/usr/bin/env bash
# Deploy Voice AI Recruiter UI + agent-api media STT/TTS to swoop staging.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15)

echo "=== 1. Build SPA ==="
cd "$ROOT"
npm run build
python3 -m py_compile agent-api/main.py agent-api/hermes_media.py

echo "=== 2. Upload dist + agent-api ==="
tar czf /tmp/voice-recruiter-dist.tgz -C "$ROOT/dist" .
scp "${SSH_OPTS[@]}" /tmp/voice-recruiter-dist.tgz "$REMOTE:/tmp/voice-recruiter-dist.tgz"
scp "${SSH_OPTS[@]}" \
  "$ROOT/agent-api/main.py" \
  "$ROOT/agent-api/hermes_media.py" \
  "$REMOTE:/tmp/"

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p /tmp/voice-recruiter-dist
rm -rf /tmp/voice-recruiter-dist/*
tar xzf /tmp/voice-recruiter-dist.tgz -C /tmp/voice-recruiter-dist
docker cp /tmp/voice-recruiter-dist/. autoro-frontend:/usr/share/nginx/html/
docker cp /tmp/main.py autoro-agent-api:/app/main.py
docker cp /tmp/hermes_media.py autoro-agent-api:/app/hermes_media.py
docker restart autoro-agent-api
sleep 8
curl -sf http://127.0.0.1:8900/api/v1/health || curl -sf http://127.0.0.1:8900/health || true
echo "Deployed voice-recruiter + media speech/transcribe-upload"
REMOTE

echo ""
echo "✅ https://swoop.autoro.tech/voice-recruiter"
