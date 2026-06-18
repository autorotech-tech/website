#!/usr/bin/env bash
# Восстановление/подъём изолированного Supabase для Bookmarks Bro на VPS.
# Не используйте обрывающиеся heredoc в чате — сохраните файл и запускайте: bash ./recover_bb_stack.sh
set -euo pipefail

# #region agent log
_bb_log() {
  local hypothesisId="$1" location="$2" message="$3" data="${4:-{}}"
  local ts
  ts="$(date +%s)000"
  local line
  line="$(printf '{"sessionId":"ff686a","hypothesisId":"%s","location":"%s","message":"%s","data":%s,"timestamp":%s,"runId":"%s"}\n' \
    "$hypothesisId" "$location" "$message" "$data" "$ts" "${BB_RUN_ID:-bb-recover}")"
  if [[ -n "${BB_DEBUG_LOG:-}" ]]; then
    printf '%s' "$line" >>"$BB_DEBUG_LOG" 2>/dev/null || true
  fi
  # Локальная отладка Cursor (если скрипт запускают с рабочей станции с этим путём)
  local _cursor_log="/Users/vlad_x/Desktop/n8n/autoro.tech/website/.cursor/debug-ff686a.log"
  if [[ -w "$(dirname "$_cursor_log")" ]] 2>/dev/null; then
    printf '%s' "$line" >>"$_cursor_log" 2>/dev/null || true
  fi
}
# #endregion

COMPOSE_DIR="${COMPOSE_DIR:-/home/vladx/supabase-bookmarks-bro}"
PROJECT_NAME="${PROJECT_NAME:-supabase-bb}"
COMPOSE_OUT="${COMPOSE_OUT:-docker-compose.bb.yml}"
NETWORK_ISO="${NETWORK_ISO:-bookmarks_bro_supabase_net}"

KONG_HTTP_PORT="${KONG_HTTP_PORT:-54325}"
KONG_HTTPS_PORT="${KONG_HTTPS_PORT:-8445}"
STUDIO_PORT="${STUDIO_PORT:-3101}"
POOLER_DB_PORT="${POOLER_DB_PORT:-5435}"
POOLER_TX_PORT="${POOLER_TX_PORT:-6545}"

_bb_log "H_setup" "recover_bb_stack.sh:start" "Enter recover" "{\"COMPOSE_DIR\":\"$COMPOSE_DIR\",\"PROJECT_NAME\":\"$PROJECT_NAME\"}"

pick_compose_bin() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi
  echo ""
}

COMPOSE_BIN="$(pick_compose_bin)"
if [[ -z "$COMPOSE_BIN" ]]; then
  _bb_log "H_compose" "recover_bb_stack.sh:pick_compose_bin" "No compose binary" "{}"
  echo "ERROR: Нет ни «docker compose», ни docker-compose."
  exit 1
fi
_bb_log "H_compose" "recover_bb_stack.sh:compose" "Using COMPOSE_BIN" "{\"COMPOSE_BIN\":\"$COMPOSE_BIN\"}"

cd "$COMPOSE_DIR" || {
  _bb_log "H_path" "recover_bb_stack.sh:cd" "COMPOSE_DIR missing" "{\"COMPOSE_DIR\":\"$COMPOSE_DIR\"}"
  echo "ERROR: Каталог не найден: $COMPOSE_DIR"
  exit 1
}

if [[ ! -f docker-compose.yml ]]; then
  _bb_log "H_path" "recover_bb_stack.sh:compose_yml" "No docker-compose.yml" "{}"
  echo "ERROR: В $COMPOSE_DIR нет docker-compose.yml"
  exit 1
fi

echo "==> Создаю изолированную сеть ${NETWORK_ISO} (если нет)..."
docker network inspect "${NETWORK_ISO}" >/dev/null 2>&1 || docker network create "${NETWORK_ISO}"
_bb_log "H_net" "recover_bb_stack.sh:network_iso" "Network ensured" "{\"NETWORK_ISO\":\"$NETWORK_ISO\"}"

echo "==> Собираю ${COMPOSE_OUT} из docker-compose.yml ..."
cp -f docker-compose.yml "${COMPOSE_OUT}"

# Уникальные имена контейнеров *-bb
sed -E -i 's/^([[:space:]]*container_name:[[:space:]]*"?)([a-zA-Z0-9._-]+)("?[[:space:]]*)$/\1\2-bb\3/' "${COMPOSE_OUT}"
_bb_log "H_names" "recover_bb_stack.sh:sed" "container_name suffixed -bb" "{}"

# Частые порты (хост), чтобы не конфликтовать со вторым Supabase
sed -i 's/"54321:8000"/"'"${KONG_HTTP_PORT}"':8000"/g' "${COMPOSE_OUT}" || true
sed -i 's/54321:8000/'"${KONG_HTTP_PORT}"':8000/g' "${COMPOSE_OUT}" || true
sed -i 's/"8443:8443"/"'"${KONG_HTTPS_PORT}"':8443"/g' "${COMPOSE_OUT}" || true
sed -i 's/"127.0.0.1:3100:3000"/"127.0.0.1:'"${STUDIO_PORT}"':3000"/g' "${COMPOSE_OUT}" || true
sed -i 's/"5433:5432"/"'"${POOLER_DB_PORT}"':5432"/g' "${COMPOSE_OUT}" || true
sed -i 's/"6543:6543"/"'"${POOLER_TX_PORT}"':6543"/g' "${COMPOSE_OUT}" || true

