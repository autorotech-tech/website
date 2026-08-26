#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"

scp -i "$KEY" "$ROOT/scripts/fix_kb_item_31.py" "$REMOTE:/tmp/fix_kb_item_31.py"
ssh -i "$KEY" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
docker cp /tmp/fix_kb_item_31.py autoro-agent-api:/tmp/fix_kb_item_31.py
docker exec autoro-agent-api python3 /tmp/fix_kb_item_31.py
API_KEY="$(docker exec autoro-agent-api printenv OPENROUTER_API_KEY 2>/dev/null | tr -d '\r' | head -1)"
curl -sS -X POST "http://127.0.0.1:8900/api/v1/knowledge/31/re-enrich" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"1","forceFetch":false}'
echo
REMOTE
