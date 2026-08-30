#!/usr/bin/env bash
# Save OpenModel API key locally and print Cursor setup steps (key never written to repo).
set -euo pipefail

CONFIG_DIR="${OPENMODEL_CONFIG_DIR:-$HOME/.config/autoro}"
ENV_FILE="$CONFIG_DIR/openmodel.env"
BASE_URL="${OPENMODEL_BASE_URL:-https://api.openmodel.ai}"
MODEL="${OPENMODEL_MODEL:-deepseek-v4-flash}"

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [[ -n "${OPENMODEL_API_KEY:-}" ]]; then
  KEY="$OPENMODEL_API_KEY"
elif [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  KEY="${OPENMODEL_API_KEY:-}"
fi

if [[ -z "${KEY:-}" ]]; then
  read -r -s -p "OpenModel API key (om-…): " KEY
  echo
fi

if [[ -z "${KEY:-}" ]]; then
  echo "ERROR: empty API key" >&2
  exit 1
fi

umask 077
cat >"$ENV_FILE" <<EOF
# OpenModel — local only, not for git
OPENMODEL_API_KEY=$KEY
OPENMODEL_BASE_URL=$BASE_URL
OPENMODEL_MODEL=$MODEL
EOF
chmod 600 "$ENV_FILE"

echo "Saved: $ENV_FILE"
echo ""
echo "Smoke test…"
HTTP_CODE=$(curl -sS -m 20 -o /tmp/openmodel-smoke.json -w "%{http_code}" \
  "$BASE_URL/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":16,\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}]}")

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "✅ API OK ($MODEL)"
else
  echo "⚠ HTTP $HTTP_CODE — check key and model name"
  head -c 200 /tmp/openmodel-smoke.json 2>/dev/null || true
  echo
fi

echo ""
echo "Cursor IDE:"
echo "  1. Settings → Models → Anthropic"
echo "  2. API Key: (same om- key)"
echo "  3. Override Base URL: $BASE_URL"
echo "  4. Add model: $MODEL"
echo "  5. Reload Window + new chat"
echo ""
echo "Docs: .cursor/OPENMODEL.md"
