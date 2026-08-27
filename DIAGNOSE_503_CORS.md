# Диагностика и исправление 503 для OPTIONS запросов

## 🔍 Проблема:
- OPTIONS запрос возвращает **503 Service Unavailable**
- Это означает что Nginx не может достучаться до блога

## 📋 Шаг 1: Проверить что блог контейнер запущен

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверить статус
docker ps | grep blog

# Должен быть запущен: autoro-blog-nextjs
```

## 📋 Шаг 2: Проверить что блог отвечает напрямую

```bash
# Проверить что блог отвечает на порту 3002
curl -X OPTIONS http://localhost:3002/api/admin/posts \
  -H "Origin: https://swoop.autoro.tech" \
  -H "Access-Control-Request-Method: GET" \
  -v

# Должен вернуть 204 с CORS заголовками
```

## 📋 Шаг 3: Проверить Nginx конфигурацию

```bash
# Проверить конфигурацию
cat /home/vladx/projects/autoro.tech/html/default.conf | grep -A 20 "/api/blog/"

# Проверить что proxy_pass правильный
# Должно быть: proxy_pass http://172.17.0.1:3002/api/;
```

## 📋 Шаг 4: Скопировать исправленный route.ts

```bash
# На ЛОКАЛЬНОЙ машине (Mac)
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/app/api/admin/posts/route.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/
```

## 📋 Шаг 5: Перезапустить контейнеры

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Перезапустить блог
docker restart autoro-blog-nextjs

# Перезапустить Nginx (если нужно)
docker restart autoro-site

# Проверить логи
docker logs autoro-blog-nextjs --tail 50
docker logs autoro-site --tail 50 | grep -i "error\|503"
```

## 🔧 Возможные проблемы:

### 1. Блог контейнер не запущен
```bash
# Запустить
cd /home/vladx/autoro-blog
docker-compose up -d
```

### 2. Блог не отвечает на порту 3002
```bash
# Проверить порт
docker port autoro-blog-nextjs

# Проверить логи на ошибки
docker logs autoro-blog-nextjs --tail 100
```

### 3. Nginx не может достучаться до блога
```bash
# Проверить что блог доступен из Nginx контейнера
docker exec autoro-site curl -X OPTIONS http://172.17.0.1:3002/api/admin/posts -v
```

### 4. Gcore CDN блокирует OPTIONS
- Проверить настройки Gcore CDN
- Убедиться что правило "Bypass API Cache" применяется к `/api/`

