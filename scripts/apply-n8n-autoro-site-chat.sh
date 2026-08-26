#!/usr/bin/env bash
# Import Site Chat (autoro.tech) n8n workflow + wire chat_agents bot to webhook.
# Requires on VPS: AUTORO_TELEGRAM_BOT_TOKEN, AUTORO_TELEGRAM_ADMIN_CHAT_ID, CHAT_PUSH_SECRET (optional)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
N8N_CONTAINER="${N8N_CONTAINER:-n8n}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
WF_SRC="${WF_SRC:-$ROOT/config/n8n-autoro-site-chat.json}"
BOT_ID="${AUTORO_SITE_BOT_ID:-}"
WEBHOOK_PATH="autoro/chat/site"
WEBHOOK_URL="http://n8n:5678/webhook/${WEBHOOK_PATH}"

log() { echo "[$(date -Iseconds)] $*"; }

[[ -f "$WF_SRC" ]] || { log "ERROR: missing $WF_SRC — run: node scripts/generate-n8n-autoro-site-chat.mjs"; exit 1; }

if [[ -z "$BOT_ID" ]] && docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  BOT_ID="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
    "SELECT id FROM public.chat_agents WHERE name ILIKE '%autoro%' OR name ILIKE '%autoro.tech%' ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || true)"
fi
[[ -n "$BOT_ID" ]] || { log "ERROR: set AUTORO_SITE_BOT_ID (uuid from Swoop → Chat Agents)"; exit 1; }
log "bot_id=$BOT_ID"

docker cp "$WF_SRC" "${N8N_CONTAINER}:/tmp/n8n-autoro-site-chat.json"
docker exec "$N8N_CONTAINER" n8n import:workflow --input=/tmp/n8n-autoro-site-chat.json

WF_ID="$(docker exec n8n-db psql -U n8n -d n8n -t -A -c \
  "SELECT id FROM workflow_entity WHERE name='Site Chat (autoro.tech)' ORDER BY \"updatedAt\" DESC LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || true)"
[[ -n "$WF_ID" ]] || { log "ERROR: workflow not found after import"; exit 1; }
log "workflow id=$WF_ID"

docker exec n8n-db psql -U n8n -d n8n -c "UPDATE workflow_entity SET active=true WHERE id='${WF_ID}';" >/dev/null
docker exec "$N8N_CONTAINER" n8n publish:workflow --id="$WF_ID" 2>/dev/null \
  || docker exec "$N8N_CONTAINER" n8n update:workflow --id="$WF_ID" --active=true 2>/dev/null \
  || true
# Register webhook in the running n8n process (no full restart needed).
docker exec "$N8N_CONTAINER" n8n update:workflow --id="$WF_ID" --active=true 2>/dev/null || true
sleep 3

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -c \
  "UPDATE public.chat_agents SET n8n_webhook_url='${WEBHOOK_URL}', status='active' WHERE id='${BOT_ID}';" >/dev/null

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -c \
  "INSERT INTO public.chat_agent_domains (bot_id, domain) VALUES ('${BOT_ID}', 'autoro.tech')
   ON CONFLICT (bot_id, domain) DO NOTHING;" >/dev/null 2>&1 || true

log "Updated chat_agents.n8n_webhook_url → ${WEBHOOK_URL}"
log "Set AUTORO_SITE_BOT_ID=${BOT_ID} for deploy (meta tag on site)"

MSG="${1:-smoke autoro chat}"
curl -sS -m 60 -X POST "http://127.0.0.1:5678/webhook/${WEBHOOK_PATH}" \
  -H 'Content-Type: application/json' \
  -d "{\"bot_id\":\"${BOT_ID}\",\"session\":\"smoke-$(date +%s)\",\"lang\":\"ru\",\"message\":\"${MSG}\",\"page_url\":\"https://autoro.tech/ru/\",\"platform\":\"site\"}" \
  | head -c 400 || echo ERR
echo
log "Done. Register Telegram webhook: curl https://api.telegram.org/bot\$TOKEN/setWebhook?url=https://chat.autoro.tech/v1/chat-agent/telegram/webhook?bot_id=${BOT_ID}"
