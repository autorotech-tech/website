#!/usr/bin/env bash
# Локальный obsidian-relay для Mac: agent-api пишет сюда (OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${OBSIDIAN_LOCAL_RELAY_ENV:-$ROOT/scripts/obsidian-local-relay.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

export PORT="${OBSIDIAN_LOCAL_RELAY_PORT:-8788}"
export HOST="${OBSIDIAN_LOCAL_RELAY_HOST:-127.0.0.1}"
export OBSIDIAN_SYNC_TOKEN="${OBSIDIAN_SYNC_TOKEN:-autoro_obsidian_sync_v1}"
export OBSIDIAN_VAULT_DIR="${OBSIDIAN_VAULT_DIR:-}"

if [[ -z "$OBSIDIAN_VAULT_DIR" || ! -d "$OBSIDIAN_VAULT_DIR" ]]; then
  echo "Задайте OBSIDIAN_VAULT_DIR в $ENV_FILE (папка vault Obsidian на Mac)." >&2
  exit 1
fi

echo "obsidian-local-relay: http://${HOST}:${PORT}/sync"
echo "vault: $OBSIDIAN_VAULT_DIR"
exec node "$ROOT/obsidian-relay/server.mjs"
