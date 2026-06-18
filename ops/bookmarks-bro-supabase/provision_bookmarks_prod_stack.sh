#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="${SRC_DIR:-/home/vladx/supabase/docker}"
DST_DIR="${DST_DIR:-/home/vladx/supabase-bookmarks-prod/docker}"
PROJECT_NAME="${PROJECT_NAME:-supabase-bookmarks}"

mkdir -p "${DST_DIR}"
rsync -a --delete \
  --exclude 'volumes/db/data/' \
  --exclude 'volumes/db/data/**' \
  "${SRC_DIR}/" "${DST_DIR}/"
cd "${DST_DIR}"

cp -f docker-compose.yml docker-compose.bookmarks.yml

# Unique container names for dedicated stack
sed -E -i 's/^([[:space:]]*container_name:[[:space:]]*"?)([a-zA-Z0-9._-]+)("?[[:space:]]*)$/\1\2-bookmarks\3/' docker-compose.bookmarks.yml

# Shift host ports to avoid conflicts with existing stacks
sed -i 's/"54321:8000"/"54335:8000"/g' docker-compose.bookmarks.yml || true
sed -i 's/"8443:8443"/"8447:8443"/g' docker-compose.bookmarks.yml || true
sed -i 's/"127.0.0.1:3002:3000"/"127.0.0.1:3202:3000"/g' docker-compose.bookmarks.yml || true
sed -i 's/"5433:5432"/"5445:5432"/g' docker-compose.bookmarks.yml || true
sed -i 's/"6543:6543"/"6645:6543"/g' docker-compose.bookmarks.yml || true
sed -i 's/"4001:4000"/"4011:4000"/g' docker-compose.bookmarks.yml || true
sed -i 's/"8002:4000"/"8012:4000"/g' docker-compose.bookmarks.yml || true
sed -i 's/"9003:9000"/"9013:9000"/g' docker-compose.bookmarks.yml || true

cp -f .env .env.bookmarks
sed -i 's/^POSTGRES_PORT=.*/POSTGRES_PORT=5445/' .env.bookmarks
sed -i 's/^KONG_HTTP_PORT=.*/KONG_HTTP_PORT=54335/' .env.bookmarks
sed -i 's/^KONG_HTTPS_PORT=.*/KONG_HTTPS_PORT=8447/' .env.bookmarks
sed -i 's/^POOLER_PROXY_PORT_TRANSACTION=.*/POOLER_PROXY_PORT_TRANSACTION=6645/' .env.bookmarks
sed -i 's|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://swoop.autoro.tech/bb-supabase|' .env.bookmarks
sed -i 's|^SITE_URL=.*|SITE_URL=https://swoop.autoro.tech|' .env.bookmarks
sed -i 's|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=https://swoop.autoro.tech/bb-supabase|' .env.bookmarks

docker-compose --env-file .env.bookmarks -f docker-compose.bookmarks.yml config >/tmp/bookmarks-supabase-config.yml
docker-compose --env-file .env.bookmarks -p "${PROJECT_NAME}" -f docker-compose.bookmarks.yml up -d

echo "=== ${PROJECT_NAME} containers ==="
docker ps --filter "name=bookmarks" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo "=== health endpoint ==="
curl -sS http://127.0.0.1:54335/auth/v1/health || true
