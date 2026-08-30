#!/bin/bash
# Тест API блога

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 bash << 'ENDSSH'

echo "=== 1. Проверка OPTIONS запроса ==="
curl -X OPTIONS http://localhost:3002/api/admin/posts \
  -H "Origin: https://swoop.autoro.tech" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  -v 2>&1 | grep -E "HTTP|Access-Control|204|200"

echo ""
echo "=== 2. Проверка GET запроса (без токена - должен быть 401) ==="
curl -X GET "http://localhost:3002/api/admin/posts?page=1&limit=20" \
  -H "Origin: https://swoop.autoro.tech" \
  -v 2>&1 | grep -E "HTTP|Access-Control|401"

echo ""
echo "=== 3. Проверка через Nginx (с Host header) ==="
curl -X OPTIONS "http://localhost/api/blog/admin/posts?page=1&limit=20" \
  -H "Host: cdn.autoro.tech" \
  -H "Origin: https://swoop.autoro.tech" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  -v 2>&1 | grep -E "HTTP|Access-Control|204|503|502"

echo ""
echo "=== 4. Проверка логов блога на ошибки ==="
docker logs autoro-blog-nextjs --tail 50 | grep -i "error\|fail" | tail -10

ENDSSH

