#!/usr/bin/env bash
# Push Keept staging secrets to GitHub Actions (AuthRAG + website).
# Reads from local .env (run setup-keept-local-env.sh first).
#
# Usage: bash scripts/setup-keept-github-secrets.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE missing — run: bash scripts/setup-keept-local-env.sh" >&2
  exit 1
fi

get_var() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

ANON="$(get_var VITE_SUPABASE_ANON_KEY)"
API_KEY="$(get_var VITE_BOOKMARKS_API_KEY)"
STAGING_API="https://swoop.autoro.tech"

if [[ -z "$ANON" ]]; then
  echo "ERROR: VITE_SUPABASE_ANON_KEY not in .env" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI required" >&2
  exit 1
fi

set_secret() {
  local repo="$1" name="$2" value="$3"
  echo "  $repo → $name"
  printf '%s' "$value" | gh secret set "$name" -R "$repo"
}

for REPO in autorotech-tech/AuthRAG autorotech-tech/website; do
  echo "→ Secrets for $REPO"
  set_secret "$REPO" KEEPT_BB_ANON_KEY "$ANON"
  set_secret "$REPO" KEEPT_STAGING_API_BASE "$STAGING_API"
  if [[ -n "$API_KEY" ]]; then
    set_secret "$REPO" KEEPT_BOOKMARKS_API_KEY "$API_KEY"
  fi
done

echo "✓ GitHub secrets configured (KEEPT_BB_ANON_KEY, KEEPT_STAGING_API_BASE, KEEPT_BOOKMARKS_API_KEY)"
