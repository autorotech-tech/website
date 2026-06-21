#!/usr/bin/env bash
# Run keep-it-for-me (ADK agent) or agent-api security tests from website root.
#
# Usage:
#   bash scripts/keept-adk.sh test              # unit tests (keep-it-for-me)
#   bash scripts/keept-adk.sh test-integration
#   bash scripts/keept-adk.sh test-backend      # agent-api security tests
#   bash scripts/keept-adk.sh test-all
#   bash scripts/keept-adk.sh playground
#   bash scripts/keept-adk.sh grade
#
# Env:
#   KEEPT_ADK_ROOT   default: ../../google intensive/keep-it-for-me (from website root)
#   WEBSITE_ROOT     default: parent of scripts/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE_ROOT="${WEBSITE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [[ -z "${KEEPT_ADK_ROOT:-}" ]]; then
  for candidate in \
    "$WEBSITE_ROOT/../../google intensive/keep-it-for-me" \
    "$HOME/Desktop/n8n/google intensive/keep-it-for-me"; do
    if [[ -d "$candidate/app" ]]; then
      KEEPT_ADK_ROOT="$candidate"
      break
    fi
  done
fi

KEEPT_ADK_ROOT="${KEEPT_ADK_ROOT:-}"

if [[ -z "$KEEPT_ADK_ROOT" || ! -d "$KEEPT_ADK_ROOT" ]]; then
  echo "ERROR: keep-it-for-me not found." >&2
  echo "Set KEEPT_ADK_ROOT or clone ADK agent next to n8n:" >&2
  echo "  ~/Desktop/n8n/google intensive/keep-it-for-me" >&2
  exit 1
fi

PYTEST="${KEEPT_ADK_ROOT}/.venv/bin/pytest"
if [[ ! -x "$PYTEST" ]]; then
  echo "ADK venv missing at $KEEPT_ADK_ROOT/.venv — run: cd \"$KEEPT_ADK_ROOT\" && uv sync" >&2
  exit 1
fi

cmd="${1:-help}"

run_adk() {
  (cd "$KEEPT_ADK_ROOT" && uv run "$@")
}

run_backend_security() {
  (cd "$WEBSITE_ROOT/agent-api" && PYTHONPATH=. "$PYTEST" tests/test_security_backend.py -v)
}

case "$cmd" in
  test)
    run_adk pytest tests/unit/test_security.py -v
    ;;
  test-integration)
    run_adk pytest tests/integration/test_rag_pipeline.py -v
    ;;
  test-backend)
    run_backend_security
    ;;
  test-all)
    run_adk pytest tests/unit/test_security.py -v
    run_adk pytest tests/integration/test_rag_pipeline.py -v
    run_backend_security
    ;;
  playground)
    (cd "$KEEPT_ADK_ROOT" && make playground)
    ;;
  grade)
    (cd "$KEEPT_ADK_ROOT" && make grade)
    ;;
  help|-h|--help)
    sed -n '2,12p' "$0"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    exit 1
    ;;
esac
