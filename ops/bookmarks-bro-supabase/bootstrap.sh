#!/usr/bin/env bash
set -euo pipefail

# Автономный bootstrap отдельного self-hosted Supabase для Bookmarks Bro.
# Предполагает, что на сервере уже есть рабочий Supabase проект
# (например /home/vladx/supabase-project или /home/vladx/supabase).

TARGET_DIR="${TARGET_DIR:-/home/vladx/supabase-bookmarks-bro}"
SOURCE_DIR="${SOURCE_DIR:-}"
NETWORK_NAME="${NETWORK_NAME:-bookmarks_bro_supabase_net}"
PROJECT_NAME="${PROJECT_NAME:-supabase-bb}"

KONG_HTTP_PORT="${KONG_HTTP_PORT:-54325}"
KONG_HTTPS_PORT="${KONG_HTTPS_PORT:-8445}"
STUDIO_PORT="${STUDIO_PORT:-3101}"
POOLER_DB_PORT="${POOLER_DB_PORT:-5435}"
POOLER_TX_PORT="${POOLER_TX_PORT:-6545}"

pick_source_dir() {
  if [[ -n "${SOURCE_DIR}" && -d "${SOURCE_DIR}" ]]; then
    echo "${SOURCE_DIR}"
    return
  fi
  local candidates=(
    "/home/vladx/supabase-project"
    "/home/vladx/supabase"
    "/opt/supabase"
  )
  for d in "${candidates[@]}"; do
    if [[ -d "${d}" ]]; then
      echo "${d}"
      return
    fi
  done
  echo ""
}

echo "==> Поиск исходного Supabase каталога..."
SRC="$(pick_source_dir)"
if [[ -z "${SRC}" ]]; then
  echo "ERROR: Не найден исходный каталог Supabase. Укажите SOURCE_DIR=/path/to/current/supabase"
  exit 1
fi
echo "SOURCE_DIR=${SRC}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker не установлен."
  exit 1
fi

echo "==> Создание изолированной сети ${NETWORK_NAME} (если нет)..."
docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1 || docker network create "${NETWORK_NAME}"

if [[ -d "${TARGET_DIR}" ]]; then
  echo "==> TARGET_DIR уже существует: ${TARGET_DIR}"
else
  echo "==> Копирование Supabase проекта в ${TARGET_DIR} ..."
  cp -a "${SRC}" "${TARGET_DIR}"
fi

cd "${TARGET_DIR}"

resolve_compose_dir() {
  local base="$1"
  if [[ -f "${base}/docker-compose.yml" ]]; then
    echo "${base}"
    return
  fi
  if [[ -f "${base}/docker/docker-compose.yml" ]]; then
    echo "${base}/docker"
    return
  fi
  if [[ -f "${base}/docker-compose.supabase.yml" ]]; then
    # Нормализуем имя, чтобы docker compose мог использовать стандартный файл.
    cp -f "${base}/docker-compose.supabase.yml" "${base}/docker-compose.yml"
    echo "${base}"
    return
  fi
  echo ""
}

COMPOSE_DIR="$(resolve_compose_dir "${TARGET_DIR}")"
if [[ -z "${COMPOSE_DIR}" ]]; then
  echo "ERROR: В ${TARGET_DIR} (и ${TARGET_DIR}/docker) не найден docker-compose.yml"
  echo "Подсказка: задайте SOURCE_DIR на каталог, где реально лежит compose текущего Supabase."
  exit 1
fi
echo "==> Compose directory: ${COMPOSE_DIR}"
cd "${COMPOSE_DIR}"

echo "==> Создание/обновление .env.local-bb ..."
cat > .env.local-bb <<EOF
COMPOSE_PROJECT_NAME=${PROJECT_NAME}
BB_SUPABASE_NETWORK=${NETWORK_NAME}
BB_KONG_HTTP_PORT=${KONG_HTTP_PORT}
BB_KONG_HTTPS_PORT=${KONG_HTTPS_PORT}
BB_STUDIO_PORT=${STUDIO_PORT}
BB_POOLER_DB_PORT=${POOLER_DB_PORT}
BB_POOLER_TX_PORT=${POOLER_TX_PORT}
EOF

echo "==> Создание override compose ..."
cat > docker-compose.bookmarks-bro.override.yml <<'EOF'
services:
  kong:
    ports:
      - "${BB_KONG_HTTP_PORT:-54325}:8000"
      - "${BB_KONG_HTTPS_PORT:-8445}:8443"
    networks:
      - default
      - bb_supabase_net

  studio:
    ports:
      - "127.0.0.1:${BB_STUDIO_PORT:-3101}:3000"
    networks:
      - default
      - bb_supabase_net

  pooler:
    ports:
      - "${BB_POOLER_DB_PORT:-5435}:5432"
      - "${BB_POOLER_TX_PORT:-6545}:6543"
    networks:
      - default
      - bb_supabase_net

  auth:
    networks:
      - default
      - bb_supabase_net

  rest:
    networks:
      - default
      - bb_supabase_net

  storage:
    networks:
      - default
      - bb_supabase_net

  meta:
    networks:
      - default
      - bb_supabase_net

  db:
    networks:
      - default
      - bb_supabase_net

networks:
  bb_supabase_net:
    name: ${BB_SUPABASE_NETWORK:-bookmarks_bro_supabase_net}
    external: true
EOF

compose_up_bb() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file .env.local-bb -f docker-compose.yml -f docker-compose.bookmarks-bro.override.yml up -d
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    # legacy docker-compose: без флага --env-file — подтягиваем переменные в окружение
    set -a
    # shellcheck disable=SC1091
    source .env.local-bb
    set +a
    docker-compose -f docker-compose.yml -f docker-compose.bookmarks-bro.override.yml up -d
    return
  fi
  echo "ERROR: Нужен «docker compose» или docker-compose."
  exit 1
}

echo "==> Поднимаем отдельный Supabase стек..."
compose_up_bb

echo "==> Готово."
echo "Проверка:"
echo "  docker ps --filter name=${PROJECT_NAME}"
echo "  curl -sS http://127.0.0.1:${KONG_HTTP_PORT}/auth/v1/health | cat"
echo "  docker inspect ${PROJECT_NAME}-db --format '{{.Name}}' 2>/dev/null || true"
echo ""
echo "Studio (через SSH туннель): http://127.0.0.1:${STUDIO_PORT}"
echo "Kong endpoint: http://127.0.0.1:${KONG_HTTP_PORT}"

