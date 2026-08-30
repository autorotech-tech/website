# Команды для деплоя исправлений блога

Из-за проблем с shell окружением, выполните команды **вручную**:

## 📋 Шаг 1: Проверить файлы локально

```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

# Проверить что файлы существуют
ls -la blog-autoro/app/api/admin/posts/route.ts
ls -la blog-autoro/lib/supabase/api-client.ts
ls -la blog-autoro/lib/cors.ts
```

## 📋 Шаг 2: Подключиться к серверу

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

## 📋 Шаг 3: Создать директории на сервере

```bash
mkdir -p /home/vladx/autoro-blog/app/api/admin/posts
mkdir -p /home/vladx/autoro-blog/lib/supabase
mkdir -p /home/vladx/autoro-blog/lib

# Backup существующих файлов (если есть)
cd /home/vladx/autoro-blog
if [ -f "app/api/admin/posts/route.ts" ]; then
    cp app/api/admin/posts/route.ts app/api/admin/posts/route.ts.backup.$(date +%Y%m%d_%H%M%S)
    echo "Backup создан"
fi
```

## 📋 Шаг 4: Копировать файлы (в НОВОМ терминале на локальной машине)

**Выйдите из SSH сессии** и выполните в локальном терминале:

```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

# Копировать API route
scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/app/api/admin/posts/route.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/

# Копировать Supabase клиент
scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/lib/supabase/api-client.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/lib/supabase/

# Копировать CORS
scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/lib/cors.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/lib/
```

## 📋 Шаг 5: Вернуться на сервер и перезапустить

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

cd /home/vladx/autoro-blog

# Перезапустить контейнер
docker-compose restart autoro-blog-nextjs

# Или если docker-compose не работает:
docker restart autoro-blog-nextjs
```

## 📋 Шаг 6: Проверить логи

```bash
docker logs autoro-blog-nextjs --tail 50
```

Если видите ошибки компиляции TypeScript, возможно нужно пересобрать:

```bash
cd /home/vladx/autoro-blog
docker-compose down
docker-compose up -d --build
```

## 📋 Шаг 7: Проверить работу API

```bash
curl -I "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"
# Должен вернуть 401 (Unauthorized) - это нормально, нужен токен
```

## ✅ Проверка в браузере:

1. Откройте: `https://swoop.autoro.tech/admin/blog`
2. Проверьте что посты загружаются (должны быть все, включая draft)
3. Проверьте фильтрацию: переключите "All", "Draft", "Published"

