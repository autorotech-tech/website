#!/bin/bash
# Deploy Login.tsx (without Turnstile) to swoop.autoro.tech
# Run from: website/

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "📤 Deploying Login without Turnstile to swoop..."

# Check disk space on server first
echo "Checking server disk space..."
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "df -h / | tail -1"

# Ensure projects-based layout (no repos in /home/vladx root)
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "mkdir -p /home/vladx/projects && if [ -d /home/vladx/autoro-dashboard ] && [ ! -d /home/vladx/projects/autoro-dashboard ]; then mv /home/vladx/autoro-dashboard /home/vladx/projects/autoro-dashboard; fi"

# Copy Login.tsx
scp -i ~/.ssh/id_ed25519_autoro src/components/Login.tsx vladx@46.250.228.229:/home/vladx/projects/autoro-dashboard/src/components/ || {
  echo "❌ Copy failed. Free disk space: ssh vladx@46.250.228.229 'df -h && du -sh /home/vladx/* 2>/dev/null | sort -hr | head -10'"
  exit 1
}

echo "✅ Login.tsx copied. Rebuilding swoop..."
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'REMOTE'
cd /home/vladx/projects/autoro-dashboard
docker compose build frontend 2>/dev/null || docker-compose build frontend
docker compose up -d frontend 2>/dev/null || docker-compose up -d frontend
REMOTE

echo "✅ Done! Check https://swoop.autoro.tech/login — Turnstile should be gone."
