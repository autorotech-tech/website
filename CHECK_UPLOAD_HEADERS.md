# Проверка заголовков при загрузке файлов

## Проблема

POST запрос к `/api/blog/admin/upload` возвращает 401, хотя токен передается.

## Диагностика

Нужно проверить:
1. Передается ли заголовок Authorization из фронтенда
2. Читается ли он в route.ts
3. Работает ли функция isAdmin

## Проверка кода фронтенда

В `BlogPostEditor.tsx` функция `handleUploadImage` должна передавать заголовок Authorization:

```typescript
const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: formData,
})
```

**ВАЖНО:** Не добавляйте `Content-Type` для FormData - браузер должен установить его автоматически с boundary.

## Следующие шаги

1. Проверить код в BlogPostEditor.tsx (строки ~220-230)
2. Убедиться, что session.access_token существует
3. Попробовать загрузить файл и посмотреть логи контейнера
4. Если нужно, добавить логирование в upload/route.ts


