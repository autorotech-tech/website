# Проблема с отображением постов блога

## Найдено

### ✅ Пост существует в базе данных
- **ID:** `b121cbf5-7d51-4997-b6e5-51db3feb415c`
- **Статус:** `draft` (черновик)
- **Slug:** `mastering-geo-ranking-your-brand-in-search-engines-and-ai-chatbots`
- **SEO Title:** "GEO Strategy: Rank Your Website in ChatGPT and Gemini AI"
- **Создан:** 2025-12-22 13:06:46

### ⚠️ Проблема
Фронтенд показывает "No posts found", хотя пост есть в базе.

---

## Возможные причины

### 1. API фильтрует посты по статусу
API `/api/blog/admin/posts` может возвращать только посты со статусом `published`, а не `draft`.

**Решение:** Проверить код API route `blog-autoro/app/api/admin/posts/route.ts`:
```typescript
// Должно быть что-то вроде:
.where('status', 'eq', 'published')  // ← Это может быть проблемой
```

**Исправление:** Изменить фильтр, чтобы показывать все посты для админки:
```typescript
// Для админки показывать все посты
// .where('status', 'eq', 'published')  // Убрать или закомментировать
```

### 2. API фильтрует по языку
API может фильтровать посты по языку, но у поста нет переводов.

**Решение:** Проверить, есть ли записи в таблице `blog_post_translations`:
```sql
SELECT * FROM blog_post_translations WHERE post_id = 'b121cbf5-7d51-4997-b6e5-51db3feb415c';
```

### 3. Проблема с авторизацией
API требует правильный JWT токен, и фронтенд может не отправлять его корректно.

**Решение:** Проверить в DevTools браузера:
- Запрос к `https://cdn.autoro.tech/api/blog/admin/posts`
- Заголовок `Authorization: Bearer ...`
- Ответ сервера (статус код, тело ответа)

### 4. Проблема с CORS или CDN
CDN может блокировать или изменять запросы.

**Решение:** Проверить напрямую:
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20
```

---

## Проверка

### 1. Проверить API route код
```bash
# На сервере
cat /home/vladx/autoro-blog/app/api/admin/posts/route.ts | grep -A 10 "where\|status\|published"
```

### 2. Проверить переводы поста
```bash
docker exec supabase-db psql -U postgres -d postgres -c \
  "SELECT * FROM blog_post_translations WHERE post_id = 'b121cbf5-7d51-4997-b6e5-51db3feb415c';"
```

### 3. Проверить в браузере DevTools
- Открыть `https://swoop.autoro.tech/admin/blog`
- Открыть DevTools → Network
- Найти запрос к `/api/blog/admin/posts`
- Проверить:
  - Request Headers (есть ли Authorization?)
  - Response Status (200? 401? 403?)
  - Response Body (что возвращает API?)

---

## Быстрое решение

### Вариант 1: Изменить статус поста на published
```sql
UPDATE blog_posts 
SET status = 'published', published_at = NOW() 
WHERE id = 'b121cbf5-7d51-4997-b6e5-51db3feb415c';
```

### Вариант 2: Исправить API, чтобы показывать все посты для админки
В `blog-autoro/app/api/admin/posts/route.ts` убрать фильтр по статусу или добавить параметр для показа всех постов.

---

## Рекомендация

1. **Проверить API route** - убедиться, что он не фильтрует по статусу для админки
2. **Проверить DevTools** - посмотреть реальный запрос и ответ
3. **Если нужно** - изменить статус поста на `published` или исправить API

