#!/usr/bin/env bash
# Копирует hermes_media.py в контейнер autoro-agent-api на VPS (vision/transcribe).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
SRC="$ROOT/agent-api/hermes_media.py"

scp -i "$KEY" "$SRC" "$REMOTE:/tmp/hermes_media.py"
ssh -i "$KEY" "$REMOTE" 'docker cp /tmp/hermes_media.py autoro-agent-api:/app/hermes_media.py'
echo "hermes_media.py installed in autoro-agent-api (vision tier chain from Swoop)"
