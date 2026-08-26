#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash n8n/workflows/deploy-and-test.sh [VPS_USER] [VPS_HOST] [N8N_HOST] [TG_SECRET]
#
# Examples:
#   bash n8n/workflows/deploy-and-test.sh
#   bash n8n/workflows/deploy-and-test.sh vladx vmi2607864 https://n8n.example.com mysecret

VPS_USER="${1:-vladx}"
VPS_HOST="${2:-vmi2607864}"
N8N_HOST="${3:-${N8N_HOST:-}}"
TG_SECRET="${4:-${TELEGRAM_WEBHOOK_SECRET:-}}"
VPS_DIR="${VPS_DIR:-~/n8n/workflows}"

LOCAL_BASE="/Users/vlad_x/Desktop/n8n/autoro.tech/website/n8n/workflows"

FILES=(
  "telegram_knowledge_ingestion_phase2.json"
  "smoke-test.telegram-knowledge.payload.json"
  "smoke-test.telegram-knowledge.sh"
  "retry-sync.telegram-knowledge.sh"
  "telegram_knowledge_ingestion.env.example"
)

echo "[1/6] Create remote directory: ${VPS_DIR}"
ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ${VPS_DIR}"

echo "[2/6] Upload workflow and scripts to VPS"
SCP_ARGS=()
for f in "${FILES[@]}"; do
  SCP_ARGS+=("${LOCAL_BASE}/${f}")
done
scp "${SCP_ARGS[@]}" "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/"

echo "[3/6] Set executable bits and list files"
ssh "${VPS_USER}@${VPS_HOST}" "chmod +x ${VPS_DIR}/*.sh && ls -la ${VPS_DIR}"

if [[ -z "${N8N_HOST}" ]]; then
  echo "[4/6] N8N_HOST is empty, trying auto-discovery on VPS"
  N8N_HOST="$(ssh "${VPS_USER}@${VPS_HOST}" "rg -n \"N8N_HOST|WEBHOOK_URL|PUBLIC_URL\" ~/n8n/.env ~/n8n/*/.env 2>/dev/null | rg -o \"https?://[^\\\"'[:space:]]+\" -m 1 || true")"
  if [[ -n "${N8N_HOST}" ]]; then
    echo "      discovered N8N_HOST=${N8N_HOST}"
  fi
fi

if [[ -z "${TG_SECRET}" ]]; then
  echo "[5/6] TELEGRAM_WEBHOOK_SECRET is empty, trying auto-discovery on VPS"
  TG_SECRET="$(ssh "${VPS_USER}@${VPS_HOST}" "rg -n \"TELEGRAM_WEBHOOK_SECRET=\" ~/n8n/.env ~/n8n/*/.env 2>/dev/null | sed -E 's/.*TELEGRAM_WEBHOOK_SECRET=//; s/[[:space:]]+$//' | awk 'NR==1 {print; exit}' || true")"
  if [[ -n "${TG_SECRET}" ]]; then
    echo "      discovered TELEGRAM_WEBHOOK_SECRET (masked): ${TG_SECRET:0:3}***"
  fi
fi

echo "[6/6] Run smoke and retry if all required vars are available"
if [[ -n "${N8N_HOST}" && -n "${TG_SECRET}" ]]; then
  ssh "${VPS_USER}@${VPS_HOST}" "bash ${VPS_DIR}/smoke-test.telegram-knowledge.sh \"${N8N_HOST%/}/webhook/telegram-knowledge-ingest\" \"${TG_SECRET}\""
  ssh "${VPS_USER}@${VPS_HOST}" "bash ${VPS_DIR}/retry-sync.telegram-knowledge.sh \"${N8N_HOST%/}/webhook/telegram-knowledge-retry\""
  echo "Done: smoke + retry executed."
else
  echo "Skipped live tests: missing values."
  echo "N8N_HOST='${N8N_HOST}'"
  if [[ -z "${TG_SECRET}" ]]; then
    echo "TELEGRAM_WEBHOOK_SECRET is empty"
  else
    echo "TELEGRAM_WEBHOOK_SECRET is present (masked): ${TG_SECRET:0:3}***"
  fi
  echo ""
  echo "Run manually:"
  echo "bash ${VPS_DIR}/smoke-test.telegram-knowledge.sh \"https://<N8N_HOST>/webhook/telegram-knowledge-ingest\" \"<TELEGRAM_WEBHOOK_SECRET>\""
  echo "bash ${VPS_DIR}/retry-sync.telegram-knowledge.sh \"https://<N8N_HOST>/webhook/telegram-knowledge-retry\""
fi
