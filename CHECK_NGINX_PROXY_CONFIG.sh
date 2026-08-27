#!/bin/bash
# Проверка конфигурации nginx-proxy

echo "=== 1. Контейнеры с autoro.tech ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps --filter 'name=autoro' --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"

echo ""
echo "=== 2. Структура /etc/nginx в nginx-proxy ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker exec nginx-proxy ls -la /etc/nginx/ 2>&1"

echo ""
echo "=== 3. Конфигурации nginx-proxy ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker exec nginx-proxy ls -la /etc/nginx/conf.d/ 2>&1"

echo ""
echo "=== 4. Vhost конфигурации ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker exec nginx-proxy ls -la /etc/nginx/vhost.d/ 2>&1"

echo ""
echo "=== 5. Найти конфиг для autoro.tech ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker exec nginx-proxy find /etc/nginx -name '*autoro*' -type f 2>&1"

echo ""
echo "=== 6. Переменные окружения контейнеров ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps --format '{{.Names}}' | head -5 | xargs -I {} docker inspect {} | grep -A 5 'VIRTUAL_HOST' | head -20"

