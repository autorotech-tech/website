# Промпт для antigravity AI: Проблема с авторизацией при загрузке файлов

## Контекст проблемы

Разрабатываю систему блога на Next.js с админ-панелью. Фронтенд (React/Vite) находится на `swoop.autoro.tech`, бэкенд API (Next.js) на `cdn.autoro.tech/api/blog`. Между ними настроен GCore CDN и nginx-proxy. При попытке загрузить изображение через API возвращается 401 Unauthorized, хотя заголовок Authorization присутствует в запросе.

---

## Архитектура системы

### Топология запросов:
```
Browser (swoop.autoro.tech)
  ↓
GCore CDN (cdn.autoro.tech)
  ↓
nginx-proxy (Docker контейнер)
  ↓
Next.js API (autoro-blog-nextjs:3000)
  ↓
Supabase Auth + Storage
```

### Ключевые компоненты:

1. **Фронтенд**: React приложение на `swoop.autoro.tech`
   - Использует Supabase Auth для авторизации
   - Отправляет запросы к `https://cdn.autoro.tech/api/blog/admin/upload`
   - Использует JWT токен из Supabase session

2. **Бэкенд**: Next.js 16.1.0 в Docker контейнере
   - API routes в `app/api/admin/upload/route.ts`
   - Проверяет авторизацию через функцию `isAdmin()`
   - Загружает файлы в Supabase Storage

3. **Инфраструктура**:
   - GCore CDN настроен с Origin pull protocol = HTTP
   - nginx-proxy маршрутизирует `/api/blog/` → `autoro-blog-nextjs:3000/api/`
   - CORS настроен для `swoop.autoro.tech`

---

## Детальное описание проблемы

### Симптомы:

1. **401 Unauthorized при загрузке файлов**:
   ```
   POST https://cdn.autoro.tech/api/blog/admin/upload
   Status: 401 Unauthorized
   ```

2. **Заголовок Authorization присутствует в запросе**:
   - В DevTools Network видно: `Authorization: Bearer eyJhbGci...`
   - JWT токен валидный (работает для других эндпоинтов)

3. **Логи на сервере показывают**:
   ```
   Admin check error: Missing or invalid Authorization header
   ```

4. **GET запросы работают**, POST с multipart/form-data не работает

### Воспроизведение проблемы:

1. Открываю `https://swoop.autoro.tech/admin/blog`
2. Логинюсь через Google OAuth (Supabase Auth)
3. Создаю/редактирую пост
4. Пытаюсь загрузить изображение
5. Получаю 401 Unauthorized

---

## Код реализации

### Фронтенд (BlogPostEditor.tsx):

```typescript
const handleUploadImage = async (file: File, isContentImage: boolean = false) => {
  try {
    setUploading(true)
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      throw new Error('Not authenticated')
    }

    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Upload failed')
    }

    const data = await response.json()
    // ...
  } catch (error) {
    console.error('Upload error:', error)
  }
}
```

**Важно**: `BLOG_API_URL = 'https://cdn.autoro.tech/api/blog'`

### Бэкенд (app/api/admin/upload/route.ts):

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClientWithToken } from '@/lib/supabase/api-client'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getCorsHeaders } from '@/lib/cors'

const ADMIN_EMAIL = 'autoro.tech@gmail.com'

async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    // Сначала попробовать получить сессию из cookie
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

    // Fallback на Authorization header
    const authHeader = request.headers.get('authorization')
    console.log('Upload POST - Authorization header:', authHeader ? 'Present' : 'Missing')
    console.log('Upload POST - All headers:', Object.fromEntries(request.headers.entries()))
    
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

export async function POST(request: NextRequest) {
  const adminCheck = await isAdmin(request)
  if (!adminCheck.isAdmin) {
    console.log('Upload POST - Admin check failed')
    const origin = request.headers.get('origin')
    const corsHeaders = getCorsHeaders(origin)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
    )
  }
  // ... обработка загрузки файла
}
```

### CORS настройки (lib/cors.ts):

```typescript
export const ALLOWED_ORIGINS = [
  'https://swoop.autoro.tech',
  'https://autoro.tech',
  'https://cdn.autoro.tech',
  'http://localhost:5173',
  'http://localhost:3000',
]

