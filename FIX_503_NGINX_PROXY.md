# Исправление 503: Добавление /api/blog/ в nginx-proxy

## Проблема

- ✅ Блог работает: `localhost:3002` → `401` (правильно)
- ✅ Доступен через bridge: `172.17.0.1:3002` → `401` (правильно)
- ❌ `autoro-site` контейнера нет - используется `nginx-proxy`
- ❌ Nginx-proxy не знает как проксировать `/api/blog/` → `503`

## Решение

`nginx-proxy` поддерживает кастомные location конфигурации через `/etc/nginx/vhost.d/DOMAIN_location`.

### Автоматическое исправление

Выполните скрипт:
```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website
chmod +x add_blog_location_to_nginx_proxy.sh
bash add_blog_location_to_nginx_proxy.sh
```

### Ручное исправление

1. Создать файл конфигурации:
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

2. Создать файл `/tmp/autoro.tech_location`:
```nginx
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
```

3. Скопировать в контейнер:
```bash
docker cp /tmp/autoro.tech_location nginx-proxy:/etc/nginx/vhost.d/autoro.tech_location
```

4. Проверить и перезагрузить:
```bash
docker exec nginx-proxy nginx -t
docker exec nginx-proxy nginx -s reload
```

5. Проверить:
```bash
curl -H "Host: cdn.autoro.tech" http://localhost/api/blog/admin/posts
```

## Альтернативное решение: Volumes

Если `/etc/nginx/vhost.d/` не доступен через volume, нужно:

1. Найти где смонтированы volumes nginx-proxy:
```bash
docker inspect nginx-proxy | grep -A 10 "Mounts"
```

2. Добавить volume для vhost.d или использовать bind mount

## Проверка результата

После исправления:
- ✅ `curl -H "Host: cdn.autoro.tech" http://localhost/api/blog/admin/posts` должен вернуть `401` (не `503`)
- ✅ OPTIONS запросы должны вернуть `204`
- ✅ CORS заголовки должны быть присутствовать

