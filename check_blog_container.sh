#!/bin/bash
# Проверить структуру блога на сервере

echo "=== 1. Проверка docker-compose.yml ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "cat /home/vladx/autoro-blog/docker-compose.yml | grep -A 5 'services:'"

echo ""
echo "=== 2. Проверка запущенных контейнеров ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps | grep blog"

echo ""
echo "=== 3. Проверка всех контейнеров (включая остановленные) ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps -a | grep blog"

echo ""
echo "=== 4. Проверка структуры файлов ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "ls -la /home/vladx/autoro-blog/app/api/admin/posts/ && echo '---' && ls -la /home/vladx/autoro-blog/lib/supabase/ && echo '---' && ls -la /home/vladx/autoro-blog/lib/cors.ts"

