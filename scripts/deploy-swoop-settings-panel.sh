#!/usr/bin/env bash
# Деплой Admin Settings UI (ProviderApiKeysPanel) + agent-api provider modules.
# Быстрый путь: локальный npm run build → docker cp dist в autoro-frontend;
# agent-api — копируем все Python-модули (main + swoop_*).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
DEST="${REMOTE_DASHBOARD_DIR:-/home/vladx/autoro-dashboard}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15)

echo "=== 1. Локальная сборка ==="
cd "$ROOT"
npm run build

AGENT_API_FILES=(
  main.py
  hermes_media.py
  swoop_provider_catalog.py
  swoop_lmarena.py
  swoop_mimo.py
  swoop_kimi.py
  swoop_openmodel.py
  swoop_serpapi.py
  swoop_groq.py
  swoop_parsing.py
  swoop_expired_domains.py
  kb_file_ingest.py
  security.py
  job_responder.py
)

echo "=== 2. Артефакты (один scp — меньше обрывов SSH) ==="
tar czf /tmp/swoop-components.tgz -C "$ROOT/src/components"   ProviderApiKeysPanel.tsx ApiKeyGroupsField.tsx AdminSettings.tsx
tar czf /tmp/swoop-agent-api.tgz -C "$ROOT/agent-api" "${AGENT_API_FILES[@]}"
tar czf /tmp/swoop-dist.tgz -C "$ROOT/dist" .
scp "${SSH_OPTS[@]}"   /tmp/swoop-components.tgz /tmp/swoop-agent-api.tgz /tmp/swoop-dist.tgz   "$REMOTE:/tmp/"
sleep 2

echo "=== 3. dist → autoro-frontend ==="

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s "$DEST" <<'REMOTE'
set -euo pipefail
DEST="$1"
mkdir -p /tmp/swoop-dist "$DEST/src/components"
rm -rf /tmp/swoop-dist/*
tar xzf /tmp/swoop-dist.tgz -C /tmp/swoop-dist
tar xzf /tmp/swoop-components.tgz -C "$DEST/src/components"
tar xzf /tmp/swoop-agent-api.tgz -C /tmp

if ! docker ps --filter name=autoro-frontend --filter status=running -q | grep -q .; then
  echo "autoro-frontend не запущен — поднимаем через fix-swoop-502"
  bash /home/vladx/autoro-dashboard/scripts/fix-swoop-502.sh 2>/dev/null \
    || bash -c 'IMAGE=autoro-dashboard-frontend:latest; docker rm -f autoro-frontend 2>/dev/null || true; docker create --name autoro-frontend --network proxy --restart unless-stopped -e VIRTUAL_HOST=swoop.autoro.tech -e LETSENCRYPT_HOST=swoop.autoro.tech -e LETSENCRYPT_EMAIL=tech@autoro.tech "$IMAGE"; for net in autoro-dashboard_default vladx_anythingllm-n8n-bridge supabase_default; do docker network inspect "$net" >/dev/null 2>&1 && docker network connect "$net" autoro-frontend 2>/dev/null || true; done; docker start autoro-frontend'
fi

docker cp /tmp/swoop-dist/. autoro-frontend:/usr/share/nginx/html/
docker restart autoro-frontend >/dev/null 2>&1 || true
echo "index.html asset: $(curl -sS -m 10 http://127.0.0.1/ -H 'Host: swoop.autoro.tech' | tr '"' '\n' | grep -E '^index-.*\\.js$' | head -1 || echo unknown)"

echo "=== 4. agent-api (все модули) ==="
for f in main.py hermes_media.py swoop_provider_catalog.py swoop_lmarena.py swoop_mimo.py swoop_kimi.py swoop_openmodel.py swoop_serpapi.py swoop_groq.py swoop_parsing.py swoop_expired_domains.py kb_file_ingest.py security.py job_responder.py; do
  docker cp "/tmp/$f" "autoro-agent-api:/app/$f"
done
docker restart autoro-agent-api
sleep 5

code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' http://127.0.0.1/ -H 'Host: swoop.autoro.tech' || echo 000)
echo "swoop local: HTTP $code"
docker ps --filter name=autoro-frontend --filter name=autoro-agent-api --format '{{.Names}} {{.Status}}'
REMOTE

echo "✅ Готово: https://swoop.autoro.tech/admin/settings (hard refresh / incognito)"
