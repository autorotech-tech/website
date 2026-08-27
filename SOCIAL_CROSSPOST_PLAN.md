# План: Social Crossposting в swoop.autoro.tech (реверс-инжиниринг Socialaize)

## 1. Исследование Socialaize и аналогов

### 1.1 Ключевые возможности Socialaize (socialaize.com)

| Функция | Описание |
|---------|----------|
| **Post once, publish everywhere** | Один пост → автоматическая публикация на все подключённые платформы |
| **10+ платформ** | Instagram, Threads, YouTube, TikTok, Facebook, Mastodon, Pinterest, Bluesky, LinkedIn, X (Twitter) |
| **AI Content Optimization** | AI адаптирует контент под best practices каждой платформы |
| **Workflows** | Кастомные последовательности: репост, трансформация, планирование |
| **Unified Dashboard** | Подключение и управление всеми аккаунтами из одного интерфейса |
| **Analytics** | Отслеживание вовлечённости и роста аудитории |

### 1.2 Целевой workflow для Autoro

```
[Генерация статьи в блоге] 
    → [AI подготавливает контент для соцсетей] 
    → [Выбор платформ и настройка вариантов] 
    → [Одна кнопка: разместить посты во все выбранные соцсети]
```

---

## 2. Технические вызовы (реверс-инжиниринг)

### 2.1 Разные модели публикации на платформах

| Платформа | Модель | Особенности |
|-----------|--------|-------------|
| **X (Twitter)** | Direct POST | `/2/tweets`, медиа — отдельный chunked upload |
| **Instagram / Threads** | Container model | Создание контейнера → ожидание обработки → публикация. Threads: минимум 30 сек между шагами |
| **Facebook** | Разные endpoints | Текст → `/{page-id}/feed`, фото → `/{page-id}/photos`, видео → Resumable Upload API |
| **LinkedIn** | Multi-step upload | Images API → Videos (chunked + ETag) → Posts API с URN |
| **TikTok** | Pull-from-URL или chunked | Сначала запрос creator info (privacy levels), фото и видео — разные endpoints |
| **YouTube** | Resumable upload | Инициация сессии → PUT бинарника, metadata в initiation |
| **Pinterest, Mastodon, Bluesky** | Свои протоколы | Каждая имеет уникальные ограничения |

