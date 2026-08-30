#!/usr/bin/env bash
# Run this script ON the server (e.g. in /home/vladx/autoro-dashboard or where your repo lives).
# Prerequisites:
#   1. Copy updated AdminSettings.tsx to server:
#      scp website/src/components/AdminSettings.tsx user@server:/home/vladx/autoro-dashboard/src/components/
#   2. DATABASE_URL must be set (e.g. in .env or export).

set -e
DASHBOARD_DIR="${DASHBOARD_DIR:-/home/vladx/autoro-dashboard}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

echo "=== 1. Migrations ==="
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set. Load .env or export DATABASE_URL."
  exit 1
fi
if [ -f "$REPO_DIR/scrapling-worker/migrate_llm_openrouter.sql" ]; then
  psql "$DATABASE_URL" -f "$REPO_DIR/scrapling-worker/migrate_llm_openrouter.sql" && echo "openrouter_keys OK"
fi
if [ -f "$REPO_DIR/scrapling-worker/migrate_llm_brave.sql" ]; then
  psql "$DATABASE_URL" -f "$REPO_DIR/scrapling-worker/migrate_llm_brave.sql" && echo "brave_keys OK"
fi

echo "=== 2. Copy AdminSettings.tsx (if repo and dashboard differ) ==="
if [ -n "$REPO_DIR" ] && [ "$REPO_DIR" != "$DASHBOARD_DIR" ] && [ -f "$REPO_DIR/src/components/AdminSettings.tsx" ]; then
  cp "$REPO_DIR/src/components/AdminSettings.tsx" "$DASHBOARD_DIR/src/components/AdminSettings.tsx"
  echo "Copied AdminSettings.tsx into $DASHBOARD_DIR"
fi

echo "=== 3. Build and up frontend ==="
cd "$DASHBOARD_DIR"
docker-compose build --no-cache frontend
docker-compose up -d frontend
echo "Done. Check https://swoop.autoro.tech/admin/settings (incognito)."
