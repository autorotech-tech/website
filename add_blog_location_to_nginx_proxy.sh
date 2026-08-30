#!/bin/bash
# Добавление location /api/blog/ в nginx-proxy для autoro.tech

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'EOF'

echo "=== 1. Проверка структуры nginx-proxy ==="
docker exec nginx-proxy ls -la /etc/nginx/ 2>&1 | head -20

echo ""
echo "=== 2. Проверка vhost.d директории ==="
docker exec nginx-proxy ls -la /etc/nginx/vhost.d/ 2>&1

echo ""
echo "=== 3. Создание кастомной конфигурации для autoro.tech ==="
cat > /tmp/autoro.tech_location << 'LOCATION'
location /api/blog/ {
    proxy_pass http://172.17.0.1:3002/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # CORS headers
    add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;
    
    # Handle preflight OPTIONS
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;
        add_header Content-Length 0;
        add_header Content-Type text/plain;
        return 204;
    }
}
LOCATION

echo "=== 4. Копирование конфигурации в nginx-proxy ==="
docker cp /tmp/autoro.tech_location nginx-proxy:/etc/nginx/vhost.d/autoro.tech_location

echo ""
echo "=== 5. Проверка что файл скопирован ==="
docker exec nginx-proxy cat /etc/nginx/vhost.d/autoro.tech_location

echo ""
echo "=== 6. Проверка конфигурации nginx ==="
docker exec nginx-proxy nginx -t

echo ""
echo "=== 7. Перезагрузка nginx ==="
docker exec nginx-proxy nginx -s reload

echo ""
echo "=== 8. Тест после перезагрузки ==="
curl -s -o /dev/null -w "HTTP: %{http_code}\n" -H "Host: cdn.autoro.tech" http://localhost/api/blog/admin/posts

EOF

