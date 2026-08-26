# Исправление 503 через nginx-proxy

## Проблема

1. ✅ Блог работает: `localhost:3002` и `172.17.0.1:3002` возвращают `401` (правильно)
2. ❌ `autoro-site` контейнера нет - используется `nginx-proxy`
3. ❌ Nginx не проксирует `/api/blog/` → 503

## Диагностика

Выполните на сервере:

```bash
# 1. Проверить какие контейнеры с autoro.tech
docker ps --filter "name=autoro" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

# 2. Проверить конфигурацию nginx-proxy
docker exec nginx-proxy ls -la /etc/nginx/conf.d/
docker exec nginx-proxy cat /etc/nginx/conf.d/default.conf | head -50

# 3. Проверить переменные окружения для autoro.tech
docker ps --filter "name=autoro" --format "{{.Names}}" | xargs -I {} docker inspect {} | grep -A 10 VIRTUAL_HOST

# 4. Проверить volumes nginx-proxy
docker inspect nginx-proxy | grep -A 20 "Mounts"

# 5. Найти где хранятся конфиги для autoro.tech
find /home/vladx -name "*nginx*" -type f 2>/dev/null | grep -E "(conf|config)" | head -10
```

## Решение

### Вариант 1: Добавить кастомную конфигурацию в nginx-proxy

`nginx-proxy` поддерживает кастомные конфигурации через `/etc/nginx/vhost.d/` или через переменные окружения.

1. Создать файл конфигурации:
```bash
cat > /tmp/autoro.tech_location << 'EOF'
location /api/blog/ {
    proxy_pass http://172.17.0.1:3002/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # CORS headers
    add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;
    
    # Handle OPTIONS
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;
        add_header Content-Length 0;
        add_header Content-Type text/plain;
        return 204;
    }
}
EOF

# Скопировать в nginx-proxy контейнер
docker cp /tmp/autoro.tech_location nginx-proxy:/etc/nginx/vhost.d/autoro.tech_location

# Перезагрузить nginx
docker exec nginx-proxy nginx -s reload
```

### Вариант 2: Использовать отдельный контейнер для autoro.tech

Создать отдельный Nginx контейнер как `autoro-site` с правильной конфигурацией.

### Вариант 3: Добавить через переменные окружения

Если nginx-proxy поддерживает, добавить переменные окружения в контейнер, который обслуживает `autoro.tech`.

## Следующие шаги

1. Выполнить диагностические команды выше
2. Найти где хранится конфигурация для `autoro.tech`
3. Добавить location `/api/blog/` в конфигурацию
4. Перезагрузить nginx

