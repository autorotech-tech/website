# ТЗ-Бриф для Antigravity: Autoro.tech Blog System

## Дата: 26 декабря 2025

---

## 📋 Описание проекта

Система блога для Autoro.tech, работающая на Next.js 16.1.0, интегрированная в существующую админ-панель на `swoop.autoro.tech`. API блога развернут на `cdn.autoro.tech/api/blog` через GCore CDN.

---

## 🏗️ Инфраструктура

### Архитектура

```
Browser
  ↓ HTTPS
  ├─→ swoop.autoro.tech (Cloudflare Proxied) → Nginx-proxy → autoro-frontend
  └─→ cdn.autoro.tech (Cloudflare DNS only) → GCore CDN → Nginx-proxy → autoro-blog-nextjs
                                              ↓ HTTP (Origin Pull)
                                        46.250.228.229:3002
                                              ↓
                                    Docker Container: autoro-blog-nextjs
                                              ↓
                                    Next.js API Routes:
                                      - /api/blog/admin/posts
                                      - /api/blog/admin/upload
                                      - /api/blog/admin/posts/[id]
```

**Важно:** 
- `swoop.autoro.tech` проксируется через Cloudflare (Proxied)
- `cdn.autoro.tech` настроен как DNS only в Cloudflare, чтобы запросы шли напрямую в GCore CDN

### Компоненты

#### 1. Frontend
- **Локация:** `/home/vladx/autoro-dashboard/`
- **Контейнер:** `autoro-frontend` (Nginx + статические файлы)
- **URL:** `https://swoop.autoro.tech`
- **Технологии:** React, Vite, TypeScript
- **Компонент:** `BlogPostEditor.tsx` (редактор постов)

#### 2. Backend (Blog API)
- **Локация:** `/home/vladx/autoro-blog/`
- **Контейнер:** `autoro-blog-nextjs` (Next.js 16.1.0)
- **Внутренний порт:** 3000 (проксируется через nginx-proxy на 3002)
- **URL:** `https://cdn.autoro.tech/api/blog`
- **API Routes:**
  - `app/api/admin/posts/route.ts` - CRUD операции с постами
  - `app/api/admin/upload/route.ts` - загрузка изображений и аудио
  - `app/api/admin/posts/[id]/route.ts` - операции с конкретным постом

#### 3. Database
- **База данных:** Supabase PostgreSQL
- **Таблицы:**
  - `blog_posts` - посты блога
  - `blog_post_translations` - переводы постов
  - `storage.buckets` - хранилище для медиа (blog-images, blog-audio, blog-media)

#### 4. Прокси и CDN
- **Nginx-proxy:** Контейнер для маршрутизации запросов
- **GCore CDN:** Кеширование и доставка контента (`cdn.autoro.tech`)
- **Cloudflare:** DNS управление для домена `autoro.tech`

**Cloudflare DNS записи:**
- **Проксируются (Proxied):**
  - `api.autoro.tech` → 46.250.228.229
  - `autoro.tech` → 46.250.228.229
  - `chat.autoro.tech` → 46.250.228.229
  - `solutions.autoro.tech` → 46.250.228.229
  - `swoop.autoro.tech` → 46.250.228.229
  - `tech.autoro.tech` → 46.250.228.229
  - `www.autoro.tech` → 46.250.228.229

- **DNS only (не проксируются):**
  - `cdn.autoro.tech` (CNAME) → `cl-glc03b3ef4.gcdn.co` - **важно для GCore CDN!**
  - MX записи для `autoro.tech` (route1/2/3.mx.cloudflare.net)

**Примечание:** `cdn.autoro.tech` специально настроен как DNS only, чтобы запросы шли напрямую в GCore CDN, а не через Cloudflare proxy. Это критично для правильной работы CDN.

### Docker Compose

**Файл:** `/home/vladx/autoro-blog/docker-compose.yml`

