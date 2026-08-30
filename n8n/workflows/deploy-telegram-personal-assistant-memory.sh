#!/usr/bin/env bash
# Скопировать workflow JSON на VPS и импортировать в n8n (обновляет по совпадающему id в теле файла при наличии API-ключа).
# Использование:
#   bash n8n/workflows/deploy-telegram-personal-assistant-memory.sh
#   VPS_TARGET=user@host SSH_KEY=~/.ssh/key bash n8n/workflows/deploy-telegram-personal-assistant-memory.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WF_LOCAL="${ROOT}/n8n/workflows/telegram_personal_assistant_memory.json"
node "${ROOT}/n8n/workflows/sync-detect-command-to-memory-workflow.cjs"
VPS_TARGET="${VPS_TARGET:-vladx@46.250.228.229}"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519_autoro}"
REMOTE_DIR="${REMOTE_DIR:-/home/vladx/n8n/workflows}"
CONTAINER="${N8N_CONTAINER:-n8n}"
# Публичный URL n8n (для REST). На VPS часто можно оставить пустым и использовать docker exec импорт.
N8N_PUBLIC_URL="${N8N_PUBLIC_URL:-https://tech.autoro.tech}"

if [[ ! -f "${WF_LOCAL}" ]]; then
  echo "Не найден ${WF_LOCAL}" >&2
  exit 1
fi

REMOTE_JSON="${REMOTE_DIR%/}/telegram_personal_assistant_memory.json"

ssh -o StrictHostKeyChecking=no -i "${SSH_KEY}" "${VPS_TARGET}" "mkdir -p ${REMOTE_DIR%/}"
scp -q -o StrictHostKeyChecking=no -i "${SSH_KEY}" "${WF_LOCAL}" "${VPS_TARGET}:${REMOTE_JSON}"

WF_ID="$(node -e "const j=require(process.argv[1]); process.stdout.write(j.id||'');" "${WF_LOCAL}")"

ssh -o StrictHostKeyChecking=no -i "${SSH_KEY}" "${VPS_TARGET}" \
  WF_ID="${WF_ID}" \
  REMOTE_JSON="${REMOTE_JSON}" \
  CONTAINER="${CONTAINER}" \
  N8N_PUBLIC_URL="${N8N_PUBLIC_URL}" \
  bash -s <<'REMOTE'
set -euo pipefail

prepare_api_payload() {
  local src="${1:?}"
  local out="${2:?}"
  node -e '
    const fs = require("fs");
    const wf = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const payload = {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings || { executionOrder: "v1" },
    };
    if (wf.staticData != null) payload.staticData = wf.staticData;
    fs.writeFileSync(process.argv[2], JSON.stringify(payload));
  ' "${src}" "${out}"
}

try_api_activate() {
  local key="${1:?}"
  local base="${2:?}"
  local wf_id="${3:?}"
  curl -sfS -X POST "${base%/}/api/v1/workflows/${wf_id}/activate" \
    -H "X-N8N-API-KEY: ${key}" \
    -H "Content-Type: application/json" \
    -d '{}' >/dev/null
}

try_api_update() {
  local key="${N8N_API_KEY:-}"
  local base="${N8N_PUBLIC_URL:-}"
  [[ -n "${key}" && -n "${base}" && -n "${WF_ID}" ]] || return 4
  local url="${base%/}/api/v1/workflows/${WF_ID}"
  local payload="/tmp/n8n_wf_api_payload.json"
  prepare_api_payload "${REMOTE_JSON}" "${payload}"
  if curl -sfS -X PUT "${url}" \
      -H "X-N8N-API-KEY: ${key}" \
      -H "Content-Type: application/json" \
      --data-binary @"${payload}" \
      >/dev/null; then
    echo "[ok] Обновление workflow через API: ${WF_ID}"
    if try_api_activate "${key}" "${base}" "${WF_ID}"; then
      echo "[ok] Workflow активирован (production webhook): ${base%/}/webhook/telegram-assistant-memory"
    else
      echo "[warn] PUT ok, но activate не удался — включите toggle в UI: ${base}/workflow/${WF_ID}" >&2
    fi
    return 0
  fi
  return 5
}

# Ключ из env контейнера n8n (если проброшен) или из небольшого списка .env без полного source.
if [[ -z "${N8N_API_KEY:-}" ]]; then
  N8N_API_KEY="$(docker exec "${CONTAINER}" printenv N8N_API_KEY 2>/dev/null | tr -d '\r' || true)"
fi
if [[ -z "${N8N_API_KEY:-}" ]]; then
  for envf in "${HOME}/n8n/.env" "${HOME}/projects/n8n/.env" "${HOME}/.n8n/.env"; do
    [[ -f "${envf}" ]] || continue
    line="$(grep -E '^[[:space:]]*N8N_API_KEY=' "${envf}" 2>/dev/null | tail -n1 || true)"
    if [[ -n "${line}" ]]; then
      N8N_API_KEY="${line#N8N_API_KEY=}"
      N8N_API_KEY="${N8N_API_KEY#\"}"
      N8N_API_KEY="${N8N_API_KEY%\"}"
      break
    fi
  done
fi

if try_api_update; then
  exit 0
fi

# Fallback: CLI import + activate (import не включает production webhook).
if docker cp "${REMOTE_JSON}" "${CONTAINER}:/tmp/telegram_personal_assistant_memory.json" 2>/dev/null; then
  if docker exec "${CONTAINER}" n8n import:workflow --help 2>/dev/null | grep -q -- "--input"; then
    # В новых n8n --separate — булев флаг без значения; --separate=false даёт ошибку парсера CLI.
    docker exec "${CONTAINER}" n8n import:workflow --input=/tmp/telegram_personal_assistant_memory.json || true
    if [[ -n "${WF_ID}" ]] && docker exec "${CONTAINER}" n8n update:workflow --help 2>/dev/null | grep -q -- "--active"; then
      docker exec "${CONTAINER}" n8n update:workflow --id="${WF_ID}" --active=true || true
      echo "[ok] CLI import + activate ${WF_ID}"
    else
      echo "[warn] Импорт через CLI — включите Active в UI: ${N8N_PUBLIC_URL}/workflow/${WF_ID}"
    fi
    exit 0
  fi
fi

echo "[manual] Автоимпорт не сработал. Файл на сервере: ${REMOTE_JSON}"
echo "  • Задайте N8N_API_KEY для юзера n8n и повторите, либо: n8n → Settings → импорт JSON."
REMOTE

echo "Локально: обновлены код и скопирован ${REMOTE_JSON}"
echo "Production webhook (после Active): ${N8N_PUBLIC_URL%/}/webhook/telegram-assistant-memory"
echo "С API key локально: export N8N_API_KEY=... && bash scripts/activate-telegram-assistant-memory.sh"
