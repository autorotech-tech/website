#!/usr/bin/env bash
# Создаёт структуру Autoro KB в локальном Obsidian vault (совпадает с VPS).
set -euo pipefail

VAULT_DIR="${1:-/Users/vlad_x/Desktop/soft/ObsidianVault}"
WS="${KNOWLEDGE_WORKSPACE_ID:-1}"
ROOT="${VAULT_DIR}/Autoro KB/ws-${WS}"

mkdir -p "${ROOT}/Knowledge Inbox" "${ROOT}/Prompts Library"

cat > "${ROOT}/README.md" <<EOF
# Autoro KB (workspace ${WS})

Заметки из Telegram / Hermes и Swoop knowledge_items синхронизируются сюда.

- **Knowledge Inbox** — статьи, подборки, заметки (\`capture_forward\`)
- **Prompts Library** — промпты

Сервер: \`/home/vladx/obsidian-vault/Autoro KB/ws-${WS}/\` (Syncthing ↔ эта папка на Mac).
EOF

echo "OK: ${ROOT}"
ls -la "${ROOT}"
