#!/usr/bin/env bash
# Deploy Keept (Bookmarks Bro + Admin + moderation API) to swoop staging.
# Target: https://swoop.autoro.tech/bookmarks-bro and /keept/admin
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
DEST="${REMOTE_DASHBOARD_DIR:-/home/vladx/autoro-dashboard}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15)

echo "=== 1. Build SPA (includes /keept/admin) ==="
cd "$ROOT"
npm run build
python3 -m py_compile agent-api/main.py agent-api/security.py agent-api/kb_file_ingest.py

echo "=== 2. Upload dist + agent-api ==="
tar czf /tmp/keept-dist.tgz -C "$ROOT/dist" .
scp "${SSH_OPTS[@]}" /tmp/keept-dist.tgz "$REMOTE:/tmp/keept-dist.tgz"
scp "${SSH_OPTS[@]}" \
  "$ROOT/agent-api/main.py" \
  "$ROOT/agent-api/security.py" \
  "$ROOT/agent-api/kb_file_ingest.py" \
  "$ROOT/scripts/patch-swoop-nginx-api-v1.sh" \
  "$REMOTE:/tmp/"

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p /tmp/keept-dist
rm -rf /tmp/keept-dist/*
tar xzf /tmp/keept-dist.tgz -C /tmp/keept-dist

if ! docker ps --filter name=autoro-frontend --filter status=running -q | grep -q .; then
  echo "autoro-frontend not running — trying fix-swoop-502"
  bash /home/vladx/autoro-dashboard/scripts/fix-swoop-502.sh 2>/dev/null || true
fi

docker cp /tmp/keept-dist/. autoro-frontend:/usr/share/nginx/html/
docker cp /tmp/main.py autoro-agent-api:/app/main.py
docker cp /tmp/security.py autoro-agent-api:/app/security.py
docker cp /tmp/kb_file_ingest.py autoro-agent-api:/app/kb_file_ingest.py
docker restart autoro-agent-api
sleep 8
bash /tmp/patch-swoop-nginx-api-v1.sh
echo "agent-api restarted (moderation schema ensured on startup)."
REMOTE

echo ""
echo "✅ Staging deploy complete."
echo "   User app:  https://swoop.autoro.tech/bookmarks-bro"
echo "   Admin:     https://swoop.autoro.tech/keept/admin"
echo ""
echo "Manual QA:"
echo "  1. Login (BB Supabase session)"
echo "  2. Capture text with email/SSN → pending"
echo "  3. Open /keept/admin → approve/reject"
