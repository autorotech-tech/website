# Исправление Nginx для /api/blog/

## Проблема:
503 при запросах к `/api/blog/admin/posts` через Nginx.

## Анализ конфигурации:

Текущая конфигурация:
```nginx
location /api/blog/ {
    proxy_pass http://172.17.0.1:3002/api/;
    ...
}
```

**Проблема:** При запросе `/api/blog/admin/posts`:
- Nginx убирает `/api/blog/` (prefix location)
- Остается только `/admin/posts`
- Проксируется как: `http://172.17.0.1:3002/api/admin/posts` ✅ Правильно!

Но если `proxy_pass` заканчивается на `/`, то путь добавляется правильно.

## Возможные причины 503:

1. **Блог не отвечает** на `172.17.0.1:3002`
2. **Timeout** - Nginx не дожидается ответа
3. **Неправильный Host header**

## Решение:

### 1. Проверить что блог отвечает:

```bash
# На сервере
curl -v http://localhost:3002/api/admin/posts
curl -v http://172.17.0.1:3002/api/admin/posts
```

### 2. Добавить timeout в Nginx:

```nginx
location /api/blog/ {
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    
    proxy_pass http://172.17.0.1:3002/api/;
    ...
}
```

### 3. Проверить логи Nginx:

```bash
docker logs autoro-site --tail 100 | grep -i "503\|error\|upstream"
```

