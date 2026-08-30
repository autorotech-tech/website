#!/bin/bash
HOST="vladx@46.250.228.229"
SSH_KEY="~/.ssh/id_ed25519_autoro"

echo "Deploying CORS Fix (lib/cors.ts)..."

# Copy lib/cors.ts
scp -o StrictHostKeyChecking=no -i $SSH_KEY blog-autoro/lib/cors.ts $HOST:/home/vladx/autoro-blog/lib/cors.ts

# Rebuild Backend
echo "Rebuilding Backend..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "cd /home/vladx/autoro-blog && docker-compose build blog && docker-compose up -d blog"

echo "CORS Fix Deployed."
