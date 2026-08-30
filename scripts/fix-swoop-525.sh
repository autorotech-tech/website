#!/usr/bin/env bash
# Cloudflare 525 на swoop.autoro.tech — Apache на хосте занял :80/:443, nginx-proxy не поднялся.
# Запуск на VPS (нужен sudo для systemctl):
#   bash scripts/fix-swoop-525.sh
set -euo pipefail

say() { printf '\n=== %s ===\n' "$*"; }

say "apache / nginx-proxy status"
systemctl is-active apache2 2>/dev/null || true
docker ps -a --filter name=nginx-proxy --format '{{.Names}} {{.Status}}' || true

if systemctl is-active apache2 >/dev/null 2>&1; then
  say "stop host Apache (frees :80 :443 for nginx-proxy)"
  sudo systemctl stop apache2
  sudo systemctl disable apache2
fi

say "start nginx-proxy stack"
docker start nginx-proxy
sleep 3
docker ps --filter name=nginx-proxy --format '{{.Names}} {{.Status}} {{.Ports}}'

if ! docker ps --filter name=nginx-proxy --filter status=running -q | grep -q .; then
  echo "nginx-proxy failed to start — logs:"
  docker logs nginx-proxy --tail 30
  exit 1
fi

say "local checks"
curl -sS -m 8 -o /dev/null -w 'swoop http %{http_code}\n' http://127.0.0.1/ -H 'Host: swoop.autoro.tech' || true
curl -sS -m 8 -o /dev/null -w 'swoop https %{http_code}\n' -k https://127.0.0.1/ -H 'Host: swoop.autoro.tech' || true

say "done — refresh https://swoop.autoro.tech/admin/settings (CF 525 should clear in ~1 min)"
