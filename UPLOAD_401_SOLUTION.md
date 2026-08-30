# Решение проблемы 401 при загрузке файлов

## Проблема

POST запрос к `/api/blog/admin/upload` с multipart/form-data возвращает 401 Unauthorized.

## Диагностика

1. ✅ Файл upload/route.ts существует и скомпилирован
2. ✅ OPTIONS запрос работает (204)
3. ❌ POST запрос возвращает 401
4. ⚠️ В логах: "Missing or invalid Authorization header"

## Возможные причины

### Причина 1: Заголовок Authorization не передается с multipart/form-data

При отправке FormData некоторые браузеры могут не передавать заголовки, если они не указаны явно в fetch.

**Проверка в коде фронтенда:**
```typescript
// В BlogPostEditor.tsx проверьте, что Authorization передается правильно
const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    // НЕ добавляйте Content-Type для FormData - браузер добавит автоматически
  },
  body: formData,
})
```

### Причина 2: Next.js не читает заголовки из multipart запроса

Возможно, нужно проверить, как Next.js обрабатывает заголовки в multipart запросах.

**Проверка в route.ts:**
```typescript
export async function POST(request: NextRequest) {
  // Проверить, что заголовок читается
  const authHeader = request.headers.get('authorization')
  console.log('Auth header:', authHeader) // Для отладки
  
  const adminCheck = await isAdmin(request)
  // ...
}
```

---

## Решение

### Вариант 1: Добавить логирование для отладки

Добавить console.log в upload/route.ts для проверки заголовков:

```typescript
export async function POST(request: NextRequest) {
  console.log('Upload POST - Headers:', Object.fromEntries(request.headers.entries()))
  console.log('Upload POST - Authorization:', request.headers.get('authorization'))
  
  const adminCheck = await isAdmin(request)
  // ...
}
```

Затем проверить логи:
```bash
docker logs -f autoro-blog-nextjs
```

### Вариант 2: Проверить код фронтенда

Убедиться, что в BlogPostEditor.tsx заголовок Authorization передается правильно:

```typescript
const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: formData, // FormData устанавливает Content-Type автоматически
})
```

---

## Текущий статус

- ✅ Файл существует и работает
- ✅ OPTIONS работает
- ❌ POST возвращает 401
- ⚠️ Нужно проверить логи при реальном POST запросе

---

## Следующие шаги

1. Добавить логирование в upload/route.ts
2. Попробовать загрузить файл в браузере
3. Проверить логи контейнера
4. Увидеть, передается ли заголовок Authorization


