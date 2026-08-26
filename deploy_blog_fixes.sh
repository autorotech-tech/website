#!/bin/bash
HOST="vladx@46.250.228.229"
SSH_KEY="~/.ssh/id_ed25519_autoro"

echo "Deploying fixes to $HOST..."

# Copy backend route (SQL Fix)
scp -o StrictHostKeyChecking=no -i $SSH_KEY blog-autoro/app/api/admin/posts/route.ts $HOST:/home/vladx/projects/autoro.tech/website/blog-autoro/app/api/admin/posts/route.ts

# Copy nginx config (CSP Fix)
scp -o StrictHostKeyChecking=no -i $SSH_KEY nginx.conf $HOST:/home/vladx/projects/autoro-dashboard/nginx.conf

# Restart services
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "mkdir -p /home/vladx/projects/autoro.tech/website && if [ -d /home/vladx/autoro-blog ] && [ ! -d /home/vladx/projects/autoro.tech/website/blog-autoro ]; then mv /home/vladx/autoro-blog /home/vladx/projects/autoro.tech/website/blog-autoro; fi && cd /home/vladx/projects/autoro.tech/website/blog-autoro && docker-compose restart blog"
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "mkdir -p /home/vladx/projects && if [ -d /home/vladx/autoro-dashboard ] && [ ! -d /home/vladx/projects/autoro-dashboard ]; then mv /home/vladx/autoro-dashboard /home/vladx/projects/autoro-dashboard; fi && cd /home/vladx/projects/autoro-dashboard && docker-compose restart frontend" # Assuming frontend service name

echo "Deployment complete."
