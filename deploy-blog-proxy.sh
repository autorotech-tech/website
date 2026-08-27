#!/bin/bash
# Deploy nginx config with blog proxy to Next.js
# Run from: website/

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REMOTE="vladx@46.250.228.229"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"

echo "📤 Deploying nginx config (blog proxy to Next.js)..."

# Copy nginx configs
scp -i "$SSH_KEY" nginx.conf "$REMOTE:/tmp/nginx.conf"
scp -i "$SSH_KEY" autoro-tech-nginx.conf "$REMOTE:/tmp/autoro-tech-nginx.conf"

ssh -i "$SSH_KEY" "$REMOTE" 'bash -s' << 'END'
# Try common locations - adjust paths if your server layout differs
for base in /home/vladx/projects/autoro-dashboard /home/vladx/projects/autoro.tech /home/vladx/projects/autoro.tech/website; do
  if [ -d "$base" ]; then
    cp /tmp/nginx.conf "$base/nginx.conf" 2>/dev/null && echo "Updated $base/nginx.conf" || true
    cp /tmp/autoro-tech-nginx.conf "$base/autoro-tech-nginx.conf" 2>/dev/null && echo "Updated $base/autoro-tech-nginx.conf" || true
  fi
done

# Restart nginx containers to apply config
for c in autoro-site autoro-website nginx-proxy; do
  if docker ps -q -f name="$c" 2>/dev/null | head -1; then
    docker restart "$c" 2>/dev/null && echo "Restarted $c" || true
  fi
done

rm -f /tmp/nginx.conf /tmp/autoro-tech-nginx.conf
END

echo "✅ Done! Check https://autoro.tech/en/blog — should now show Next.js (AstroPaper) layout."
echo "   Ensure autoro-blog-nextjs container is running: docker ps | grep autoro-blog"