Источник: [Postproxy Blog — Cross-posting guide](https://postproxy.dev/blog/cross-posting-to-multiple-social-networks-via-api/)

### 2.2 OAuth и токены

- Разные реализации OAuth: Meta (Instagram, FB, Threads), Google (YouTube), LinkedIn, X (OAuth 1.0a и 2.0)
- Разные сроки жизни токенов (например, X — 2 часа)
- Разные механизмы refresh и revoke
- Требуется слой управления токенами: обновление, отзыв, повторная аутентификация

### 2.3 Ограничения контента

| Платформа | Лимит | Заметки |
|-----------|-------|---------|
| X | 280 (free) / 25,000 (Pro) | Опросы, цитаты |
| Instagram | 2,200 | Нет кликабельных ссылок в подписи |
| Facebook | 63,206 | Превью ссылок, отложенная публикация |
| LinkedIn | 3,000 | Меншены в формате URN |
| Threads | 500 | Эмодзи считаются по UTF-8 байтам |
| TikTok | 2,200 (видео) / 90 (фото) | Отдельное описание для фото (4,000) |
| YouTube | 100 (title) / 5,000 (desc) | Отдельные поля |

Вывод: нужна **адаптация контента**, а не просто дублирование.

### 2.4 Медиа

- Разные протоколы загрузки: chunked, pull-from-URL, resumable, container
- Разные форматы и ограничения размера
- Разная обработка изображений и видео

### 2.5 EXIF и метаданные медиа

Многие платформы (Instagram, Pinterest) лучше ранжируют контент с корректными EXIF. Рекомендуется:

- **Автоматическое добавление EXIF** к загружаемым/публикуемым файлам:
  - Copyright, Artist — бренд/автор
  - GPS (опционально) — для гео-таргетинга
- **Ресайз и реформатирование** под требования платформы (размеры, формат)

---

## 3. Варианты архитектуры

### Вариант A: Собственная разработка

| Плюсы | Минусы |
|-------|--------|
| Полный контроль | 7+ разных API и протоколов |
| Нет зависимости от провайдера | Регулярное поддержание при изменениях API |
| Нет абонентской платы | Сложный OAuth и token management |
| | Верификация приложений (TikTok, Meta и др.) |

Оценка: 2–4 месяца только на базовую интеграцию.

### Вариант B: Unified API провайдер

| Провайдер | Платформы | Особенности |
|-----------|-----------|-------------|
| **Postproxy** | 7+ (X, Instagram, FB, LinkedIn, Threads, TikTok, YouTube) | Один запрос, обработка всех платформ, job-based |
| **Crosspostify** | Instagram, Facebook, TikTok, Pinterest | REST API, планирование |
| **Late** | 13+ платформ | Profile-based, webhooks, analytics |
| **Publer** | 10+ платформ | Batch posting, асинхронные задачи |

Рекомендация: начать с **Postproxy** или **Late** как агрегатора для MVP, чтобы не реализовывать каждый API вручную.

### Вариант C: Гибрид

- MVP: Postproxy/Late для основных платформ
- Дальше: собственные интеграции для критичных платформ при необходимости

---

## 4. Текущее состояние swoop.autoro.tech

### 4.1 Уже есть

- **BlogAdmin** — список постов, CRUD, IndexNow
- **BlogPostEditor** — Tiptap, загрузка изображений, автосохранение
- **BlogPostGenerator** — AI (Gemini/GLM) для генерации статей
- **Supabase** — аутентификация, БД, Storage
- **blog_posts** — slug, status, featured_image_url, translations (title, excerpt, content, meta_*)
- **API** — `/api/blog/admin/posts`, generate-post, upload

### 4.2 Чего нет

- Подключение соцсетей (OAuth flows)
- Хранение токенов и refresh
- Подготовка контента для соцсетей из статьи
- Публикация в соцсети
- Планирование постов
- Аналитика по постам

---

## 5. План реализации (по фазам)

### Фаза 0: Подготовка (1–2 недели)

- [ ] Выбор провайдера Unified API (Postproxy / Late)
- [ ] Регистрация приложений в соцсетях (Meta, X, LinkedIn и т.д.)
- [ ] Схема БД: `social_accounts`, `social_posts`, `social_schedules`
- [ ] Документация API выбранного провайдера

### Фаза 1: MVP — «Share to Social» (3–4 недели)

**Цель:** Из статьи блога — подготовить и отправить пост в 2–3 соцсети (например, X, LinkedIn, Facebook).

1. **Схема БД**
   - `social_accounts` (user_id, platform, access_token, refresh_token, expires_at, profile_id)
   - `social_posts` (blog_post_id, platform, status, scheduled_at, published_at, external_id)
   - `social_post_variants` (post_id, platform, caption, media_urls — для адаптации)

2. **Backend (blog-autoro или отдельный API)**
   - `POST /api/social/accounts/connect/{platform}` — OAuth redirect
   - `GET /api/social/accounts` — список подключённых аккаунтов
   - `POST /api/social/prepare-from-blog` — AI генерирует варианты из статьи
   - `POST /api/social/publish` — отправка в провайдера (Postproxy/Late)

3. **Frontend (swoop)**
   - Раздел «Social» или пункт «Share to Social» в BlogAdmin
   - Страница подключения аккаунтов
   - Экран подготовки: выбор поста, редактирование вариантов, выбор платформ
   - Кнопка «Publish» / «Schedule»

4. **AI для адаптации контента**
   - Вход: title, excerpt, link на статью, featured_image_url
   - Выход: варианты под каждую платформу (ограничения символов, хештеги, tone)

5. **EXIF для медиа**
   - Функция автоматического добавления EXIF к изображениям перед публикацией
   - Copyright, Artist, GPS (опционально)
   - Ресайз и формат под требования платформы

### Фаза 2: Расширение (2–3 недели)

- [ ] Планирование (scheduled_at)
- [ ] Поддержка 5–7 платформ
- [ ] Базовый статус публикаций (success/failed)
- [ ] Очередь задач (Supabase Edge Functions / n8n / воркер)

### Фаза 3: Продвинутые функции (4+ недели)

- [ ] Workflows: автоматический пост при публикации статьи
- [ ] Аналитика: просмотры, лайки, комментарии
- [ ] Карусели (несколько изображений)
- [ ] Видео (YouTube Shorts, TikTok, Reels)

---

## 6. Схема экранов в swoop

```
BlogAdmin (существующий)
  ├── [New] "Share to Social" на карточке поста
  │     → SocialShareModal(postId)
  │         ├── Подключённые аккаунты
  │         ├── AI-подготовка вариантов
  │         ├── Выбор платформ
  │         └── Publish / Schedule
  │
  └── [New] Sidebar / Route: /admin/social
        ├── Connected Accounts
        ├── Post Queue (scheduled)
        └── Settings (API keys, провайдер)
```

---

## 7. Оценка ресурсов

| Фаза | Срок | Зависимости |
|------|------|-------------|
| Фаза 0 | 1–2 нед | Решение по провайдеру, доступ к Meta/LinkedIn/X dev |
| Фаза 1 MVP | 3–4 нед | Фаза 0, API ключи провайдера |
| Фаза 2 | 2–3 нед | MVP |
| Фаза 3 | 4+ нед | Фаза 2, дополнительные интеграции |

---

## 8. Риски и митигация

| Риск | Митигация |
|------|-----------|
| Изменения API платформ | Использовать Unified API провайдера |
| Верификация приложений | Начать с платформ с простым review (LinkedIn, X) |
| Стоимость провайдера | Сравнить Postproxy, Late, Crosspostify; учитывать free tier |
| Частота обновления токенов | Логика refresh в Supabase Edge Functions или CRON |

---

## 9. Следующие шаги

1. Зарегистрировать dev-приложения: [Meta for Developers](https://developers.facebook.com/), [X Developer Portal](https://developer.twitter.com/), [LinkedIn Developers](https://www.linkedin.com/developers/).
2. Оформить тестовый доступ к Postproxy или Late.
3. Создать миграции Supabase для `social_*` таблиц.
4. Реализовать OAuth flow для 1 платформы (например, X) как proof of concept.
5. Интегрировать AI (Gemini) для адаптации контента под платформы.

---

## Источники

- [Postproxy — Cross-posting to multiple social networks via API](https://postproxy.dev/blog/cross-posting-to-multiple-social-networks-via-api/)
- [Socialaize — Home](https://socialaize.com/)
- [Crosspostify Documentation](https://crosspostify.com/docs)
- [Late — Social Media API](https://getlate.dev/social-media-api)
