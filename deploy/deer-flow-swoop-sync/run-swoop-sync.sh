#!/usr/bin/env bash
# Синхронизация ключей из Postgres (service_settings) в DeerFlow: .env, config.yaml,
# затем мягкое обновление gateway/langgraph (docker-compose / docker compose up -d).
set -euo pipefail

DEER_ROOT="${DEER_FLOW_ROOT:-${HOME}/autoro-dashboard/projects/deer-flow}"
cd "$DEER_ROOT"

if [[ -f compose.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source compose.env
  set +a
fi

/usr/bin/python3 "$DEER_ROOT/sync_swoop_models.py"

export DOCKER_BUILDKIT=1
# На сервере часто установлен docker-compose (v1); при наличии v2 подойдёт и «docker compose».
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose --env-file compose.env -p deer-flow -f docker/docker-compose.yaml up -d gateway langgraph
else
  docker compose --env-file compose.env -p deer-flow -f docker/docker-compose.yaml up -d gateway langgraph
fi
