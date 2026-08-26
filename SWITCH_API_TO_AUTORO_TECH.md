# Переключение API на autoro.tech (без CDN)

## Проблема

- Фронтенд использует `VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog`
- Браузер кешировал редиректы 301 из GCore CDN
- API не должен кешироваться, поэтому CDN не нужен

## Решение

Изменить переменную окружения на `autoro.tech/api/blog` для прямого доступа.

## Шаги

### 1. Изменить .env.production

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/autoro-dashboard

# Сделать backup
cp .env.production .env.production.backup

# Изменить переменную
sed -i 's|VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog|VITE_BLOG_API_URL=https://autoro.tech/api/blog|' .env.production

# Проверить
cat .env.production | grep VITE_BLOG_API_URL
# Должно быть: VITE_BLOG_API_URL=https://autoro.tech/api/blog
```

### 2. Перезапустить/пересобрать фронтенд

```bash
cd /home/vladx/autoro-dashboard

# Вариант A: Перезапустить (если переменные читаются из .env)
docker-compose restart frontend

# Вариант B: Пересобрать (если переменные встраиваются при сборке)
docker-compose up -d --build frontend
```

### 3. Проверить работу

```bash
# Проверить, что autoro.tech обрабатывает /api/blog/
curl -I 'https://autoro.tech/api/blog/admin/posts?page=1&limit=20' \
  -H 'Origin: https://swoop.autoro.tech'

# Должен вернуть 401 (не 525, не 301)
```

### 4. Очистить кеш браузера

- DevTools → Network → включить **"Disable cache"**
- Cmd+Shift+R (Mac) или Ctrl+Shift+R (Windows)
- Обновить страницу `https://swoop.autoro.tech/admin/blog`

---

## Если autoro.tech возвращает 525

Если `autoro.tech` возвращает 525 (SSL handshake failed), нужно:

1. **Проверить Cloudflare SSL/TLS режим:**
   - Cloudflare Dashboard → SSL/TLS → Overview
   - Должен быть "Full" или "Full (strict)"

2. **Или отключить Cloudflare Proxy для autoro.tech:**
   - Cloudflare → DNS → найти запись `autoro.tech` (A record)
   - Изменить Proxy status с 🟠 **Proxied** на ⚪ **DNS only**

---

## Преимущества этого подхода

- ✅ API не проходит через CDN (правильно, так как не должен кешироваться)
- ✅ Нет проблем с редиректами
- ✅ Проще конфигурация
- ✅ Статика может оставаться через CDN (если нужно)

---

## Проверка после изменений

После перезапуска фронтенда:

1. Откройте `https://swoop.autoro.tech/admin/blog`
2. DevTools → Network → смотрите запросы
3. Запросы должны идти на `autoro.tech/api/blog/admin/*`
4. Должны возвращать 401 (не 301, не 525)


