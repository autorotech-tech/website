# Дополнение к ТЗ для Antigravity: Гибридная авторизация

## Контекст

После изучения предложенного решения cookie-based авторизации, требуется реализовать **гибридный метод аутентификации**, который будет работать как с cookies, так и с Authorization header. Это обеспечит максимальную совместимость и надежность.

---

## Текущее состояние реализации

### Что уже реализовано:

1. **Backend (app/api/admin/upload/route.ts):**
   - ✅ Функция `isAdmin()` проверяет cookie через `createServerClient()` (Supabase SSR)
   - ✅ Fallback на Authorization header
   - ✅ Поддержка обоих методов уже существует в коде

2. **Frontend (BlogPostEditor.tsx):**
   - ⚠️ Только Authorization header в fetch запросах
   - ❌ Нет установки cookie перед запросами
   - ❌ Нет `credentials: 'include'` в fetch options

3. **Инфраструктура:**
   - ✅ CORS настроен для cookie (`Access-Control-Allow-Credentials: true`)
   - ✅ `lib/cors.ts` включает все необходимые заголовки
   - ✅ nginx-proxy настроен для передачи заголовков

### Инструменты и методы:

- **Next.js 16.1.0**: App Router API routes
- **Supabase SSR**: `@supabase/ssr` для работы с cookies на сервере
- **Custom cookie handling**: Ручная установка cookie на клиенте
- **CORS**: Настроен через `lib/cors.ts` и nginx-proxy

---

## Требование: Гибридная авторизация

### Приоритет методов:

1. **Cookie авторизация** (основной метод)
2. **Authorization header** (fallback)

Это обеспечит:
- ✅ Работу через CDN для multipart запросов (cookie)
- ✅ Совместимость с существующим кодом (Authorization header)
- ✅ Надежность (если один метод не работает, используется другой)

---

## Детальное ТЗ для реализации

### Frontend изменения (BlogPostEditor.tsx)

#### 1. Создать helper функцию для установки cookie:

```typescript
function setAuthCookie(token: string) {
  // Устанавливаем cookie для всех поддоменов autoro.tech
  document.cookie = `sb-access-token=${token}; Domain=.autoro.tech; Path=/; Secure; SameSite=None; Max-Age=3600`
}
```

**Важно:**
- `Domain=.autoro.tech` - работает для всех поддоменов (swoop.autoro.tech, cdn.autoro.tech)
- `SameSite=None` - требуется для cross-origin запросов
- `Secure` - обязателен при SameSite=None (требует HTTPS)
- `Max-Age=3600` - 1 час (совпадает с типичным временем жизни JWT токена)

#### 2. Обновить функции upload:

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
    // ... остальной код
  }
}
```

**Применить к:**
- ✅ `handleUploadImage` (обязательно)
- ✅ `handleUploadAudio` (обязательно)

**Опционально (для консистентности):**
- `handleGenerateSEO`
- `handleGenerateImage`
- `handleOptimizeContent`
- `handleTranslate`
- `handleSave`

#### 3. Обновить другие компоненты:

Если в других компонентах есть fetch запросы к API блога, также добавить:
- `credentials: 'include'`
- Установку cookie перед запросом (опционально, так как они используют JSON, а не FormData)

---

### Backend изменения (app/api/admin/upload/route.ts)

#### Текущая реализация уже поддерживает оба метода:

```typescript
async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    // 1. Попытка через cookie (Supabase SSR)
    const cookieHeader = request.headers.get('cookie')
    if (cookieHeader) {
      try {
        const supabase = await createServerClient()
        const { data: { user }, error } = await supabase.auth.getUser()
        if (!error && user && user.email === ADMIN_EMAIL) {
          return { isAdmin: true, userId: user.id }
        }
      } catch (cookieError) {
        console.log('Cookie auth failed, trying Authorization header:', cookieError)
      }
    }

    // 2. Fallback на Authorization header
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

#### Требуемые изменения:

**Добавить поддержку custom cookie `sb-access-token`:**

```typescript
async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    // 1. Попытка через custom cookie (sb-access-token)
    const cookieHeader = request.headers.get('cookie')
    if (cookieHeader) {
      // Парсим custom cookie
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

      // 2. Попытка через Supabase SSR cookies (существующий метод)
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

    // 3. Fallback на Authorization header
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

**Порядок проверки:**
1. Custom cookie `sb-access-token` (быстрый и надежный для multipart)
2. Supabase SSR cookies (стандартный подход)
3. Authorization header (fallback для совместимости)

---

## Тестирование

### 1. Тест cookie авторизации:
```
1. Открыть Blog Editor
2. Загрузить изображение
3. В DevTools → Network → Request Headers проверить наличие Cookie: sb-access-token=...
4. Убедиться, что запрос успешен (200 OK)
```

### 2. Тест fallback на Authorization header:
```
1. В DevTools → Application → Cookies удалить sb-access-token
2. Загрузить изображение
3. Проверить, что используется Authorization header
4. Убедиться, что запрос все еще успешен (200 OK)
```

### 3. Тест других запросов (JSON body):
```
1. Проверить, что POST запросы с JSON body работают
2. (Опционально) добавить cookie для консистентности
```

---

## Резюме изменений

### Frontend:
- ✅ Создать `setAuthCookie()` helper функцию
- ✅ Вызывать `setAuthCookie()` перед upload запросами
- ✅ Добавить `credentials: 'include'` в fetch options для upload
- ⚠️ Сохранить Authorization header как fallback

### Backend:
- ✅ Добавить парсинг custom cookie `sb-access-token` в `isAdmin()`
- ✅ Сохранить проверку Supabase SSR cookies
- ✅ Сохранить fallback на Authorization header

### Инфраструктура:
- ✅ CORS уже настроен (без изменений)
- ✅ nginx-proxy уже настроен (без изменений)

---

## Преимущества гибридного подхода

1. **Надежность**: Если один метод не работает, используется другой
2. **Совместимость**: Работает с существующим кодом
3. **Гибкость**: Можно отключить cookie и использовать только Authorization header
4. **Постепенная миграция**: Можно протестировать cookie, не ломая существующую функциональность

---

## Вопросы для уточнения

1. Нужно ли применять cookie авторизацию ко всем POST запросам или только к upload?
   - **Рекомендация**: Только к upload (FormData), так как проблема специфична для multipart

2. Какое значение Max-Age для cookie?
   - **Рекомендация**: 3600 секунд (1 час) - совпадает с типичным временем жизни JWT

3. SameSite=None или SameSite=Lax?
   - **Рекомендация**: SameSite=None (для cross-origin запросов между swoop.autoro.tech и cdn.autoro.tech)