```yaml
services:
  blog:
    build: .
    container_name: autoro-blog-nextjs
    restart: always
    environment:
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - VIRTUAL_HOST=cdn.autoro.tech
      - VIRTUAL_PORT=3000
    networks:
      - proxy
      - default
    ports:
      - "3002:3000"
```

---

## ✅ Что было сделано

### 1. Реализация гибридной авторизации

#### Backend (`app/api/admin/upload/route.ts`)
- ✅ Реализована проверка custom cookie `sb-access-token` (приоритет #1)
- ✅ Fallback на Supabase SSR cookies (приоритет #2)
- ✅ Fallback на Authorization header (приоритет #3)
- ✅ Добавлено расширенное логирование для диагностики

**Код функции `isAdmin()`:**
```typescript
async function isAdmin(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  // 1. Проверка custom cookie sb-access-token
  // 2. Проверка Supabase SSR cookies
  // 3. Fallback на Authorization header
}
```

#### Frontend (`src/components/BlogPostEditor.tsx`)
- ✅ Добавлена функция `setAuthCookie()` для установки custom cookie
- ✅ Cookie устанавливается перед upload запросами
- ✅ Добавлен `credentials: 'include'` в fetch options
- ✅ Сохранен Authorization header как fallback

**Код функции `setAuthCookie()`:**
```typescript
function setAuthCookie(token: string) {
  document.cookie = `sb-access-token=${token}; Domain=.autoro.tech; Path=/; Secure; SameSite=None; Max-Age=3600`
}
```

### 2. Настройка CORS
- ✅ Добавлен `https://cdn.autoro.tech` в ALLOWED_ORIGINS
- ✅ Добавлены OPTIONS handlers для CORS preflight
- ✅ Настроен Nginx-proxy для передачи CORS headers

### 3. Настройка CDN и проксирования
- ✅ Настроен GCore CDN для `cdn.autoro.tech`
- ✅ Исправлено двойное проксирование: `cdn.autoro.tech` переведен в Cloudflare DNS на режим "DNS only" (вместо Proxied)
- ✅ Настроен Host header в GCore CDN (`cdn.autoro.tech`)
- ✅ Отключен "Redirect HTTP to HTTPS" в GCore CDN
- ✅ Настроены DNS записи в Cloudflare (большинство поддоменов Proxied, только `cdn` - DNS only)

### 4. Настройка Storage
- ✅ Созданы buckets в Supabase Storage: blog-images, blog-audio, blog-media
- ✅ Настроены RLS политики для upload и public read

### 5. Очистка инфраструктуры
- ✅ Удалены неиспользуемые контейнеры (wireguard, whisper, anythingllm)
- ✅ Освобождено место на диске (~4 GB)

---

## ❌ Текущие проблемы

### Проблема 1: 401 Unauthorized при загрузке файлов

**Симптомы:**
- POST запрос на `https://cdn.autoro.tech/api/blog/admin/upload` возвращает 401
- Cookie `sb-access-token` присутствует в запросе (видно в DevTools)
- Authorization header присутствует (Bearer token)

**Детали запроса:**
```
Request Method: POST
URL: https://cdn.autoro.tech/api/blog/admin/upload
Headers:
  - Cookie: sb-access-token=eyJhbGci...
  - Authorization: Bearer eyJhbGci...
  - Content-Type: multipart/form-data
Response: 401 Unauthorized
```

**Что проверено:**
- ✅ Cookie устанавливается во фронтенде
- ✅ Cookie присутствует в запросе
- ✅ CORS настроен правильно
- ✅ Backend код с гибридной авторизацией развернут

**Требуется:**
- Проверить логи сервера для детальной диагностики
- Убедиться, что cookie доходит до сервера (возможно, GCore CDN/Nginx не проксирует cookie)
- Проверить валидность токена в cookie

### Проблема 2: SQL ошибка "column blog_post_translations_1.locale does not exist"

**Симптомы:**
- При запросе списка постов (`GET /api/blog/admin/posts`) возникает SQL ошибка
- Сообщение: "column blog_post_translations_1.locale does not exist"

**Локация ошибки:**
- Файл: `app/api/admin/posts/route.ts`
- Метод: `GET`

**Требуется:**
- Проверить схему таблицы `blog_post_translations` в Supabase
- Исправить название колонки в запросе (возможно, должно быть `language` вместо `locale`)
- Убедиться, что все запросы используют правильное название колонки

### Проблема 3: CSP блокирует Turnstile скрипт

**Симптомы:**
- В консоли браузера: "Loading the script 'https://challenges.cloudflare.com/turnstile/v0/api.js' violates the following Content Security Policy directive"

**Требуется:**
- Обновить CSP политику во фронтенде для разрешения загрузки Turnstile скрипта

---

## 🔍 Детали реализации

### Гибридная авторизация (текущая реализация)

**Порядок проверки в `upload/route.ts`:**
1. Custom cookie `sb-access-token` (основной метод для multipart/form-data)
2. Supabase SSR cookies (стандартный метод)
3. Authorization header (fallback)

**Email админа:** `autoro.tech@gmail.com`

### Структура файлов на сервере

**Backend:**
```
/home/vladx/autoro-blog/
├── app/
│   ├── api/
│   │   └── admin/
│   │       ├── posts/
│   │       │   ├── route.ts (GET, POST)
│   │       │   └── [id]/
│   │       │       └── route.ts (GET, PUT, DELETE)
│   │       └── upload/
│   │           └── route.ts (POST - загрузка файлов)
│   └── ...
├── lib/
│   ├── supabase/
│   │   ├── server.ts (createClient, createServiceRoleClient)
│   │   └── api-client.ts (createClientWithToken)
│   └── cors.ts (getCorsHeaders, ALLOWED_ORIGINS)
└── docker-compose.yml
```

**Frontend:**
```
/home/vladx/autoro-dashboard/
├── src/
│   └── components/
│       └── BlogPostEditor.tsx
└── docker-compose.yml
```

---

## 🎯 Задачи для Antigravity

### Приоритет 1: Исправить SQL ошибку

**Задача:** Исправить ошибку "column blog_post_translations_1.locale does not exist"

**Действия:**
1. Проверить схему таблицы `blog_post_translations` в Supabase
2. Определить правильное название колонки (locale или language)
3. Исправить все запросы в `app/api/admin/posts/route.ts`
4. Протестировать получение списка постов

### Приоритет 2: Диагностика 401 Unauthorized

**Задача:** Выяснить причину 401 ошибки при загрузке файлов

**Действия:**
1. Проверить логи сервера после попытки загрузки файла
2. Убедиться, что cookie доходит до сервера (проверить логирование в `isAdmin()`)
3. Если cookie не доходит - проверить настройки проксирования cookie в Nginx/GCore CDN
4. Если cookie доходит, но валидация не проходит - проверить токен и логику валидации

### Приоритет 3: Исправить CSP для Turnstile

**Задача:** Разрешить загрузку Turnstile скрипта

**Действия:**
1. Найти файл с CSP настройками (возможно, в Nginx конфигурации или в HTML)
2. Добавить `https://challenges.cloudflare.com` в `script-src`
3. Протестировать загрузку Turnstile

---

## 📝 Полезные команды

### Проверка логов
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
docker logs -f autoro-blog-nextjs | grep -E "isAdmin|Cookie|sb-access-token|Validation|Upload POST"
```

### Пересборка контейнера
```bash
cd /home/vladx/autoro-blog
docker-compose build blog
docker-compose up -d blog
```

### Проверка схемы БД
```sql
-- В Supabase SQL Editor
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'blog_post_translations';
```

---

## 🔗 Ссылки и доступы

- **Frontend URL:** https://swoop.autoro.tech/admin/blog
- **API URL:** https://cdn.autoro.tech/api/blog
- **Supabase:** (доступ через переменные окружения)
- **SSH:** `ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229`

---

**Готово к работе!** 🚀