export function getCorsHeaders(origin?: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  } else {
    headers['Access-Control-Allow-Origin'] = origin || '*'
  }

  return headers
}
```

### nginx-proxy конфигурация:

```nginx
location /api/blog/ {
    # Handle preflight OPTIONS request  
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;
        add_header Access-Control-Max-Age "86400" always;
        add_header Content-Length 0;
        add_header Content-Type text/plain;
        return 204;
    }
    
    # Proxy to blog
    proxy_pass http://autoro-blog-nextjs:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # CORS headers for actual requests
    add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;
}
```

---

## Что уже было сделано

1. ✅ Добавлены CORS заголовки для `swoop.autoro.tech`
2. ✅ Реализован OPTIONS handler для preflight запросов
3. ✅ Добавлена поддержка cookie авторизации (но не используется на фронтенде)
4. ✅ Добавлено логирование заголовков в `isAdmin()`
5. ✅ Проверена конфигурация nginx-proxy
6. ✅ Убедился, что GCore CDN не блокирует заголовки (GET запросы работают)

---

## Гипотезы о причине проблемы

1. **GCore CDN удаляет заголовок Authorization для multipart/form-data запросов**
   - GET запросы с Authorization работают
   - POST с JSON body тоже работают
   - Только POST с FormData не работает

2. **nginx-proxy не передает заголовок Authorization для multipart запросов**
   - Но GET запросы проходят через тот же proxy

3. **Next.js Request не получает заголовок из-за особенностей multipart/form-data**
   - Нужно проверить, как Next.js обрабатывает заголовки для FormData

4. **Проблема с кодировкой или специальными символами в заголовке**
   - JWT токен длинный, может быть проблема с передачей

---

## Требования к решению

### Вариант 1: Исправить передачу Authorization заголовка

Если проблема в передаче заголовка через GCore CDN/nginx-proxy:
- Настроить GCore CDN для сохранения заголовка Authorization
- Или настроить nginx-proxy для явной передачи заголовка
- Или найти альтернативный способ передачи токена

### Вариант 2: Переключиться на Cookie авторизацию

Если заголовок Authorization нельзя передать надежно:
- Реализовать установку cookie с токеном на фронтенде
- Обновить `isAdmin()` для приоритета cookie
- Обновить фронтенд для установки cookie при логине
- Убедиться, что CORS настроен для cookie (`credentials: 'include'`)

### Вариант 3: Комбинированный подход

- Поддержать оба метода (cookie и Authorization header)
- Cookie как основной метод
- Authorization header как fallback

---

## Вопросы для исследования

1. Почему GET запросы с Authorization работают, а POST с FormData нет?
2. Удаляет ли GCore CDN заголовки для multipart/form-data запросов?
3. Как правильно настроить cookie авторизацию с CORS?
4. Нужно ли настраивать `SameSite` и `Secure` атрибуты для cookie?
5. Как правильно установить cookie с JWT токеном на фронтенде?

---

## Дополнительная информация

### Логи с сервера:
```
Admin check error: Missing or invalid Authorization header
Upload POST - Authorization header: Missing
```

### Примеры запросов:

**Работающий GET запрос:**
```
GET https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20
Headers:
  Authorization: Bearer eyJhbGci...
  Origin: https://swoop.autoro.tech
Status: 200 OK
```

**Не работающий POST запрос:**
```
POST https://cdn.autoro.tech/api/blog/admin/upload
Headers:
  Authorization: Bearer eyJhbGci...
  Origin: https://swoop.autoro.tech
  Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
Body: FormData with file
Status: 401 Unauthorized
```

### Версии:
- Next.js: 16.1.0
- Supabase JS: последняя версия
- Docker: последняя версия
- nginx: последняя версия в nginx-proxy контейнере

---

## Задача

**Необходимо решить проблему авторизации при загрузке файлов через multipart/form-data запросы.**

Предпочтительно решение с cookie авторизацией, но можно также исправить передачу Authorization заголовка, если это более надежно.

Решение должно включать:
1. Детальный анализ причины проблемы
2. Конкретные изменения кода (фронтенд и бэкенд)
3. Изменения конфигурации (nginx, CDN, если нужно)
4. Инструкции по тестированию

---

---

## Дополнительные детали для глубокого анализа

### Особенности multipart/form-data запросов:

При использовании `FormData` в fetch API, браузер автоматически устанавливает `Content-Type: multipart/form-data; boundary=...`. Это может влиять на передачу заголовков.

**Важно**: В коде фронтенда НЕ устанавливается `Content-Type` вручную для FormData - браузер делает это автоматически. Это правильное поведение.

### Анализ заголовков в запросе:

Из DevTools Network видно, что запрос содержит:
- `authorization: Bearer ...` (присутствует)
- `content-type: multipart/form-data; boundary=...` (устанавливается браузером)
- `origin: https://swoop.autoro.tech` (присутствует)

Но в логах сервера:
- `Authorization header: Missing`

Это указывает на то, что заголовок теряется где-то между браузером и Next.js API route.

### Возможные точки потери заголовка:

1. **GCore CDN**:
   - Может удалять заголовки для определенных типов запросов
   - Нужно проверить настройки CDN для multipart запросов

2. **nginx-proxy**:
   - `proxy_set_header Authorization $http_authorization;` может не работать для multipart
   - Возможно, нужно использовать `$proxy_http_authorization`

3. **Next.js Request API**:
   - Возможно, Next.js не получает заголовок из-за особенностей multipart parsing

### Альтернативные решения:

#### Решение 1: Передача токена через query параметр (небезопасно, но для теста)
```typescript
const response = await fetch(`${BLOG_API_URL}/admin/upload?token=${session.access_token}`, {
  method: 'POST',
  body: formData,
})
```