ensure_volume_line() {
  local vol="$1"
  grep -q '^volumes:' "${COMPOSE_OUT}" || printf '\nvolumes:\n' >>"${COMPOSE_OUT}"
  if ! grep -qE "^[[:space:]]*${vol}:[[:space:]]*$" "${COMPOSE_OUT}"; then
    printf '  %s:\n' "$vol" >>"${COMPOSE_OUT}"
    _bb_log "H1" "recover_bb_stack.sh:ensure_volume" "Appended volume" "{\"volume\":\"$vol\"}"
  fi
}

ensure_network_external() {
  local net="$1"
  [[ "$net" == "default" ]] && return 0
  grep -q '^networks:' "${COMPOSE_OUT}" || printf '\nnetworks:\n' >>"${COMPOSE_OUT}"
  if ! grep -qE "^[[:space:]]*${net}:[[:space:]]*$" "${COMPOSE_OUT}"; then
    printf '  %s:\n    external: true\n' "$net" >>"${COMPOSE_OUT}"
    _bb_log "H2" "recover_bb_stack.sh:ensure_network" "Appended external network" "{\"network\":\"$net\"}"
  fi
  docker network inspect "$net" >/dev/null 2>&1 || docker network create "$net" || true
}

# Предварительно: внешние сети из оригинального compose часто требуются studio — добьём по ошибкам compose.
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  set +e
  OUT="$(${COMPOSE_BIN} -p "${PROJECT_NAME}" -f "${COMPOSE_OUT}" up -d 2>&1)"
  UC=$?
  set -e
  echo "$OUT"
  if [[ "$UC" -eq 0 ]]; then
    _bb_log "H_ok" "recover_bb_stack.sh:up" "docker compose up -d exit 0" "{}"
    break
  fi
  if echo "$OUT" | grep -qiE 'invalid compose project|undefined volume'; then
    MV="$(echo "$OUT" | sed -n 's/.*undefined volume \([^: ]*\).*/\1/p' | head -n1)"
    if [[ -n "${MV:-}" ]]; then
      echo ">>> (H1) Добавляю volume: $MV"
      ensure_volume_line "$MV"
      continue
    fi
  fi
  if echo "$OUT" | grep -qi 'undefined network'; then
    MN="$(echo "$OUT" | sed -n 's/.*undefined network \([^: ]*\).*/\1/p' | head -n1)"
    if [[ -n "${MN:-}" ]]; then
      echo ">>> (H2) Добавляю network: $MN"
      ensure_network_external "$MN"
      continue
    fi
  fi
  if echo "$OUT" | grep -qi 'port is already allocated'; then
    PORT_ERR="$(echo "$OUT" | sed -n 's/.*Bind for .*:\([0-9]*\).*/\1/p' | head -n1)"
    _bb_log "H3" "recover_bb_stack.sh:port" "Port conflict" "{\"port\":\"${PORT_ERR:-unknown}\"}"
    echo ">>> (H3) Конфликт порта на хосте (see log/data). Подправьте mapped host ports в ${COMPOSE_OUT} вручную и перезапустите скрипт."
    exit 2
  fi
  if echo "$OUT" | grep -qiE 'error|Error|failed'; then
    if echo "$OUT" | grep -qiE 'undefined volume|undefined network'; then
      continue
    fi
    _bb_log "H_other" "recover_bb_stack.sh:up" "Non-volume compose error" "{\"snippet\":\"$(echo "$OUT" | head -c 200 | tr '\n' ' ')\"}"
    exit 3
  fi
  # Не удалось ни починить, ни получить явную ошибку — выходим, чтобы не крутиться зря.
  if [[ "$i" -ge 12 ]]; then
    _bb_log "H_other" "recover_bb_stack.sh:loop" "Max iterations" "{}"
    echo "ERROR: Превышено число попыток авто-исправления. Смотрите вывод выше."
    exit 4
  fi
done

echo "=== Контейнеры ${PROJECT_NAME} / *-bb ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'supabase-.*-bb|NAMES' || true

DB_CANDIDATE="$(docker ps --format '{{.Names}}' | grep -E 'db-bb$|supabase-db-bb' | head -n1 || true)"
if [[ -n "${DB_CANDIDATE}" ]]; then
  _bb_log "H4" "recover_bb_stack.sh:db" "DB container for psql" "{\"container\":\"$DB_CANDIDATE\"}"
  echo ""
  echo "=== Применить SQL (пользователь postgres, не supabase_admin) ==="
  echo "cat /path/to/001_bookmarks_bro_isolation.sql | docker exec -i ${DB_CANDIDATE} psql -U postgres -d postgres"
else
  _bb_log "H4" "recover_bb_stack.sh:db" "No db-bb container found" "{}"
  echo "WARN: Контейнер БД *-bb не найден — проверьте docker ps."
fi

echo "Готово."
