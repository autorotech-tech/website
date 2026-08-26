#!/bin/bash
HOST="vladx@46.250.228.229"
SSH_KEY="~/.ssh/id_ed25519_autoro"

echo "Deploying Upload Route Fix..."

# Copy upload/route.ts
scp -o StrictHostKeyChecking=no -i $SSH_KEY blog-autoro/app/api/admin/upload/route.ts $HOST:/home/vladx/autoro-blog/app/api/admin/upload/route.ts

# Rebuild Backend
echo "Rebuilding Backend..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "cd /home/vladx/autoro-blog && docker-compose build blog && docker-compose up -d blog"

echo "Upload Route Fix Deployed."
