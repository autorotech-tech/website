#!/bin/bash
# Простой скрипт для проверки блога - без heredoc

echo "=== Проверка доступности блога ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps | grep blog"

echo ""
echo "=== Тест localhost:3002 ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s -o /dev/null -w 'HTTP: %{http_code}\n' http://localhost:3002/api/admin/posts"

echo ""
echo "=== Тест 172.17.0.1:3002 ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s -o /dev/null -w 'HTTP: %{http_code}\n' http://172.17.0.1:3002/api/admin/posts"

echo ""
echo "=== Тест из Nginx контейнера ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker exec autoro-site curl -s -o /dev/null -w 'HTTP: %{http_code}\n' http://172.17.0.1:3002/api/admin/posts 2>&1 || echo 'Ошибка подключения'"

echo ""
echo "=== Проверка портов блога ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker port autoro-blog-nextjs 2>/dev/null || echo 'Контейнер не найден'"

echo ""
echo "=== Последние ошибки Nginx ==="
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker logs autoro-site --tail 20 | grep -i '503\|error\|upstream' | tail -5"

