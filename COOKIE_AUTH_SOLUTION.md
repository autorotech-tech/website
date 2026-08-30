# Решение: Использование Cookie для авторизации

## Проблема

Заголовок Authorization не передается через GCore CDN для multipart/form-data запросов, что вызывает 401 Unauthorized.

## Решение: Использовать Cookie вместо Authorization заголовка

### Преимущества:
- ✅ Cookie автоматически передаются браузером
- ✅ Не зависит от заголовков HTTP
- ✅ Работает с multipart/form-data
- ✅ Более надежно для CORS запросов

### Шаги реализации:

#### 1. Создать функцию для получения сессии из cookie

Создать файл `lib/supabase/server.ts` (если не существует):

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
```

#### 2. Изменить функцию isAdmin для использования cookie

В `app/api/admin/upload/route.ts` и других API routes:

```typescript
import { createClient } from '@/lib/supabase/server'

async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    // Попробовать получить токен из cookie
    const cookieHeader = request.headers.get('cookie')
    if (!cookieHeader) {
      // Fallback на Authorization header
      const authHeader = request.headers.get('authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim()
        const supabase = createClientWithToken(token)
        const { data: { user }, error } = await supabase.auth.getUser()
        if (!error && user && user.email === 'autoro.tech@gmail.com') {
          return { isAdmin: true, userId: user.id }
        }
      }
      return { isAdmin: false }
    }

    // Использовать cookie для создания клиента
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return { isAdmin: false }
    }

    if (user.email !== 'autoro.tech@gmail.com') {
      return { isAdmin: false }
    }

    return { isAdmin: true, userId: user.id }
  } catch (error) {
    console.error('Error checking admin:', error)
    return { isAdmin: false }
  }
}
```

#### 3. Обновить фронтенд для отправки cookie

В `BlogPostEditor.tsx` убедиться, что `credentials: 'include'` установлен:

```typescript
const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
  method: 'POST',
  credentials: 'include', // Важно для отправки cookie
  headers: {
    'Authorization': `Bearer ${session.access_token}`, // Fallback
  },
  body: formData,
})
```

#### 4. Настроить CORS для cookie

В `lib/cors.ts` убедиться, что `Access-Control-Allow-Credentials: true` установлен.

---

## Альтернативное решение: Использовать оба метода

Можно поддерживать и cookie, и Authorization header как fallback:

```typescript
async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    // Сначала попробовать cookie
    const cookieHeader = request.headers.get('cookie')
    if (cookieHeader) {
      const supabase = await createClient()
      const { data: { user }, error } = await supabase.auth.getUser()
      if (!error && user && user.email === 'autoro.tech@gmail.com') {
        return { isAdmin: true, userId: user.id }
      }
    }

    // Fallback на Authorization header
    const authHeader = request.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim()
      const supabase = createClientWithToken(token)
      const { data: { user }, error } = await supabase.auth.getUser()
      if (!error && user && user.email === 'autoro.tech@gmail.com') {
        return { isAdmin: true, userId: user.id }
      }
    }

    return { isAdmin: false }
  } catch (error) {
    console.error('Error checking admin:', error)
    return { isAdmin: false }
  }
}
```

---

## Настройка GCore CDN для обхода блокировки

### Вариант 1: WAAP правила

В GCore CDN:
1. Перейти в **Security** → **WAAP**
2. Включить WAAP (если доступно)
3. Настроить правила для обхода блокировок

### Вариант 2: IP Whitelisting

Если есть список разрешенных IP, можно настроить whitelist.

### Вариант 3: Использовать Cloudflare Tunnel

Cloudflare Tunnel может обойти блокировки лучше, чем CDN.

---

## Текущий статус

1. ⚠️ Ошибка компиляции в posts/route.ts - нужно исправить
2. ⚠️ Нужно переключить на cookie авторизацию
3. ⚠️ Нужно настроить GCore CDN для обхода блокировки


