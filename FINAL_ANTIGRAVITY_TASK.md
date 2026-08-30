# Финальное ТЗ для Antigravity: Гибридная авторизация

## Контекст

После изучения первоначального предложения Antigravity о cookie-based авторизации, требуется реализовать **гибридный метод аутентификации**, который поддерживает оба способа (cookie и Authorization header) для максимальной надежности и совместимости.

---

## Резюме ответа Antigravity

### Предложенное решение:
- Использовать custom cookie `sb-access-token` для upload запросов
- Установить cookie на клиенте перед fetch
- Добавить `credentials: 'include'` в fetch options
- Парсить cookie на бэкенде для авторизации

### Оценка:
✅ Решает проблему с потерей Authorization header для multipart запросов
⚠️ Требуется дополнить fallback на Authorization header для надежности

---

## Что уже реализовано

### Backend (app/api/admin/upload/route.ts):
- ✅ Функция `isAdmin()` проверяет cookie через `createServerClient()` (Supabase SSR)
- ✅ Fallback на Authorization header реализован
- ✅ Базовая поддержка обоих методов существует

**Текущий код:**
```typescript
async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  // 1. Попытка через Supabase SSR cookies
  // 2. Fallback на Authorization header
}
```

### Frontend (BlogPostEditor.tsx):
- ❌ Нет установки cookie перед запросами
- ❌ Нет `credentials: 'include'` в fetch options
- ⚠️ Только Authorization header используется

**Текущий код:**
```typescript
const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: formData,
})
```

### Инфраструктура:
- ✅ CORS настроен для cookie (`Access-Control-Allow-Credentials: true` в `lib/cors.ts`)
- ✅ nginx-proxy настроен для передачи заголовков
- ✅ GCore CDN настроен (HTTP protocol, без redirects)

### Инструменты:
- **Next.js 16.1.0** с App Router
- **Supabase SSR** (`@supabase/ssr`) для работы с cookies
- **Custom cookie handling** на клиенте (нужно добавить)

---

## Требуемая реализация: Гибридный метод

### Приоритет методов (от высокого к низкому):

1. **Custom cookie `sb-access-token`** (основной для multipart)
2. **Supabase SSR cookies** (стандартный подход)
3. **Authorization header** (fallback для совместимости)

---

## Детальные требования

### Frontend (src/components/BlogPostEditor.tsx)

#### 1. Добавить helper функцию (в начало компонента):

```typescript
function setAuthCookie(token: string) {
  // Устанавливаем cookie для всех поддоменов autoro.tech
  document.cookie = `sb-access-token=${token}; Domain=.autoro.tech; Path=/; Secure; SameSite=None; Max-Age=3600`
}
```

**Параметры cookie:**
- `Domain=.autoro.tech` - работает для всех поддоменов
- `SameSite=None` - требуется для cross-origin запросов
- `Secure` - обязателен при SameSite=None (HTTPS)
- `Max-Age=3600` - 1 час (совпадает с временем жизни JWT)

#### 2. Обновить `handleUploadImage`:

```typescript
const handleUploadImage = async (file: File, isContentImage: boolean = false) => {
  try {
    setUploading(true)
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      throw new Error('Not authenticated')
    }

    // УСТАНОВКА COOKIE перед запросом
    setAuthCookie(session.access_token)

    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
      method: 'POST',
      credentials: 'include', // ВАЖНО: для отправки cookie
      headers: {
        'Authorization': `Bearer ${session.access_token}`, // Fallback
      },
      body: formData,
    })

    // ... остальной код без изменений
  }
}
```

#### 3. Обновить `handleUploadAudio` (аналогично):

```typescript
const handleUploadAudio = async (file: File) => {
  // ... существующий код до fetch

  // УСТАНОВКА COOKIE перед запросом
  setAuthCookie(session.access_token)

  const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
    method: 'POST',
    credentials: 'include', // ВАЖНО
    headers: {
      'Authorization': `Bearer ${session.access_token}`, // Fallback
    },
    body: formData,
  })

  // ... остальной код
}
```

---

### Backend (app/api/admin/upload/route.ts)

#### Обновить функцию `isAdmin()`:

