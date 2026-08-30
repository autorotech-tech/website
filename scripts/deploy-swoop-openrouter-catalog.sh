#!/usr/bin/env bash
# Деплой OpenRouter catalog + LLM routing UI + agent-api (фоновое обновление каталога).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
DEST="${REMOTE_DASHBOARD_DIR:-/home/vladx/autoro-dashboard}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15)

echo "=== 1. Локальная сборка ==="
cd "$ROOT"
npm run build
python3 -m py_compile agent-api/main.py agent-api/swoop_provider_catalog.py

echo "=== 2. Исходники на сервер ==="
scp "${SSH_OPTS[@]}" \
  "$ROOT/src/lib/formatAgentApiError.ts" \
  "$REMOTE:$DEST/src/lib/"

scp "${SSH_OPTS[@]}" \
  "$ROOT/src/components/ModelSearchCombobox.tsx" \
  "$ROOT/src/components/ProviderApiKeysPanel.tsx" \
  "$ROOT/src/components/ApiKeyGroupsField.tsx" \
  "$ROOT/src/components/AdminSettings.tsx" \
  "$REMOTE:$DEST/src/components/"

scp "${SSH_OPTS[@]}" \
  "$ROOT/agent-api/main.py" \
  "$ROOT/agent-api/swoop_provider_catalog.py" \
  "$REMOTE:/tmp/"

echo "=== 3. dist + agent-api (одна SSH-сессия) ==="
tar czf /tmp/swoop-dist.tgz -C "$ROOT/dist" .
scp "${SSH_OPTS[@]}" /tmp/swoop-dist.tgz "$REMOTE:/tmp/swoop-dist.tgz"
sleep 3
scp "${SSH_OPTS[@]}" \
  "$ROOT/agent-api/main.py" \
  "$ROOT/agent-api/swoop_provider_catalog.py" \
  "$REMOTE:/tmp/"

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p /tmp/swoop-dist ~/.config/systemd/user
rm -rf /tmp/swoop-dist/*
tar xzf /tmp/swoop-dist.tgz -C /tmp/swoop-dist

if ! docker ps --filter name=autoro-frontend --filter status=running -q | grep -q .; then
  echo "autoro-frontend не запущен — fix-swoop-502"
  bash /home/vladx/autoro-dashboard/scripts/fix-swoop-502.sh 2>/dev/null || true
fi

docker cp /tmp/swoop-dist/. autoro-frontend:/usr/share/nginx/html/
# Удалить устаревшие бандлы (docker cp не удаляет старые assets → браузер мог грузить старый index)
docker exec autoro-frontend sh -c 'cd /usr/share/nginx/html/assets && ls -1 index-*.js 2>/dev/null | while read f; do grep -q "$f" /usr/share/nginx/html/index.html || rm -f "$f"; done; ls -1 index-*.css 2>/dev/null | while read f; do grep -q "$f" /usr/share/nginx/html/index.html || rm -f "$f"; done' || true
echo "index.html → $(docker exec autoro-frontend grep -o 'index-[^.]*\\.js' /usr/share/nginx/html/index.html | head -1)"

docker cp /tmp/main.py autoro-agent-api:/app/main.py
docker cp /tmp/swoop_provider_catalog.py autoro-agent-api:/app/swoop_provider_catalog.py
docker restart autoro-agent-api
sleep 6

AGENT_KEY=$(docker exec autoro-agent-api python3 -c "import os,psycopg2;c=psycopg2.connect(host=os.environ.get('PGHOST','supabase-db'),port=int(os.environ.get('PGPORT') or 5433),dbname=os.environ.get('PGDATABASE','postgres'),user=os.environ.get('PGUSER','supabase_admin'),password=os.environ.get('PGPASSWORD',''));cur=c.cursor();cur.execute('select agent_api_key from public.service_settings where id=1');print((cur.fetchone() or [''])[0] or '')" 2>/dev/null || true)
if [[ -n "$AGENT_KEY" ]]; then
  docker exec autoro-agent-api curl -sS -m 180 -X POST "http://127.0.0.1:8900/api/v1/admin/openrouter/refresh" -H "X-API-Key: $AGENT_KEY" | head -c 200 || true
  echo
fi

echo "=== 4. optional systemd timer (user) ==="
mkdir -p /home/vladx/bin ~/.config/systemd/user
cat > /home/vladx/bin/run-openrouter-refresh.sh <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
AGENT_KEY=$(docker exec autoro-agent-api python3 -c "import os,psycopg2;c=psycopg2.connect(host=os.environ.get('PGHOST','supabase-db'),port=int(os.environ.get('PGPORT') or 5433),dbname=os.environ.get('PGDATABASE','postgres'),user=os.environ.get('PGUSER','supabase_admin'),password=os.environ.get('PGPASSWORD',''));cur=c.cursor();cur.execute('select agent_api_key from public.service_settings where id=1');print((cur.fetchone() or [''])[0] or '')")
curl -sS -m 180 -X POST http://127.0.0.1:8900/api/v1/admin/openrouter/refresh -H "X-API-Key: $AGENT_KEY"
EOS
chmod +x /home/vladx/bin/run-openrouter-refresh.sh
cat > ~/.config/systemd/user/swoop-openrouter-catalog-refresh.service <<'EOS'
[Unit]
Description=Swoop OpenRouter catalog refresh
[Service]
Type=oneshot
ExecStart=/home/vladx/bin/run-openrouter-refresh.sh
EOS
cat > ~/.config/systemd/user/swoop-openrouter-catalog-refresh.timer <<'EOS'
[Unit]
Description=Refresh OpenRouter catalog every 6h
[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
EOS
systemctl --user daemon-reload 2>/dev/null || true
systemctl --user enable --now swoop-openrouter-catalog-refresh.timer 2>/dev/null || true

echo "=== smoke ==="
docker ps --filter name=autoro-frontend --filter name=autoro-agent-api --format '{{.Names}} {{.Status}}'
systemctl --user list-timers --no-pager | grep openrouter || true
curl -sS -m 15 -o /dev/null -w 'swoop HTTP %{http_code}\n' http://127.0.0.1/ -H 'Host: swoop.autoro.tech' || true
REMOTE

echo "✅ Деплой завершён: https://swoop.autoro.tech/admin/settings"
echo "   Каталог OpenRouter обновляется: при старте agent-api, каждые 6ч в фоне, + systemd timer."
