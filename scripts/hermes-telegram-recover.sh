#!/usr/bin/env bash
# Восстановление Telegram-бота Hermes на VPS (запускать НА СЕРВЕРЕ или через SSH).
set -euo pipefail

HERMES_DIR="${HERMES_DIR:-/home/vladx/hermes-agent}"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

say() { printf '%s\n' "$*"; }
ok() { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${RED}!${NC} %s\n" "$*"; }

say "=== Hermes Telegram recover ==="
say "Time: $(date -Is)"

say ""
say "--- Host ---"
df -h / | tail -1 || true
free -h | sed -n '1,2p' || true
uptime || true

say ""
say "--- Docker: hermes + agent-api ---"
docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -E 'hermes-agent|autoro-agent-api|nginx-proxy' || warn 'hermes/agent-api/nginx not listed'

if docker ps -a --format '{{.Names}}' | grep -qx 'hermes-agent'; then
  status="$(docker inspect -f '{{.State.Status}}' hermes-agent 2>/dev/null || echo unknown)"
  if [[ "$status" != "running" ]]; then
    warn "hermes-agent status=$status — restarting..."
    (cd "$HERMES_DIR" && docker-compose up -d hermes-agent) || docker start hermes-agent || true
    sleep 15
  else
    ok "hermes-agent is running"
  fi
else
  warn "container hermes-agent missing — try: cd $HERMES_DIR && docker-compose up -d"
fi

if docker ps -a --format '{{.Names}}' | grep -qx 'autoro-agent-api'; then
  api_status="$(docker inspect -f '{{.State.Status}}' autoro-agent-api 2>/dev/null || echo unknown)"
  if [[ "$api_status" != "running" ]]; then
    warn "autoro-agent-api status=$api_status — restart required (compose project autoro-dashboard)"
    docker restart autoro-agent-api 2>/dev/null || true
    sleep 8
  fi
fi

say ""
say "--- agent-api health (docker network) ---"
docker exec hermes-agent curl -sS -m 10 http://autoro-agent-api:8900/api/v1/health 2>/dev/null \
  && ok 'agent-api reachable from hermes-agent' \
  || warn 'agent-api NOT reachable from hermes-agent'

say ""
say "--- Hermes logs (last 40 lines) ---"
docker logs hermes-agent --tail 40 2>&1 || warn 'no hermes logs'

say ""
say "--- Gateway patches ---"
docker exec hermes-agent python3 -c "
from pathlib import Path
p = Path('/opt/hermes-agent/gateway/run.py')
t = p.read_text(encoding='utf-8') if p.is_file() else ''
checks = [
  ('kb_shortcut', 'try_direct_find_then_kb_from_user_message' in t or 'try_direct_kb_capture_from_user_message' in t),
  ('search_shortcut', 'try_direct_search_from_user_message' in t),
  ('tool_recovery', 'recover_response_if_pseudo_tool' in t),
]
for name, ok in checks:
    print(f'{name}:', 'OK' if ok else 'MISSING')
" 2>/dev/null || warn 'patch check failed'

say ""
say "--- Telegram getWebhookInfo ---"
if [[ -f "$HERMES_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$HERMES_DIR/.env"; set +a
fi
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  curl -sS -m 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool 2>/dev/null | head -30 \
    || warn 'getWebhookInfo failed'
  curl -sS -m 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" | python3 -m json.tool 2>/dev/null | head -15 \
    || warn 'getMe failed'
else
  warn 'TELEGRAM_BOT_TOKEN not in $HERMES_DIR/.env'
fi

say ""
say "--- Optional hard restart ---"
say "  cd $HERMES_DIR && docker-compose up -d --force-recreate hermes-agent"
say "  docker logs -f hermes-agent"
say "Done."
