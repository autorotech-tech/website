#!/usr/bin/env bash
# Sync Keep It For Me (Keept) slice: website monorepo → AuthRAG (Antigravity mirror).
#
# Usage:
#   bash scripts/sync-keept-to-authrag.sh              # dry-run (rsync -n)
#   bash scripts/sync-keept-to-authrag.sh --apply      # copy files
#   bash scripts/sync-keept-to-authrag.sh --apply --push   # copy + git commit + push
#
# Env:
#   WEBSITE_ROOT   default: repo root (parent of scripts/)
#   AUTHRAG_ROOT   default: ~/AuthRAG or ../AuthRAG if exists
#   AUTHRAG_BRANCH default: bookmarks-bro
#   SYNC_MESSAGE   git commit message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE_ROOT="${WEBSITE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [[ -z "${AUTHRAG_ROOT:-}" ]]; then
  for candidate in "$HOME/AuthRAG" "$WEBSITE_ROOT/../AuthRAG" "$WEBSITE_ROOT/AuthRAG"; do
    if [[ -d "$candidate/.git" ]]; then
      AUTHRAG_ROOT="$candidate"
      break
    fi
  done
fi

AUTHRAG_ROOT="${AUTHRAG_ROOT:-$HOME/AuthRAG}"
AUTHRAG_BRANCH="${AUTHRAG_BRANCH:-bookmarks-bro}"
SYNC_MESSAGE="${SYNC_MESSAGE:-Sync Keept slice from website monorepo}"

DRY_RUN=1
DO_PUSH=0
for arg in "$@"; do
  case "$arg" in
    --apply) DRY_RUN=0 ;;
    --push) DO_PUSH=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

if [[ ! -d "$WEBSITE_ROOT" ]]; then
  echo "ERROR: WEBSITE_ROOT not found: $WEBSITE_ROOT" >&2
  exit 1
fi

if [[ ! -d "$AUTHRAG_ROOT/.git" ]]; then
  echo "AuthRAG not found at $AUTHRAG_ROOT"
  echo "Clone first:"
  echo "  git clone https://github.com/autorotech-tech/AuthRAG.git \"$AUTHRAG_ROOT\""
  echo "  cd \"$AUTHRAG_ROOT\" && git checkout $AUTHRAG_BRANCH"
  exit 1
fi

RSYNC_FLAGS=(-av --delete)
[[ "$DRY_RUN" -eq 1 ]] && RSYNC_FLAGS+=(-n)

echo "Source:      $WEBSITE_ROOT"
echo "Destination: $AUTHRAG_ROOT (branch $AUTHRAG_BRANCH)"
echo "Mode:        $([[ $DRY_RUN -eq 1 ]] && echo dry-run || echo apply)$([[ $DO_PUSH -eq 1 ]] && echo ' + push' || echo '')"
echo

cd "$AUTHRAG_ROOT"
git fetch origin "$AUTHRAG_BRANCH" 2>/dev/null || true
git checkout "$AUTHRAG_BRANCH" 2>/dev/null || git checkout -b "$AUTHRAG_BRANCH"

# Only Keept / Bookmarks Bro slice (+ shared docs & build toolchain for Antigravity)
# rsync: parent dirs must be included before children (see --exclude='*' last).
rsync "${RSYNC_FLAGS[@]}" \
  --include='AGENTS.md' \
  --include='GEMINI.md' \
  --include='DESIGN.md' \
  --include='.env.example' \
  --include='.env.example.keept' \
  --include='package.json' \
  --include='package-lock.json' \
  --include='vite.config.ts' \
  --include='vite.admin.config.ts' \
  --include='tailwind.config.js' \
  --include='postcss.config.js' \
  --include='tsconfig.json' \
  --include='tsconfig.node.json' \
  --include='index.html' \
  --include='admin.html' \
  --include='docker-compose.yml' \
  --include='public/' \
  --include='public/**' \
  --include='src/' \
  --include='src/**' \
  --include='agent-api/' \
  --include='agent-api/**' \
  --include='schemas/' \
  --include='schemas/**' \
  --include='extensions/' \
  --include='extensions/bookmarks-bro/' \
  --include='extensions/bookmarks-bro/**' \
  --include='docs/' \
  --include='docs/bookmarks-bro/' \
  --include='docs/bookmarks-bro/**' \
  --include='n8n/' \
  --include='n8n/workflows/' \
  --include='n8n/workflows/keept_telegram_assistant.json' \
  --include='migrate_bookmarks_bro_mvp.sql' \
  --include='ops/' \
  --include='ops/bookmarks-bro-supabase/' \
  --include='ops/bookmarks-bro-supabase/**' \
  --include='scripts/' \
  --include='scripts/bookmarks-bro-smoke.mjs' \
  --include='scripts/bookmarks-bro-api-test.mjs' \
  --include='scripts/keept-adk.sh' \
  --include='scripts/sync-keept-to-authrag.sh' \
  --include='scripts/setup-understand-anything.sh' \
  --include='scripts/link-antigravity-skills.sh' \
  --include='scripts/setup-keept-local-env.sh' \
  --include='scripts/setup-keept-github-secrets.sh' \
  --include='.github/' \
  --include='.github/workflows/' \
  --include='.github/workflows/keept-staging-smoke.yml' \
  --exclude='*' \
  "$WEBSITE_ROOT/" "$AUTHRAG_ROOT/"

# AuthRAG root README (Antigravity entry point)
if [[ -f "$WEBSITE_ROOT/docs/bookmarks-bro/AUTHRAG-README.md" ]]; then
  cp "$WEBSITE_ROOT/docs/bookmarks-bro/AUTHRAG-README.md" "$AUTHRAG_ROOT/README.md"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "Dry-run complete. Re-run with --apply to copy."
  exit 0
fi

if [[ -z "$(git status --porcelain)" ]]; then
  echo "No changes to commit in AuthRAG."
  exit 0
fi

git add -A
git commit -m "$SYNC_MESSAGE"

if [[ "$DO_PUSH" -eq 1 ]]; then
  git push -u origin "$AUTHRAG_BRANCH"
  echo "Pushed to origin/$AUTHRAG_BRANCH"
else
  echo "Committed locally. Push with: cd \"$AUTHRAG_ROOT\" && git push origin $AUTHRAG_BRANCH"
fi
