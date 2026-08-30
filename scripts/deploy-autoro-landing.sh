#!/usr/bin/env bash
# Deploy autoro.tech: restore original index + Swoop service cards (3 per row).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
REMOTE_HTML="${REMOTE_HTML_DIR:-/home/vladx/projects/autoro.tech/html}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60 -o ServerAliveInterval=15 -o BatchMode=yes)

echo "=== 1. Validate catalog JSON ==="
python3 -c "import json; json.load(open('$ROOT/landing/services-catalog.json'))"

echo "=== 2. Patch original index (EN + RU) ==="
export AUTORO_SITE_BOT_ID="${AUTORO_SITE_BOT_ID:-}"
python3 "$ROOT/scripts/patch-swoop-services-index.py"
python3 "$ROOT/scripts/patch-swoop-services-index.py" --ru

echo "=== 3. Pack deploy bundle ==="
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/js" "$STAGE/ru" "$STAGE/assets/js" "$STAGE/resume"
cp "$ROOT/landing/index.html" "$STAGE/index.html"
cp "$ROOT/landing/services-catalog.json" "$STAGE/services-catalog.json"
cp "$ROOT/landing/googlefd098efab7e57a6b.html" "$STAGE/googlefd098efab7e57a6b.html"
cp "$ROOT/landing/BingSiteAuth.xml" "$STAGE/BingSiteAuth.xml"
cp "$ROOT/landing/js/render-services.js" "$STAGE/js/render-services.js"
cp "$ROOT/ru/index.html" "$STAGE/ru/index.html"
cp "$ROOT/resume/index.html" "$STAGE/resume/index.html"
cp "$ROOT/old_site_backup/html/assets/js/chat.js" "$STAGE/assets/js/chat.js"
cp "$ROOT/old_site_backup/html/assets/js/chat-config.js" "$STAGE/assets/js/chat-config.js"

tar czf /tmp/autoro-landing.tgz -C "$STAGE" index.html services-catalog.json googlefd098efab7e57a6b.html BingSiteAuth.xml js ru resume assets

echo "=== 4. Upload & extract ==="
scp "${SSH_OPTS[@]}" /tmp/autoro-landing.tgz "$REMOTE:/tmp/autoro-landing.tgz"

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<REMOTE
set -euo pipefail
HTML="$REMOTE_HTML"
mkdir -p "\$HTML/js" "\$HTML/ru" "\$HTML/assets/js" "\$HTML/resume"
# backup current index once
[ -f "\$HTML/index.html" ] && cp "\$HTML/index.html" "\$HTML/index.html.bak_\$(date +%Y%m%d%H%M)" || true
tar xzf /tmp/autoro-landing.tgz -C "\$HTML"
rm -f /tmp/autoro-landing.tgz
chmod 755 "\$HTML"
find "\$HTML/js" "\$HTML/ru" "\$HTML/assets" "\$HTML/resume" -type d -exec chmod 755 {} + 2>/dev/null || true
find "\$HTML/js" "\$HTML/ru" "\$HTML/assets" "\$HTML/resume" -type f -exec chmod 644 {} + 2>/dev/null || true
chmod 644 "\$HTML/index.html" "\$HTML/services-catalog.json" "\$HTML/googlefd098efab7e57a6b.html" "\$HTML/BingSiteAuth.xml" "\$HTML/ru/index.html" "\$HTML/resume/index.html" "\$HTML/assets/js/chat.js" "\$HTML/assets/js/chat-config.js" 2>/dev/null || true
ls -la "\$HTML/index.html" "\$HTML/services-catalog.json" "\$HTML/js/render-services.js" "\$HTML/resume/index.html" "\$HTML/assets/js/chat.js" "\$HTML/assets/js/chat-config.js"
REMOTE

echo "=== 5. Smoke check ==="
for url in "https://autoro.tech/" "https://autoro.tech/services-catalog.json" "https://autoro.tech/googlefd098efab7e57a6b.html" "https://autoro.tech/BingSiteAuth.xml" "https://autoro.tech/ru/" "https://autoro.tech/resume/" "https://autoro.tech/resume/?lang=ru"; do
  code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$url" || echo 000)
  echo "$url → HTTP $code"
done
curl -sS -m 15 "https://autoro.tech/resume/" | grep -q 'Vladislav' && echo "resume EN name: OK" || echo "WARN: resume name missing"
curl -sS -m 15 "https://autoro.tech/resume/" | grep -qiE 'Kholodin|Холодин' && echo "WARN: surname leaked on resume page" || echo "resume surname-free: OK"
curl -sS https://autoro.tech/ | grep -q 'autoro-services-catalog' && echo "inline catalog: OK" || echo "WARN: inline catalog missing"
curl -sS https://autoro.tech/ | grep -q 'Marketing Audit' && echo "cards rendered in HTML or catalog: OK" || true
curl -sS https://autoro.tech/ | grep -q 'lg:grid-cols-3' && echo "3-col grid: OK" || echo "WARN: grid class missing"

echo "=== Done ==="
