#!/usr/bin/env bash
# Переэкспорт БЗ → Obsidian + закладки по ссылкам (agent-api).
set -euo pipefail
WS="${1:-1}"
LIMIT="${2:-500}"
API_BASE="${AGENT_API_BASE:-http://127.0.0.1:8900}"
KEY="${AGENT_API_KEY:-${AUTORO_AGENT_API_KEY:-}}"

if [[ -z "$KEY" ]]; then
  echo "Задайте AGENT_API_KEY или AUTORO_AGENT_API_KEY" >&2
  exit 1
fi

curl -sS -X POST "${API_BASE}/api/v1/knowledge/sync-obsidian-all" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${KEY}" \
  -d "{\"workspaceId\":\"${WS}\",\"limit\":${LIMIT},\"resyncBookmarks\":true}" | python3 -m json.tool
