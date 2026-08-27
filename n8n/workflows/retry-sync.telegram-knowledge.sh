#!/usr/bin/env bash
set -euo pipefail

RETRY_WEBHOOK_URL="${1:-}"

if [[ -z "${RETRY_WEBHOOK_URL}" ]]; then
  echo "Usage: $0 <RETRY_WEBHOOK_URL>"
  exit 1
fi

curl -sS -X POST "${RETRY_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  --data '{}'
echo
