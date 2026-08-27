# Autoro.tech Blog - Память проекта

## 🖥️ Сервер и доступ

**SSH доступ:**
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

**Расположение проекта:**
- Путь на сервере: `/home/vladx/autoro-blog`
- Контейнер: `autoro-blog-nextjs` (порт 3002)
- База данных: `autoro-blog-db` (MariaDB, порт 3306)

## 📦 Технологии

- **Frontend**: Next.js 16.1.0 (React 19.2.3)
- **Backend**: Supabase (api.autoro.tech)
- **База данных**: Supabase PostgreSQL (основная), MariaDB (в Docker)
- **Языки**: TypeScript
- **Стили**: Tailwind CSS 4
- **Развертывание**: Docker Compose
- **Прокси**: nginx-proxy (nginxproxy/nginx-proxy:alpine)

## 🌍 Мультиязычность

**Поддерживаемые языки:**
- en (English) - по умолчанию
- ru (Русский)
- es (Español)
- it (Italiano)
- fr (Français)
- vi (Tiếng Việt)
- kz (Қазақша)

**URL структура:**
- `/blog` → редирект на `/en/blog` или определенный язык
- `/[locale]/blog` → список постов
- `/[locale]/blog/[slug]` → страница поста

**Определение языка:**
- Cookie (`language` или `lang`)
- HTTP заголовок `Accept-Language`
- Дефолтный: `en`

## 🔧 Конфигурация

### Docker Compose
Файл: `autoro-blog/docker-compose.yml`

**Переменные окружения (.env):**
```env
NEXT_PUBLIC_SUPABASE_URL=https://api.autoro.tech
NEXT_PUBLIC_SUPABASE_ANON_KEY=HwgkUPWwSAf5L+S6z5BwPkAx1s743M6Lsc/fkUdixdc=
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
NEXT_PUBLIC_APP_URL=https://autoro.tech
NEXT_PUBLIC_ADMIN_URL=https://swoop.autoro.tech
NEXT_PUBLIC_SUPPORTED_LANGUAGES=en,ru,es,it,fr,vi,kz
N8N_WEBHOOK_URL=
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON=
GEMINI_API_KEYS=<GEMINI_API_KEYS_PLACEHOLDER>
GLM_API_KEYS=<GLM_API_KEYS_PLACEHOLDER>
GLM_MODEL=glm-4-air
```

### Nginx Proxy
- Блог проксируется через nginx-proxy
- Доступ: `https://autoro.tech/blog`
- API: `https://autoro.tech/api/blog/`
- CORS настроен для `https://swoop.autoro.tech`

## 📁 Структура проекта

