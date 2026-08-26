#!/bin/bash
HOST="vladx@46.250.228.229"
SSH_KEY="~/.ssh/id_ed25519_autoro"

echo "Rebuilding blog container on $HOST..."

ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "mkdir -p /home/vladx/autoro-blog"
rsync -avz -e "ssh -i $SSH_KEY" --exclude 'node_modules' --exclude '.next' --exclude '.git' ./blog-autoro/ $HOST:/home/vladx/autoro-blog/

ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "cd /home/vladx/autoro-blog && docker-compose build blog && docker-compose up -d --force-recreate blog"

echo "Rebuild complete."
