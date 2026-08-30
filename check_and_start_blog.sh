#!/bin/bash
# Скрипт для проверки и запуска блога

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'EOF'

echo "=== 1. Проверка контейнеров блога ==="
docker ps -a | grep -E 'blog|nextjs' || echo "Контейнеры блога не найдены"

echo ""
echo "=== 2. Проверка docker-compose.yml ==="
cd /home/vladx/autoro-blog
if [ -f "docker-compose.yml" ]; then
    echo "docker-compose.yml найден"
    echo "Сервисы:"
    grep -A 20 "services:" docker-compose.yml | grep -E "^  [a-z]" | head -5
else
    echo "docker-compose.yml НЕ найден!"
fi

echo ""
echo "=== 3. Проверка .env файла ==="
if [ -f ".env" ]; then
    echo ".env найден"
else
    echo ".env НЕ найден!"
fi

echo ""
echo "=== 4. Попытка запуска блога ==="
if [ -f "docker-compose.yml" ]; then
    echo "Запускаю docker-compose up -d..."
    docker-compose up -d
    
    echo ""
    echo "=== 5. Проверка запущенных контейнеров ==="
    sleep 3
    docker ps | grep -E 'blog|nextjs'
    
    echo ""
    echo "=== 6. Проверка логов ==="
    docker-compose logs --tail 20 2>&1 | tail -20
else
    echo "Не могу запустить - docker-compose.yml не найден"
fi

EOF