#### Решение 2: Использование cookie (рекомендуется)
```typescript
// На фронтенде при логине:
document.cookie = `sb-access-token=${session.access_token}; SameSite=None; Secure; Path=/`

// В fetch:
const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
  method: 'POST',
  credentials: 'include', // Важно!
  body: formData,
})
```

#### Решение 3: Проксирование через фронтенд API route
Если фронтенд на Next.js, можно создать API route на фронтенде, который проксирует запрос с заголовками.

---

## Требования к финальному решению

1. **Работает для multipart/form-data запросов**
2. **Безопасно** (не передавать токен в query параметрах в продакшене)
3. **Надежно** (не терять авторизацию из-за CDN/proxy)
4. **Совместимо с CORS** (работает между разными доменами)
5. **Не требует изменений инфраструктуры** (желательно, но не обязательно)

---

## Приоритет решения

**Предпочтительный порядок:**

1. ✅ **Cookie авторизация** (самое надежное решение для CORS)
2. ⚠️ **Исправление передачи Authorization заголовка** (если возможно)
3. ⚠️ **Проксирование через фронтенд** (если другие не работают)

---

---

## ДОПОЛНЕНИЕ: Гибридная авторизация (после ответа Antigravity)

### Резюме ответа Antigravity

Antigravity предложил переключиться на cookie-based авторизацию с использованием custom cookie `sb-access-token`. Предложение решает проблему, но требуется дополнить его **гибридным подходом** для максимальной надежности.

### Что уже реализовано:

#### Backend (app/api/admin/upload/route.ts):
- ✅ Функция `isAdmin()` уже поддерживает проверку cookie через `createServerClient()` (Supabase SSR)
- ✅ Fallback на Authorization header уже реализован
- ✅ Базовая поддержка обоих методов существует

#### Frontend (BlogPostEditor.tsx):
- ❌ Нет установки cookie перед запросами
- ❌ Нет `credentials: 'include'` в fetch options
- ⚠️ Только Authorization header используется

#### Инфраструктура:
- ✅ CORS настроен для cookie (`Access-Control-Allow-Credentials: true`)
- ✅ `lib/cors.ts` включает необходимые заголовки
- ✅ nginx-proxy настроен для передачи заголовков

### Требование: Гибридный подход

Реализовать **гибридный метод** с приоритетом:
1. **Custom cookie `sb-access-token`** (основной метод для multipart)
2. **Supabase SSR cookies** (стандартный подход)
3. **Authorization header** (fallback для совместимости)

### Детальные требования:

#### Frontend (BlogPostEditor.tsx):

**1. Создать helper функцию:**
```typescript
function setAuthCookie(token: string) {
  document.cookie = `sb-access-token=${token}; Domain=.autoro.tech; Path=/; Secure; SameSite=None; Max-Age=3600`
}
```

**2. Обновить upload функции:**
```typescript
const handleUploadImage = async (file: File, isContentImage: boolean = false) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  
  // Установить cookie перед запросом
  setAuthCookie(session.access_token)

  const formData = new FormData()
  formData.append('file', file)

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

**Применить к:**
- ✅ `handleUploadImage` (обязательно)
- ✅ `handleUploadAudio` (обязательно)

#### Backend (app/api/admin/upload/route.ts):

**Добавить поддержку custom cookie в `isAdmin()`:**

```typescript
async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    const cookieHeader = request.headers.get('cookie')
    
    if (cookieHeader) {
      // 1. Проверка custom cookie sb-access-token
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

      // 2. Проверка Supabase SSR cookies (существующий метод)
      try {
        const supabase = await createServerClient()
        const { data: { user }, error } = await supabase.auth.getUser()
        if (!error && user && user.email === ADMIN_EMAIL) {
          return { isAdmin: true, userId: user.id }
        }
      } catch (cookieError) {
        console.log('Supabase SSR cookie auth failed, trying Authorization header')
      }
    }

    // 3. Fallback на Authorization header (существующий метод)
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
1. Custom cookie `sb-access-token` (новый, основной для multipart)
2. Supabase SSR cookies (существующий стандартный метод)
3. Authorization header (fallback для совместимости)

### Преимущества гибридного подхода:

1. ✅ **Надежность**: Если один метод не работает, используется другой
2. ✅ **Совместимость**: Работает с существующим кодом
3. ✅ **Гибкость**: Можно отключить cookie и использовать только Authorization header
4. ✅ **Постепенная миграция**: Можно протестировать cookie, не ломая существующую функциональность

### Тестирование:

1. **Тест cookie авторизации:**
   - Открыть Blog Editor
   - Загрузить изображение
   - В DevTools → Network проверить наличие `Cookie: sb-access-token=...`
   - Убедиться, что запрос успешен (200 OK)

2. **Тест fallback:**
   - Удалить cookie в DevTools
   - Загрузить изображение
   - Проверить, что используется Authorization header
   - Убедиться, что запрос все еще успешен

---

**Заранее благодарен за помощь!**

