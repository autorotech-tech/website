#!/usr/bin/env bash
# 502 на swoop.autoro.tech — поднять autoro-frontend без полного docker-compose (kong в compose ломает up).
set -euo pipefail

IMAGE="${FRONTEND_IMAGE:-autoro-dashboard-frontend:latest}"
SUPABASE_NET="${SUPABASE_NET:-supabase_default}"
BRIDGE_NET="${BRIDGE_NET:-vladx_anythingllm-n8n-bridge}"
PROJECT_NET="${PROJECT_NET:-autoro-dashboard_default}"

echo "=== fix-swoop-502 (direct docker) ==="

docker rm -f autoro-frontend 2>/dev/null || true

docker create --name autoro-frontend \
  --network proxy \
  --restart unless-stopped \
  -e VIRTUAL_HOST=swoop.autoro.tech \
  -e LETSENCRYPT_HOST=swoop.autoro.tech \
  -e LETSENCRYPT_EMAIL=tech@autoro.tech \
  "$IMAGE"

for net in "$PROJECT_NET" "$BRIDGE_NET" "$SUPABASE_NET"; do
  if docker network inspect "$net" >/dev/null 2>&1; then
    docker network connect "$net" autoro-frontend 2>/dev/null || true
    echo "connected: $net"
  else
    echo "skip missing network: $net"
  fi
done

docker start autoro-frontend
sleep 8

if ! docker ps --filter name=autoro-frontend --filter status=running -q | grep -q .; then
  echo "FAILED — nginx logs:"
  docker logs autoro-frontend --tail 25
  exit 1
fi

code=$(curl -sS -m 12 -o /dev/null -w '%{http_code}' http://127.0.0.1/ -H 'Host: swoop.autoro.tech' || echo 000)
echo "swoop local: HTTP $code"
docker logs autoro-frontend --tail 4
