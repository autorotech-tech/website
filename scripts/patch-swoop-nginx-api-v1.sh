#!/usr/bin/env bash
# Ensure autoro-frontend nginx resolves autoro-agent-api via Docker DNS (avoids sticky 502 after container recreate).
set -euo pipefail

CONTAINER="${CONTAINER:-autoro-frontend}"
CONF="${NGINX_CONF:-/etc/nginx/conf.d/default.conf}"

if ! docker ps --filter "name=^/${CONTAINER}$" --filter status=running -q | grep -q .; then
  echo "patch-swoop-nginx-api-v1: $CONTAINER not running — skip"
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

docker cp "$CONTAINER:$CONF" "$TMP"

python3 - "$TMP" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
new_block = """    location ^~ /api/v1/ {
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $agent_api_upstream autoro-agent-api:8900;
        proxy_pass http://$agent_api_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
"""
pattern = re.compile(
    r"    location \^~ /api/v1/ \{.*?\n    \}\n",
    re.DOTALL,
)
text2, n = pattern.subn(new_block, text, count=1)
if n != 1:
    sys.stderr.write("patch-swoop-nginx-api-v1: /api/v1/ block not found or ambiguous\n")
    sys.exit(1)
if "resolver 127.0.0.11" not in text2:
    sys.stderr.write("patch-swoop-nginx-api-v1: patch did not apply\n")
    sys.exit(1)
path.write_text(text2)
PY

docker cp "$TMP" "$CONTAINER:$CONF"
docker exec "$CONTAINER" nginx -t
docker exec "$CONTAINER" nginx -s reload
echo "patch-swoop-nginx-api-v1: reloaded $CONTAINER ($CONF)"