```typescript
async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    const cookieHeader = request.headers.get('cookie')
    
    if (cookieHeader) {
      // 1. Проверка custom cookie sb-access-token (НОВЫЙ МЕТОД)
      const cookies = cookieHeader.split(';').map(c => c.trim())
      const accessTokenCookie = cookies.find(c => c.startsWith('sb-access-token='))
      
      if (accessTokenCookie) {
        const token = accessTokenCookie.split('=')[1]?.trim()
        if (token && token.split('.').length === 3) {
          try {
            const supabase = createClientWithToken(token)
            const { data: { user }, error } = await supabase.auth.getUser()
            if (!error && user && user.email === ADMIN_EMAIL) {
              return { isAdmin: true, userId: user.id }
            }
          } catch (tokenError) {
            console.log('Custom cookie token validation failed:', tokenError)
          }
        }
      }

      // 2. Проверка Supabase SSR cookies (СУЩЕСТВУЮЩИЙ МЕТОД)
      try {
        const supabase = await createServerClient()
        const { data: { user }, error } = await supabase.auth.getUser()
        if (!error && user && user.email === ADMIN_EMAIL) {
          return { isAdmin: true, userId: user.id }
        }
      } catch (cookieError) {
        console.log('Supabase SSR cookie auth failed, trying Authorization header:', cookieError)
      }
    }

    // 3. Fallback на Authorization header (СУЩЕСТВУЮЩИЙ МЕТОД)
    const authHeader = request.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim()
      if (token && token.split('.').length === 3) {
        const supabase = createClientWithToken(token)
        const { data: { user }, error } = await supabase.auth.getUser()

        if (!error && user && user.email === ADMIN_EMAIL) {
          return { isAdmin: true, userId: user.id }
        }
      }
    }

    return { isAdmin: false }
  } catch (error) {
    console.error('Error checking admin:', error)
    return { isAdmin: false }
  }
}
```

**Важно:** Сохранить существующий порядок проверки, добавив custom cookie как первый метод.

---

## Тестирование

### 1. Тест cookie авторизации (основной сценарий):
```
1. Открыть https://swoop.autoro.tech/admin/blog
2. Залогиниться через Google OAuth
3. Открыть редактор поста
4. Загрузить изображение
5. В DevTools → Network → Request Headers проверить:
   - Cookie: sb-access-token=eyJhbGci...
   - Authorization: Bearer eyJhbGci... (fallback)
6. Убедиться, что запрос успешен (200 OK)
7. Проверить логи сервера - должно быть "Custom cookie token validation succeeded"
```

### 2. Тест fallback на Authorization header:
```
1. В DevTools → Application → Cookies удалить sb-access-token
2. Загрузить изображение
3. Проверить, что запрос использует только Authorization header
4. Убедиться, что запрос все еще успешен (200 OK)
5. Проверить логи сервера - должно быть "Custom cookie token validation failed" → "Authorization header used"
```

### 3. Тест без cookie и без Authorization header:
```
1. Удалить cookie
2. В DevTools → Network → Request Headers удалить Authorization
3. Попытаться загрузить изображение
4. Должен вернуться 401 Unauthorized
```

---

## Преимущества гибридного подхода

1. ✅ **Максимальная надежность**: Если один метод не работает, используется другой
2. ✅ **Совместимость**: Работает с существующим кодом без breaking changes
3. ✅ **Гибкость**: Можно отключить cookie и использовать только Authorization header
4. ✅ **Постепенная миграция**: Можно протестировать cookie, не ломая существующую функциональность
5. ✅ **Специфичность**: Cookie решает проблему с multipart, Authorization header работает для остальных запросов

---

## Важные замечания

1. **Cookie только для upload**: Основная проблема - это multipart/form-data запросы. Для остальных POST запросов (JSON body) cookie можно не устанавливать, так как Authorization header работает нормально.

2. **SameSite=None требует Secure**: Это означает, что cookie будет работать только через HTTPS (что у нас уже есть).

3. **Domain=.autoro.tech**: Cookie будет доступен для всех поддоменов (swoop.autoro.tech, cdn.autoro.tech), что нужно для cross-origin запросов.

4. **Max-Age=3600**: Cookie живет 1 час. Если токен истечет раньше, нужно будет обновить cookie при обновлении сессии.

---

## Итоговый чеклист

### Frontend:
- [ ] Создать функцию `setAuthCookie()`
- [ ] Вызывать `setAuthCookie()` перед `handleUploadImage`
- [ ] Вызывать `setAuthCookie()` перед `handleUploadAudio`
- [ ] Добавить `credentials: 'include'` в fetch options для upload функций
- [ ] Сохранить Authorization header как fallback

### Backend:
- [ ] Добавить парсинг custom cookie `sb-access-token` в `isAdmin()`
- [ ] Сохранить проверку Supabase SSR cookies
- [ ] Сохранить fallback на Authorization header
- [ ] Убедиться, что порядок проверки: custom cookie → SSR cookies → Authorization header

### Тестирование:
- [ ] Протестировать загрузку изображения с cookie
- [ ] Протестировать fallback на Authorization header
- [ ] Проверить логи сервера для каждого метода

---

**Заранее благодарен за реализацию!**


