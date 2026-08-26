#!/bin/bash
# Диагностика 503 и тестирование API

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 bash << 'ENDSSH'

echo "=== 1. Проверка контейнеров ==="
docker ps | grep -E 'blog|nextjs'

echo ""
echo "=== 2. Проверка что блог отвечает напрямую ==="
curl -X GET "http://localhost:3002/api/admin/posts?page=1&limit=20" \
  -H "Authorization: Bearer test" \
  -s -o /dev/null -w "HTTP Status: %{http_code}\n"

echo ""
echo "=== 3. Проверка OPTIONS через localhost ==="
curl -X OPTIONS "http://localhost:3002/api/admin/posts?page=1&limit=20" \
  -H "Origin: https://swoop.autoro.tech" \
  -H "Access-Control-Request-Method: GET" \
  -s -o /dev/null -w "HTTP Status: %{http_code}\n"

echo ""
echo "=== 4. Проверка через Nginx (с Host header) ==="
curl -X GET "http://localhost/api/blog/admin/posts?page=1&limit=20" \
  -H "Host: cdn.autoro.tech" \
  -H "Authorization: Bearer test" \
  -s -o /dev/null -w "HTTP Status: %{http_code}\n"

echo ""
echo "=== 5. Проверка Nginx конфигурации ==="
grep -A 15 "location /api/blog/" /home/vladx/projects/autoro.tech/html/default.conf | head -20

echo ""
echo "=== 6. Проверка логов Nginx ==="
docker logs autoro-site --tail 20 | grep -i "error\|503" | tail -10

echo ""
echo "=== 7. Проверка логов блога ==="
docker logs autoro-blog-nextjs --tail 30 | grep -i "error\|ready" | tail -10

ENDSSH

