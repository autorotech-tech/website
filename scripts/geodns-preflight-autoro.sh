#!/usr/bin/env bash
# GeoDNS Plan A preflight for autoro.tech (RF via Gcore, rest via Cloudflare).
# Usage:
#   bash scripts/geodns-preflight-autoro.sh
#   GCORE_CNAME=xxx.gcdn.co bash scripts/geodns-preflight-autoro.sh --gcore
#   bash scripts/geodns-preflight-autoro.sh --post-cutover
set -euo pipefail

DOMAIN="${AUTORO_DOMAIN:-autoro.tech}"
ORIGIN_IP="${AUTORO_ORIGIN_IP:-46.250.228.229}"
MIN_BYTES="${AUTORO_MIN_BYTES:-16384}"
GCORE_CNAME="${GCORE_CNAME:-${GCORE_CDN_CNAME:-}}"
MODE="${1:-}"

PASS=0
FAIL=0
WARN=0

pass() { echo "  ✅ $*"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠️  $*"; WARN=$((WARN + 1)); }
section() { echo; echo "=== $* ==="; }

check_size() {
  local label="$1" url="$2"
  shift 2
  local size
  size=$(curl -sf "$@" -o /dev/null -w '%{size_download}' --max-time 30 "$url" 2>/dev/null || echo 0)
  if [[ "${size:-0}" -ge "$MIN_BYTES" ]]; then
    pass "$label: ${size} bytes (>= ${MIN_BYTES})"
  else
    fail "$label: ${size} bytes (< ${MIN_BYTES} — RF throttle risk on Cloudflare path)"
  fi
}

section "DNS — $DOMAIN"
NS_GOOGLE=$(dig +short "$DOMAIN" NS @8.8.8.8 2>/dev/null | sort | tr '\n' ' ')
A_GOOGLE=$(dig +short "$DOMAIN" A @8.8.8.8 2>/dev/null | sort | tr '\n' ' ')
A_YANDEX=$(dig +short "$DOMAIN" A @77.88.8.8 2>/dev/null | sort | tr '\n' ' ')
echo "  NS @8.8.8.8:    ${NS_GOOGLE:-<empty>}"
echo "  A  @8.8.8.8:    ${A_GOOGLE:-<empty>}"
echo "  A  @77.88.8.8:  ${A_YANDEX:-<empty>}"

if echo "$NS_GOOGLE" | grep -qi cloudflare; then
  warn "Authoritative NS still Cloudflare — GeoDNS split not active yet"
elif echo "$NS_GOOGLE" | grep -qiE 'gcore|gcdn'; then
  pass "Authoritative NS appears to be Gcore"
else
  warn "NS pattern unrecognized: $NS_GOOGLE"
fi

if [[ "$MODE" == "--post-cutover" ]]; then
  if echo "$A_YANDEX" | grep -qE '104\.21\.|172\.67\.'; then
    fail "Yandex resolver still returns Cloudflare A (RF branch not active?)"
  elif [[ -n "$A_YANDEX" ]]; then
    pass "Yandex resolver A differs from Cloudflare: $A_YANDEX"
  else
    fail "Yandex resolver returned no A record"
  fi
fi

section "Origin TLS — $ORIGIN_IP"
ORIGIN_HEADERS=$(curl -sfI --resolve "${DOMAIN}:443:${ORIGIN_IP}" "https://${DOMAIN}/" --max-time 15 2>/dev/null || true)
if [[ -n "$ORIGIN_HEADERS" ]]; then
  pass "Origin HTTPS responds"
else
  fail "Origin HTTPS no response via --resolve"
fi

section "Payload sizes (16KB RF throttle check)"
check_size "index.html via CF" "https://${DOMAIN}/"
check_size "services-catalog.json" "https://${DOMAIN}/services-catalog.json"

if [[ -n "$GCORE_CNAME" ]]; then
  section "Gcore CDN path — $GCORE_CNAME"
  GCORE_IP=$(dig +short "$GCORE_CNAME" 2>/dev/null | head -1)
  echo "  CNAME → ${GCORE_IP:-<empty>}"
  if [[ -n "$GCORE_IP" ]]; then
    check_size "index via Gcore" "https://${DOMAIN}/" --resolve "${DOMAIN}:443:${GCORE_IP}"
    HDR=$(curl -sfI --resolve "${DOMAIN}:443:${GCORE_IP}" "https://${DOMAIN}/" --max-time 15 2>/dev/null || true)
    if echo "$HDR" | grep -qi 'cf-ray:'; then
      fail "Gcore path still shows cf-ray"
    else
      pass "Gcore path: no cf-ray"
    fi
  else
    fail "Could not resolve GCORE_CDN_CNAME"
  fi
fi

section "Summary"
echo "  PASS=$PASS FAIL=$FAIL WARN=$WARN"
[[ "$FAIL" -eq 0 ]] || exit 1
