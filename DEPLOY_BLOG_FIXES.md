# Деплой исправлений блога

## ✅ Созданные файлы:

1. `blog-autoro/app/api/admin/posts/route.ts` - API для списка и создания постов
2. `blog-autoro/lib/supabase/api-client.ts` - Supabase клиент для API
3. `blog-autoro/lib/cors.ts` - CORS заголовки

## 🚀 Команды для деплоя:

```bash
# 1. Подключиться к серверу
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# 2. Создать структуру директорий (если нужно)
mkdir -p /home/vladx/autoro-blog/app/api/admin/posts
mkdir -p /home/vladx/autoro-blog/lib/supabase

# 3. Сделать backup существующих файлов (если есть)
cd /home/vladx/autoro-blog
if [ -f "app/api/admin/posts/route.ts" ]; then
  cp app/api/admin/posts/route.ts app/api/admin/posts/route.ts.backup.$(date +%Y%m%d_%H%M%S)
fi

# 4. Скопировать файлы (выполнить на ЛОКАЛЬНОЙ машине)
# В новом терминале:
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/app/api/admin/posts/route.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/lib/supabase/api-client.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/lib/supabase/

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/lib/cors.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/lib/

# 5. Вернуться на сервер и перезапустить блог
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

cd /home/vladx/autoro-blog
docker-compose restart autoro-blog-nextjs

# Или пересобрать полностью:
# docker-compose down
# docker-compose up -d --build

# 6. Проверить логи
docker logs autoro-blog-nextjs --tail 50

# 7. Проверить работу API
curl -I "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"
# Должен вернуть 401 (Unauthorized) - это нормально, нужен токен
```

## 🔍 Проверка работы:

1. **Открыть админку:** `https://swoop.autoro.tech/admin/blog`
2. **Проверить что посты загружаются** (должны отображаться все, включая draft)
3. **Проверить фильтрацию** - переключить фильтр "All", "Draft", "Published"

## 📝 Что исправлено:

1. ✅ API показывает **все посты** по умолчанию (не только published)
2. ✅ Фильтрация работает через query параметр `?status=draft` или `?status=published`
3. ✅ Включены переводы в ответ (`blog_post_translations`)
4. ✅ Правильная пагинация
5. ✅ CORS заголовки для всех запросов

