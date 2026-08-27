# Финальное решение: Использовать autoro.tech напрямую

## Текущая ситуация

1. ✅ curl к `cdn.autoro.tech` работает (401 без редиректа)
2. ❌ Браузер кешировал старые редиректы 301
3. ❌ `autoro.tech` возвращает 525 (SSL handshake failed через Cloudflare)
4. ✅ В коде fallback на `autoro.tech/api/blog` если `VITE_BLOG_API_URL` не установлена

## Решение: Убрать GCore CDN для API, использовать autoro.tech напрямую

### Преимущества:
- ✅ API не должен кешироваться - CDN не нужен
- ✅ Проще конфигурация
- ✅ Нет проблем с редиректами
- ✅ Статика может оставаться через CDN

### Шаги:

#### 1. Проверить/установить переменную окружения

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверить текущее значение
cat /home/vladx/autoro-dashboard/.env.production | grep VITE_BLOG_API_URL

# Если установлена на cdn.autoro.tech, изменить на autoro.tech
# Или просто удалить/закомментировать, чтобы использовать fallback
```

**Вариант A: Использовать autoro.tech напрямую**
```bash
# В /home/vladx/autoro-dashboard/.env.production
VITE_BLOG_API_URL=https://autoro.tech/api/blog
```

**Вариант B: Удалить переменную (использовать fallback)**
```bash
# В /home/vladx/autoro-dashboard/.env.production
# Закомментировать или удалить:
# VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog
```

#### 2. Исправить SSL для autoro.tech (если нужно)

Если `autoro.tech` возвращает 525, нужно проверить:
- Cloudflare SSL/TLS режим (должен быть "Full" или "Full (strict)")
- Или отключить Cloudflare Proxy для autoro.tech (DNS only)

#### 3. Убедиться, что nginx-proxy обрабатывает /api/blog/ для autoro.tech

Файл `/etc/nginx/vhost.d/autoro.tech_location` уже создан с location `/api/blog/`.

#### 4. Пересобрать фронтенд

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/autoro-dashboard
docker-compose restart frontend
# Или пересобрать если нужно
docker-compose up -d --build frontend
```

#### 5. Очистить кеш браузера

- DevTools → Network → "Disable cache"
- Cmd+Shift+R (Mac) или Ctrl+Shift+R (Windows)

---

## Альтернатива: Использовать api-blog.autoro.tech

Если `autoro.tech` имеет проблемы, можно создать отдельный поддомен:

1. В Cloudflare: A-запись `api-blog` → `46.250.228.229` (Proxied)
2. В docker-compose.yml блога: добавить `VIRTUAL_HOST=api-blog.autoro.tech`
3. В .env.production: `VITE_BLOG_API_URL=https://api-blog.autoro.tech/api/blog`

---

## Проверка

После изменений:

```bash
# Проверить, что autoro.tech работает
curl -I 'https://autoro.tech/api/blog/admin/posts?page=1&limit=20' \
  -H 'Origin: https://swoop.autoro.tech'

# Должен вернуть 401 (не 525, не 301)
```

---

## Рекомендация

**Использовать Вариант B** (удалить переменную):
- Fallback уже настроен на `autoro.tech/api/blog`
- Проще всего
- Не нужно менять код

НО: Нужно сначала исправить проблему с 525 на `autoro.tech`.


