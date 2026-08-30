#!/bin/bash
# ─────────────────────────────────────────────────────
# Autoro Deep Search — Local Test Launcher
# Runs Python worker WITHOUT Docker for development
# ─────────────────────────────────────────────────────

set -e

DIR="$(cd "$(dirname "$0")/deep-search-worker" && pwd)"
cd "$DIR"

# Use a public SearXNG instance when self-hosted isn't available locally
# Replace with http://localhost:8080 if you run SearXNG separately
PUBLIC_SEARXNG="https://searx.be"

echo "🔍 Starting Autoro Deep Search Worker (local dev mode)"
echo "   Workers dir: $DIR"
echo "   SearXNG:     $PUBLIC_SEARXNG"
echo "   Port:        8001"
echo ""

# Create venv if needed
if [ ! -d ".venv" ]; then
  echo "📦 Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "📦 Installing/updating dependencies..."
pip install -q -r requirements.txt

echo ""
echo "🚀 Launching FastAPI server..."
echo "   Test URL: http://localhost:8001/health"
echo "   Swoop UI: cd .. && npm run dev → http://localhost:5173/admin/deep-search"
echo ""

OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
BRAVE_API_KEY="${BRAVE_API_KEY:-}" \
SEARXNG_URL="$PUBLIC_SEARXNG" \
DEFAULT_MODEL="${DEFAULT_MODEL:-google/gemini-2.0-flash-001}" \
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
