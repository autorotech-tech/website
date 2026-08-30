#!/usr/bin/env bash
set -euo pipefail

WEBHOOK_URL="${1:-}"
SECRET="${2:-${TELEGRAM_WEBHOOK_SECRET:-}}"
PAYLOAD_FILE="${3:-n8n/workflows/smoke-test.telegram-knowledge.payload.json}"

if [[ -z "${WEBHOOK_URL}" ]]; then
  echo "Usage: $0 <WEBHOOK_URL> [TELEGRAM_WEBHOOK_SECRET] [PAYLOAD_FILE]"
  exit 1
fi

if [[ ! -f "${PAYLOAD_FILE}" ]]; then
  echo "Payload file not found: ${PAYLOAD_FILE}"
  exit 1
fi

echo "Running smoke test..."
curl -sS -X POST "${WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -H "x-telegram-bot-api-secret-token: ${SECRET}" \
  --data-binary @"${PAYLOAD_FILE}"
echo
