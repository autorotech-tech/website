#!/usr/bin/env bash
# Deploy Merchant Inspector plugin folder to a WordPress plugins directory (e.g. compod.us).
#
# Usage:
#   ./scripts/deploy-merchant-inspector.sh /path/to/wp-content/plugins/merchant-inspector
#
# Or set destination via env:
#   export MI_DEPLOY_DEST="$HOME/projects/compod.us/wp-content/plugins/merchant-inspector"
#   ./scripts/deploy-merchant-inspector.sh
#
# Remote (example):
#   rsync -avz --delete \
#     "$(dirname "$0")/../wp-plugins/merchant-inspector/" \
#     user@compod.us:/home/.../wp-content/plugins/merchant-inspector/
#
# compod.us on VPS (plugins dir www-data): use Docker instead of rsync to host path:
#   cd "$(dirname "$0")/../wp-plugins"
#   COPYFILE_DISABLE=1 tar czf - merchant-inspector | ssh -i ~/.ssh/id_ed25519_autoro vladx@HOST \
#     'docker exec -i -u root compod-wordpress bash -lc "rm -rf /var/www/html/wp-content/plugins/merchant-inspector && tar xz -C /var/www/html/wp-content/plugins && chown -R www-data:www-data /var/www/html/wp-content/plugins/merchant-inspector"'
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/wp-plugins/merchant-inspector"
DEST="${1:-${MI_DEPLOY_DEST:-}}"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC" >&2
  exit 1
fi

if [[ -z "$DEST" ]]; then
  echo "Usage: $0 /path/to/wp-content/plugins/merchant-inspector" >&2
  echo "   or: MI_DEPLOY_DEST=/that/path $0" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  "$SRC/" "$DEST/"

echo "OK: synced Merchant Inspector -> $DEST"
echo "Tip: hard-refresh WP admin (Ctrl+F5). If Opcache/cache plugin — purge cache or restart PHP-FPM/Docker."
