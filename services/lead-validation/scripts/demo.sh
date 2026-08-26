#!/usr/bin/env bash
# Turnkey local demo for Lead Validation Microservice.
# Idempotent: reuses a healthy API on PORT if already up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3105}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="http://${HOST}:${PORT}"
PID_FILE="${ROOT}/.demo-api.pid"
DEMO_DIR="${ROOT}/demo"
STARTED_BY_US=0

if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  cp .env.example .env
  echo "[demo] created .env from .env.example"
fi

# shellcheck disable=SC1091
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1090
  source .env
  set +a
  PORT="${PORT:-3105}"
  BASE_URL="http://${HOST}:${PORT}"
fi

api_healthy() {
  curl -sf "${BASE_URL}/health" >/dev/null 2>&1
}

wait_for_health() {
  local i
  for i in $(seq 1 40); do
    if api_healthy; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

cleanup() {
  if [[ "${STARTED_BY_US}" -eq 1 ]] && [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo ""
      echo "[demo] stopping API (pid ${pid}) ..."
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    fi
    rm -f "${PID_FILE}"
  fi
}

# Ctrl+C / SIGTERM: stop only the API we started in this session.
trap cleanup EXIT INT TERM

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Lead Validation — vibe demo                         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[demo] Node.js 20+ required. Install Node, then re-run."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[demo] npm install ..."
  npm install
fi

if api_healthy; then
  echo "[demo] API already healthy at ${BASE_URL}"
else
  echo "[demo] starting API (npm start) on ${BASE_URL} ..."
  npm start >/tmp/lead-validation-demo.log 2>&1 &
  echo $! >"${PID_FILE}"
  STARTED_BY_US=1
  if ! wait_for_health; then
    echo "[demo] API failed to become healthy. Last log lines:"
    tail -n 40 /tmp/lead-validation-demo.log || true
    exit 1
  fi
  echo "[demo] API up (pid $(cat "${PID_FILE}"))"
fi

echo ""
echo "── URLs ───────────────────────────────────────────────"
echo "  Health:   ${BASE_URL}/health"
echo "  Validate: ${BASE_URL}/v1/leads/validate"

if [[ -f "${DEMO_DIR}/index.html" ]]; then
  echo "  UI:       ${BASE_URL}/  (static demo/ served by API)"
  echo ""
  echo "[demo] open UI:  ${BASE_URL}/"
else
  echo "  UI:       (demo/ not ready yet)"
  echo ""
  echo "[demo] Frontend folder missing. When the UI lands:"
  echo "         mkdir -p demo && drop index.html into demo/"
  echo "         then re-run this script (or open ${BASE_URL}/ )"
  echo "         See VIBE.md for the handoff."
fi

echo ""
echo "── curl smoke ─────────────────────────────────────────"
echo "curl -s ${BASE_URL}/health | jq ."
echo ""
echo "curl -s -X POST ${BASE_URL}/v1/leads/validate \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"email\":\"user@company.com\",\"phone\":\"+12025550123\",\"name\":\"Jane Doe\",\"company\":\"Acme\",\"source\":\"landing\"}'"
echo ""

# Live smoke (no jq required)
echo "[demo] live smoke /health:"
curl -s "${BASE_URL}/health" || true
echo ""
echo ""
echo "[demo] live smoke /v1/leads/validate:"
curl -s -X POST "${BASE_URL}/v1/leads/validate" \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@company.com","phone":"+12025550123","name":"Jane Doe","company":"Acme","source":"landing"}' \
  || true
echo ""
echo ""

if [[ "${STARTED_BY_US}" -eq 1 ]]; then
  echo "[demo] API running in foreground hold — Ctrl+C to stop."
  echo "       Log: /tmp/lead-validation-demo.log"
  echo ""
  # Keep process group alive while API runs
  while kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; do
    sleep 2
  done
  echo "[demo] API process exited."
else
  echo "[demo] reused existing API — leaving it running (no Ctrl+C needed)."
  # Clear trap so we don't kill a foreign process
  STARTED_BY_US=0
  rm -f "${PID_FILE}"
  trap - EXIT INT TERM
fi
