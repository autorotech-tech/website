#!/bin/bash
# Проверка доступности блога из Nginx контейнера

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'EOF'

echo "=== 1. Проверка что блог отвечает на localhost ==="
curl -s -o /dev/null -w "localhost:3002 - HTTP: %{http_code}\n" http://localhost:3002/api/admin/posts

echo ""
echo "=== 2. Проверка что блог отвечает на Docker bridge IP ==="
curl -s -o /dev/null -w "172.17.0.1:3002 - HTTP: %{http_code}\n" http://172.17.0.1:3002/api/admin/posts

echo ""
echo "=== 3. Проверка из Nginx контейнера (172.17.0.1:3002) ==="
docker exec autoro-site curl -s -o /dev/null -w "From Nginx container - HTTP: %{http_code}\n" http://172.17.0.1:3002/api/admin/posts || echo "Ошибка подключения из Nginx контейнера"

echo ""
echo "=== 4. Проверка сетевых интерфейсов ==="
ip addr show | grep -E "172.17|docker0" | head -5

echo ""
echo "=== 5. Проверка портов блога ==="
docker port autoro-blog-nextjs

echo ""
echo "=== 6. Логи Nginx на ошибки ==="
docker logs autoro-site --tail 50 | grep -i "503\|error\|upstream\|connection" | tail -10

EOF

