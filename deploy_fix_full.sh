#!/bin/bash
HOST="vladx@46.250.228.229"
SSH_KEY="~/.ssh/id_ed25519_autoro"

echo "Deploying Single Post Fix and Rebuilding All..."

# Copy backend route (Single Post SQL Fix)
scp -o StrictHostKeyChecking=no -i $SSH_KEY blog-autoro/app/api/admin/posts/\[id\]/route.ts $HOST:/home/vladx/projects/autoro.tech/website/blog-autoro/app/api/admin/posts/\[id\]/route.ts

# Rebuild Frontend (to apply nginx.conf CSP changes)
echo "Rebuilding Frontend (for CSP fix)..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "mkdir -p /home/vladx/projects && if [ -d /home/vladx/autoro-dashboard ] && [ ! -d /home/vladx/projects/autoro-dashboard ]; then mv /home/vladx/autoro-dashboard /home/vladx/projects/autoro-dashboard; fi && cd /home/vladx/projects/autoro-dashboard && docker-compose build frontend && docker-compose up -d frontend"

# Rebuild Backend (to apply single post fix)
echo "Rebuilding Backend..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "mkdir -p /home/vladx/projects/autoro.tech/website && if [ -d /home/vladx/autoro-blog ] && [ ! -d /home/vladx/projects/autoro.tech/website/blog-autoro ]; then mv /home/vladx/autoro-blog /home/vladx/projects/autoro.tech/website/blog-autoro; fi && cd /home/vladx/projects/autoro.tech/website/blog-autoro && docker-compose build blog && docker-compose up -d blog"

echo "Full deployment complete."
