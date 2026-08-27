# Копирование исправленного route.ts

## ✅ Исправление:
OPTIONS теперь возвращает 204 вместо 200 (правильный статус для preflight).

## 📋 Команда для копирования:

```bash
# На ЛОКАЛЬНОЙ машине (Mac)
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/app/api/admin/posts/route.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/
```

## 🔧 Затем перезапустить:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

docker restart autoro-blog-nextjs

# Проверить логи
docker logs autoro-blog-nextjs --tail 50
```

## ⚠️ Но основная проблема - 503 от Nginx

503 означает что Nginx не может достучаться до блога. Нужно проверить:

1. **Блог контейнер запущен:**
   ```bash
   docker ps | grep blog
   ```

2. **Блог отвечает на порту 3002:**
   ```bash
   curl -X OPTIONS http://localhost:3002/api/admin/posts \
     -H "Origin: https://swoop.autoro.tech" \
     -v
   ```

3. **Nginx конфигурация правильная:**
   Проверить `/home/vladx/projects/autoro.tech/html/default.conf` - должен быть `proxy_pass http://172.17.0.1:3002/api/;`

