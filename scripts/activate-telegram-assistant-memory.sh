#!/usr/bin/env bash
# Синхронизирует код в workflow JSON и публикует (PUT + activate) через n8n REST API.
#
# Требуется API key: n8n → Settings → API → Create API key
#
# Usage (с локальной машины, если tech.autoro.tech доступен):
#   export N8N_API_KEY='n8n_api_...'
#   bash scripts/activate-telegram-assistant-memory.sh
#
# Env:
#   N8N_API_KEY      — обязателен (или N8N_PUBLIC_URL + ключ на VPS через deploy-скрипт)
#   N8N_PUBLIC_URL   — default https://tech.autoro.tech
#   WF_ID            — default XKr2MZGGbMW2CySm
#   SKIP_SYNC        — 1 чтобы не запускать sync-detect-command
#   VERIFY_WEBHOOK   — 1 (default) POST smoke после activate
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WF_LOCAL="${ROOT}/n8n/workflows/telegram_personal_assistant_memory.json"
PREPARE="${ROOT}/n8n/workflows/prepare-workflow-api-payload.cjs"
SYNC="${ROOT}/n8n/workflows/sync-detect-command-to-memory-workflow.cjs"

N8N_PUBLIC_URL="${N8N_PUBLIC_URL:-https://tech.autoro.tech}"
WF_ID="${WF_ID:-XKr2MZGGbMW2CySm}"
WEBHOOK_PATH="telegram-assistant-memory"
PRODUCTION_WEBHOOK="${N8N_PUBLIC_URL%/}/webhook/${WEBHOOK_PATH}"

if [[ "${SKIP_SYNC:-0}" != "1" ]]; then
  node "${SYNC}"
fi

if [[ -z "${N8N_API_KEY:-}" ]]; then
  echo "N8N_API_KEY не задан." >&2
  echo "Создайте ключ: ${N8N_PUBLIC_URL} → Settings → API" >&2
  echo "Затем: export N8N_API_KEY='...' && bash scripts/activate-telegram-assistant-memory.sh" >&2
  exit 1
fi

if [[ ! -f "${WF_LOCAL}" ]]; then
  echo "Не найден ${WF_LOCAL}" >&2
  exit 1
fi

TMP_PAYLOAD="$(mktemp)"
trap 'rm -f "${TMP_PAYLOAD}"' EXIT

node "${PREPARE}" "${WF_LOCAL}" > "${TMP_PAYLOAD}"

PUT_URL="${N8N_PUBLIC_URL%/}/api/v1/workflows/${WF_ID}"
echo "[1/3] PUT workflow ${WF_ID} ..."
curl -sfS -X PUT "${PUT_URL}" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary @"${TMP_PAYLOAD}" \
  | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('  name:', j.name, '| active:', j.active);"

echo "[2/3] POST activate ${WF_ID} ..."
curl -sfS -X POST "${N8N_PUBLIC_URL%/}/api/v1/workflows/${WF_ID}/activate" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!j.active){console.error('activate failed');process.exit(3)} console.log('  active:', j.active);"

echo "[3/3] Production webhook URL:"
echo "  ${PRODUCTION_WEBHOOK}"
echo "  (Telegram и Swoop gateway: POST, не GET)"

if [[ "${VERIFY_WEBHOOK:-1}" == "1" ]]; then
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${PRODUCTION_WEBHOOK}" \
    -H 'Content-Type: application/json' \
    -d '{"update_id":0,"message":{"message_id":1,"chat":{"id":0},"from":{"id":0},"text":"/help"}}' || echo '000')"
  if [[ "${HTTP_CODE}" == "404" ]]; then
    echo "[warn] POST ${PRODUCTION_WEBHOOK} → 404 — workflow всё ещё не опубликован или путь другой." >&2
    exit 4
  fi
  echo "  smoke POST → HTTP ${HTTP_CODE} (200/401/403/500 ок для проверки регистрации; 404 = не зарегистрирован)"
fi

echo "Done."
