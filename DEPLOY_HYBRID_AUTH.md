# Развертывание гибридной авторизации

## Статус реализации

✅ **Antigravity завершил реализацию гибридной авторизации**

### Что реализовано:

#### Frontend (src/components/BlogPostEditor.tsx):
- ✅ Функция `setAuthCookie()` для установки custom cookie
- ✅ Cookie устанавливается в `handleUploadImage()` перед fetch
- ✅ Cookie устанавливается в `handleUploadAudio()` перед fetch
- ✅ `credentials: 'include'` добавлен в fetch options
- ✅ Authorization header сохранен как fallback

#### Backend (app/api/admin/upload/route.ts):
- ✅ Проверка custom cookie `sb-access-token` (первый приоритет)
- ✅ Проверка Supabase SSR cookies (второй приоритет)
- ✅ Fallback на Authorization header (третий приоритет)
- ✅ Логирование для отладки

---

## Развертывание на сервер

### Шаг 1: Проверить изменения на сервере

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверить, что файл содержит новый код
grep -A 10 'sb-access-token' /home/vladx/autoro-blog/app/api/admin/upload/route.ts
```

**Ожидаемый результат:**
```typescript
// 1. Проверка custom cookie sb-access-token (Hybrid Auth - Primary for Multipart)
const cookies = cookieHeader.split(';').map(c => c.trim())
const accessTokenCookie = cookies.find(c => c.startsWith('sb-access-token='))
```

### Шаг 2: Пересобрать и перезапустить контейнер

```bash
cd /home/vladx/autoro-blog
docker-compose build blog
docker-compose up -d blog
```

### Шаг 3: Проверить логи

```bash
docker logs -f autoro-blog-nextjs
```

**Ожидаемый результат:**
- Контейнер успешно запускается
- Нет ошибок компиляции
- Next.js готов: "Ready in XXXms"

---

## Развертывание фронтенда

### Вариант 1: Если фронтенд на отдельном сервере

Файл `src/components/BlogPostEditor.tsx` нужно обновить на сервере, где развернут фронтенд (swoop.autoro.tech).

### Вариант 2: Если фронтенд деплоится автоматически

Просто задеплоить обновленную версию через обычный процесс деплоя.

### Проверка фронтенда:

Убедиться, что в файле есть:
1. Функция `setAuthCookie()`:
```typescript
function setAuthCookie(token: string) {
  document.cookie = `sb-access-token=${token}; Domain=.autoro.tech; Path=/; Secure; SameSite=None; Max-Age=3600`
}
```

2. Вызов в `handleUploadImage`:
```typescript
setAuthCookie(session.access_token)
// ...
credentials: 'include',
```

3. Вызов в `handleUploadAudio`:
```typescript
setAuthCookie(session.access_token)
// ...
credentials: 'include',
```

---

## Тестирование после развертывания

### Быстрый тест:

1. Открыть `https://swoop.autoro.tech/admin/blog`
2. Залогиниться
3. Открыть редактор поста
4. Загрузить изображение
5. Проверить в DevTools → Network:
   - Request содержит `Cookie: sb-access-token=...`
   - Response: `200 OK` (не 401!)

### Детальное тестирование:

См. файл `TESTING_HYBRID_AUTH.md` для полных инструкций по тестированию.

---

## Откат (если что-то пошло не так)

Если нужно откатить изменения:

1. **Backend:** Восстановить старую версию `route.ts` (без проверки custom cookie)
2. **Frontend:** Удалить вызовы `setAuthCookie()` и `credentials: 'include'`

Но это маловероятно, так как fallback на Authorization header все еще работает.

---

## Мониторинг

### Проверка логов:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
docker logs autoro-blog-nextjs 2>&1 | grep -E 'Custom cookie|Authorization header|Admin check' | tail -20
```

**Ожидаемые логи при успешной работе:**
- "Validating via custom cookie sb-access-token..."
- "Custom cookie validation successful"
- ИЛИ "Custom cookie token validation failed" → "Authorization header used" (fallback)

---

## Успешное развертывание

После успешного развертывания и тестирования:

✅ Проблема с 401 Unauthorized при загрузке файлов решена
✅ Гибридная авторизация работает надежно
✅ Система готова к продакшену