```
autoro-blog/
├── app/
│   ├── [locale]/
│   │   ├── blog/
│   │   │   ├── [slug]/      # Страница поста
│   │   │   └── page.tsx     # Список постов
│   │   └── layout.tsx
│   ├── api/
│   │   ├── admin/
│   │   │   └── posts/       # CRUD для админа
│   │   ├── comments/        # Комментарии
│   │   ├── webhooks/        # n8n webhooks
│   │   └── posts/           # Публичные API
│   └── layout.tsx
├── components/
│   ├── blog/
│   │   ├── BlogHeader.tsx
│   │   ├── PostCard.tsx
│   │   └── PostContent.tsx
│   ├── seo/
│   │   ├── SEOHead.tsx
│   │   └── JSONLDSchema.tsx
│   └── comments/
│       └── CommentsSection.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts        # Browser client
│   │   ├── server.ts        # Server client
│   │   ├── middleware.ts    # Middleware client
│   │   └── api-client.ts    # Service role client
│   ├── gemini/
│   │   └── client.ts        # Gemini API интеграция
│   ├── glm/
│   │   └── client.ts        # GLM API интеграция
│   ├── google-indexing/
│   │   └── index.ts         # Google Indexing API
│   ├── posts/
│   │   └── queries.ts       # Запросы к БД
│   ├── i18n/
│   │   └── config.ts        # i18n конфигурация
│   └── cors.ts              # CORS утилиты
├── types/                   # TypeScript типы
├── middleware.ts            # Next.js middleware (роутинг языков)
├── supabase_schema.sql      # Схема БД
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## 🗄️ База данных (Supabase)

**Основные таблицы:**
- `blog_posts` - посты (slug, status, SEO поля, AI summary)
- `blog_post_translations` - переводы постов (title, content, meta)
- `blog_categories` - категории
- `blog_comments` - комментарии
- `blog_post_categories` - связь постов и категорий

**Ключевые поля:**
- `status`: `draft` | `published`
- `indexing_status`: `pending` | `indexed` | `failed`
- SEO поля: `seo_title`, `seo_description`, `seo_keywords`
- AI поля: `ai_summary`, `ai_key_points`

**RLS политики:**
- Публичный доступ к опубликованным постам
- Админ доступ только для `autoro.tech@gmail.com`

## 🔐 Аутентификация

**Администратор:**
- Email: `autoro.tech@gmail.com`
- Проверка через Supabase Auth
- Используется в API `/api/admin/*`

## 🔗 API Endpoints

### Админские (требуют аутентификации)
- `POST /api/admin/posts` - создать пост
- `GET /api/admin/posts` - список постов
- `GET /api/admin/posts/[id]` - получить пост
- `PUT /api/admin/posts/[id]` - обновить пост
- `DELETE /api/admin/posts/[id]` - удалить пост
- `POST /api/admin/posts/[id]/index` - индексировать в Google

### Публичные
- `GET /api/posts` - опубликованные посты
- `GET /api/posts/[id]` - получить пост
- `POST /api/comments` - создать комментарий
- `GET /api/posts/[id]/comments` - комментарии поста

### Webhooks (для n8n)
- `POST /api/webhooks/post-created`
- `POST /api/webhooks/post-published`

## 🤖 Интеграции

### Gemini API
- Генерация SEO метаданных (title, description, keywords)
- AI-суммаризация контента
- Извлечение ключевых точек
- Ротация ключей API

### GLM API
- Альтернативный AI провайдер
- Модель: `glm-4-air`

### Google Indexing API
- Автоматическая индексация опубликованных постов
- Требует Service Account JSON

### Cloudflare Turnstile
- Защита комментариев от спама
- Секретный ключ и site key в .env

### n8n Webhooks
- Уведомления о создании/публикации постов
- URL в переменной `N8N_WEBHOOK_URL`

## 🚀 Развертывание

### Команды Docker
```bash
# Перейти в директорию
cd /home/vladx/autoro-blog

# Запустить
docker-compose up -d --build

# Пересобрать после изменений
docker-compose up -d --build --force-recreate blog

# Посмотреть логи
docker logs autoro-blog-nextjs --tail 50 -f

# Остановить
docker-compose down
```

### Обновление кода
1. Скопировать файлы на сервер
2. Пересобрать контейнер
3. Перезапустить

## 📊 Статус проекта

**✅ Завершено:**
- Схема БД Supabase
- Next.js структура
- API endpoints (CRUD)
- Мультиязычность
- SEO компоненты
- Комментарии с Turnstile
- Gemini API интеграция
- Google Indexing API
- Админ-панель (интеграция в swoop.autoro.tech)

**🚧 В процессе:**
- Theme Engine (Phase 2)
- Расширенный Rich Text редактор

**📋 Требуется настройка:**
- Service Account для Google Indexing
- Cloudflare Turnstile ключи (опционально)
- n8n Webhook URL (опционально)

## 🔍 Полезные команды

### Проверка статуса
```bash
docker ps | grep blog
docker logs autoro-blog-nextjs --tail 20
curl http://localhost:3002
```

### Доступ к контейнеру
```bash
docker exec -it autoro-blog-nextjs sh
```

### Логи базы данных
```bash
docker logs autoro-blog-db --tail 20
```

### Проверка переменных окружения
```bash
docker inspect autoro-blog-nextjs | grep -A 20 'Env'
```

## 📝 Документация

- `README.md` - основная документация
- `STATUS.md` - статус реализации
- `DEPLOY.md` - инструкции по деплою
- `SETUP.md` - настройка проекта
- `TESTING.md` - тестирование
- `INTEGRATION_ADMIN.md` - интеграция с админкой

## 🌐 Домены

- **Основной сайт**: https://autoro.tech
- **Админка**: https://swoop.autoro.tech
- **API Supabase**: https://api.autoro.tech
- **Блог**: https://autoro.tech/blog
- **API блога**: https://autoro.tech/api/blog/
- **CDN** (опционально): https://cdn.autoro.tech

## 🐛 Известные проблемы

- Ошибки Server Action в логах (не критично)
- Требуется пересборка после изменений кода
- Google Indexing требует настройки Service Account

## 📞 Контакты

- Email админа: autoro.tech@gmail.com
- Сервер: 46.250.228.229
- Пользователь: vladx

---

*Документ создан: 2025-12-25*
*Последнее обновление: 2025-12-25*


