#!/bin/bash
# Скрипт для проверки блога и API на сервере

echo "=== 1. Проверка структуры блога ==="
ls -la /home/vladx/autoro-blog/app/api/admin/ 2>/dev/null || echo "Папка не найдена"

echo ""
echo "=== 2. Проверка API route для постов ==="
if [ -f "/home/vladx/autoro-blog/app/api/admin/posts/route.ts" ]; then
    echo "Файл найден:"
    cat /home/vladx/autoro-blog/app/api/admin/posts/route.ts | grep -A 10 "where\|status\|published\|eq" | head -30
else
    echo "Файл НЕ найден!"
    echo "Ищем в других местах:"
    find /home/vladx -name "*posts*route.ts" 2>/dev/null | head -5
fi

echo ""
echo "=== 3. Статус контейнера блога ==="
docker ps | grep blog || echo "Контейнер блога не запущен"

echo ""
echo "=== 4. Логи блога (последние 20 строк) ==="
docker logs autoro-blog-nextjs --tail 20 2>&1 | tail -20

echo ""
echo "=== 5. Проверка API (без токена - должно быть 401) ==="
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"

echo ""
echo "=== 6. Проверка через localhost (прямое подключение) ==="
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" -H "Host: cdn.autoro.tech" "http://localhost/api/blog/admin/posts?page=1&limit=20"

echo ""
echo "=== 7. Проверка структуры docker-compose ==="
if [ -f "/home/vladx/autoro-blog/docker-compose.yml" ]; then
    echo "docker-compose.yml найден"
    cat /home/vladx/autoro-blog/docker-compose.yml | grep -E "container_name|ports|volumes" | head -10
else
    echo "docker-compose.yml не найден"
fi

echo ""
echo "=== Готово ==="

