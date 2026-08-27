#!/bin/bash
HOST="vladx@46.250.228.229"
SSH_KEY="~/.ssh/id_ed25519_autoro"

echo "Deploying Autoro.tech Website Config..."

# Copy files
scp -o StrictHostKeyChecking=no -i $SSH_KEY autoro-tech-docker-compose.yml $HOST:/home/vladx/autoro.tech/docker-compose.yml
scp -o StrictHostKeyChecking=no -i $SSH_KEY autoro-tech-nginx.conf $HOST:/home/vladx/autoro.tech/nginx.conf

# Start Container
echo "Starting Autoro Website Container..."
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $HOST "cd /home/vladx/autoro.tech && docker-compose up -d"

echo "Deployed. Waiting for SSL generation..."
