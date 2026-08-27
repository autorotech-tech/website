#!/bin/bash
# Deploy blog.html + blog-post.html to autoro.tech
# Run from: website/

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REMOTE="vladx@46.250.228.229"
echo "📤 Deploying blog static (blog.html, blog-post.html)..."

# Copy to server tmp, then into nginx container
scp -i ~/.ssh/id_ed25519_autoro blog.html blog-post.html $REMOTE:/tmp/

ssh -i ~/.ssh/id_ed25519_autoro $REMOTE 'bash -s' << 'END'
for c in autoro-site nginx-proxy; do
  if docker cp /tmp/blog.html $c:/usr/share/nginx/html/blog.html 2>/dev/null; then
    docker cp /tmp/blog-post.html $c:/usr/share/nginx/html/blog-post.html 2>/dev/null || true
    echo "Copied to $c"
    break
  fi
done
rm -f /tmp/blog.html /tmp/blog-post.html
END

echo "✅ Done! Check https://autoro.tech/en/blog — dark theme, cards, mesh gradient."
