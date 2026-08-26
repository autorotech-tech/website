#!/bin/bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 bash << 'ENDSSH'
cd /home/vladx/autoro-blog
echo "=== Проверка контейнеров ==="
docker ps -a | grep -E 'blog|nextjs'
echo ""
echo "=== Проверка docker-compose ==="
if [ -f docker-compose.yml ]; then
    echo "docker-compose.yml найден, запускаю..."
    docker-compose up -d
    sleep 3
    echo ""
    echo "=== Статус контейнеров ==="
    docker ps | grep -E 'blog|nextjs'
    echo ""
    echo "=== Логи (последние 20 строк) ==="
    docker-compose logs --tail 20 2>&1 | tail -20
else
    echo "docker-compose.yml не найден!"
fi
ENDSSH

