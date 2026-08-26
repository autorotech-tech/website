#!/bin/bash
# Тест блога напрямую и через Nginx

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'EOF'

echo "=== 1. Статус контейнеров ==="
docker ps | grep blog

echo ""
echo "=== 2. Тест блога напрямую (localhost:3002) ==="
curl -X GET "http://localhost:3002/api/admin/posts?page=1&limit=20" \
  -H "Authorization: Bearer test123" \
  -s -w "\nHTTP: %{http_code}\n"

echo ""
echo "=== 3. Тест OPTIONS блога ==="
curl -X OPTIONS "http://localhost:3002/api/admin/posts" \
  -H "Origin: https://swoop.autoro.tech" \
  -H "Access-Control-Request-Method: GET" \
  -s -w "\nHTTP: %{http_code}\n" | head -5

echo ""
echo "=== 4. Тест через Nginx (localhost/api/blog) ==="
curl -X GET "http://localhost/api/blog/admin/posts?page=1&limit=20" \
  -H "Host: cdn.autoro.tech" \
  -H "Authorization: Bearer test123" \
  -s -w "\nHTTP: %{http_code}\n"

echo ""
echo "=== 5. Проверка Nginx конфигурации ==="
cat /home/vladx/projects/autoro.tech/html/default.conf | grep -A 20 "/api/blog/"

echo ""
echo "=== 6. Логи блога (последние ошибки) ==="
docker logs autoro-blog-nextjs --tail 50 | grep -i error | tail -5

EOF

