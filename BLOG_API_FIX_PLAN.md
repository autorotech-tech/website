# План исправления блога и API для autoro.tech

## 🔍 Проблемы:

1. **Пустой список постов в админке** - возможно API фильтрует только `published` посты
2. **503/502 ошибки** через CDN
3. **Нужно проверить все API endpoints**

## 📋 Шаг 1: Проверить текущее состояние на сервере

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# 1. Проверить структуру блога
ls -la /home/vladx/autoro-blog/app/api/admin/

# 2. Проверить API route для постов
cat /home/vladx/autoro-blog/app/api/admin/posts/route.ts | grep -A 20 "GET\|where\|status\|published"

# 3. Проверить работает ли API
curl -I "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"

# 4. Проверить логи блога
docker logs autoro-blog-nextjs --tail 50

# 5. Проверить статус контейнера блога
docker ps | grep blog
```

## 🔧 Шаг 2: Исправить API route для постов

Если API фильтрует только `published`, нужно изменить:

**Текущий код (предположительно):**
```typescript
// Фильтр только published
.eq('status', 'published')
```

**Должно быть для админки:**
```typescript
// Показывать все посты для админки, но можно фильтровать через query параметр
if (statusFilter) {
  query = query.eq('status', statusFilter)
}
```

## 🔧 Шаг 3: Проверить все API endpoints

Нужно проверить что работают:
- ✅ `GET /api/blog/admin/posts` - список постов
- ✅ `POST /api/blog/admin/posts` - создание поста
- ✅ `GET /api/blog/admin/posts/[id]` - получить пост
- ✅ `PUT /api/blog/admin/posts/[id]` - обновить пост
- ✅ `DELETE /api/blog/admin/posts/[id]` - удалить пост
- ✅ `POST /api/blog/admin/generate-post` - генерация поста
- ✅ `POST /api/blog/admin/generate-seo` - генерация SEO
- ✅ `POST /api/blog/admin/translate` - перевод
- ✅ `POST /api/blog/admin/upload` - загрузка файлов
- ✅ `GET /api/blog/admin/settings` - настройки
- ✅ `PUT /api/blog/admin/settings` - обновить настройки

## 🔧 Шаг 4: Исправить проблему с пустым списком

**Проблема:** API может фильтровать по статусу, показывая только `published`, а пост в статусе `draft`.

**Решение:**
1. Убрать фильтр по статусу в GET /api/blog/admin/posts (для админки)
2. Или добавить параметр `status` в query string
3. По умолчанию показывать все посты в админке

## 🔧 Шаг 5: Проверить CORS и CDN

```bash
# Проверить CORS заголовки
curl -I -X OPTIONS "https://cdn.autoro.tech/api/blog/admin/posts" \
  -H "Origin: https://swoop.autoro.tech" \
  -H "Access-Control-Request-Method: GET"

# Проверить что Nginx правильно проксирует
curl -I -H "Host: cdn.autoro.tech" \
     "http://localhost/api/blog/admin/posts" 
```

## 📝 Команды для быстрой проверки и исправления:

```bash
# Подключиться к серверу
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверить API route
cat /home/vladx/autoro-blog/app/api/admin/posts/route.ts

# Если нужно, редактировать
nano /home/vladx/autoro-blog/app/api/admin/posts/route.ts

# Пересобрать и перезапустить блог
cd /home/vladx/autoro-blog
docker-compose restart
# или
docker restart autoro-blog-nextjs

# Проверить логи
docker logs autoro-blog-nextjs --tail 100
```

