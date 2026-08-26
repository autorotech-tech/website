# Диагностика 401 Unauthorized - Инструкция

## Текущая ситуация

✅ **Расширенное логирование добавлено** в `upload/route.ts`
⚠️ **posts/route.ts временно отключен** для пересборки контейнера

## Что делать дальше

### 1. Попробуйте загрузить файл снова

В браузере на `https://swoop.autoro.tech/admin/blog` попробуйте загрузить изображение.

### 2. Проверьте логи сервера

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
docker logs -f autoro-blog-nextjs
```

### 3. Ищите в логах следующие записи:

- `isAdmin - Cookie header present: true/false`
- `isAdmin - Cookie header value: ...`
- `isAdmin - Parsed cookies count: ...`
- `isAdmin - sb-access-token cookie found: true/false`
- `isAdmin - Token extracted, length: ...`
- `isAdmin - Token parts count: ...`
- `Validating via custom cookie sb-access-token...`
- `isAdmin - getUser result: ...`
- `Custom cookie validation successful` или `isAdmin - Validation failed: ...`

### 4. Проанализируйте логи

**Если cookie не доходит:**
- `isAdmin - Cookie header present: false` → проблема с проксированием cookie через GCore CDN/Nginx

**Если cookie доходит, но токен не извлекается:**
- `isAdmin - sb-access-token cookie found: false` → cookie не устанавливается правильно во фронтенде

**Если токен извлекается, но валидация не проходит:**
- Смотрите `isAdmin - getUser result` и `isAdmin - Validation failed` для деталей

## После диагностики

После получения логов можно будет точно определить проблему и исправить её.


