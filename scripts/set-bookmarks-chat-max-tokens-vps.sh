#!/usr/bin/env bash
# Прописать BOOKMARKS_CHAT_MAX_TOKENS в docker-compose на VPS и пересоздать agent-api.
set -euo pipefail

MAX_TOKENS="${1:-8192}"
COMPOSE_DIR="${COMPOSE_DIR:-/home/vladx/autoro-dashboard}"
SSH_HOST="${SSH_HOST:-vladx@46.250.228.229}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"

ssh -i "$SSH_KEY" "$SSH_HOST" "grep -q 'BOOKMARKS_CHAT_MAX_TOKENS' '$COMPOSE_DIR/docker-compose.yml' || sed -i '/container_name: autoro-agent-api/,/networks:/{/- PGPASSWORD=\\\${PGPASSWORD}/a\\      - BOOKMARKS_CHAT_MAX_TOKENS=\\\${BOOKMARKS_CHAT_MAX_TOKENS:-$MAX_TOKENS}}' '$COMPOSE_DIR/docker-compose.yml'; echo BOOKMARKS_CHAT_MAX_TOKENS=$MAX_TOKENS >> '$COMPOSE_DIR/.env'; cd '$COMPOSE_DIR' && docker-compose -f docker-compose.yml up -d --no-deps --force-recreate agent-api && docker network connect autoro-dashboard_default autoro-agent-api 2>/dev/null || true && docker exec autoro-agent-api printenv BOOKMARKS_CHAT_MAX_TOKENS"

echo "Done. Проверьте длинный ответ в Hermes (Telegram)."
