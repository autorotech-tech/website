# Настройка Bunny CDN для обхода блокировки

## Шаг 1: Регистрация и создание Pull Zone

1. Зайди на https://bunny.net
2. Создай аккаунт (есть бесплатный пробный период)
3. Перейди в **Storage** → **Pull Zones** → **Add Pull Zone**
4. Заполни форму:
   - **Name:** `autoro-bypass` (любое имя)
   - **Origin URL:** `http://46.250.228.229` (IP твоего сервера)
   - **Origin Shield:** OFF (для начала)
   - **Cache Expiration:** 86400 (1 день)
   - **Query String Varying:** Enabled (для API)
   - **Disable Cookies:** Disabled (нужны для авторизации)

5. После создания получишь домен типа: `autoro-bypass.b-cdn.net`

---

## Шаг 2: Настройка кэширования для API

Важно: API endpoints не должны кэшироваться!

1. В Bunny CDN перейди в твою Pull Zone
2. Перейди в **Edge Rules**
3. Создай правило:
   - **Name:** `Bypass API Cache`
   - **Condition:** Request URL matches `/api/*`
   - **Action:** Bypass Cache
   - **Enabled:** ON

---

## Шаг 3: Настройка на сервере

Добавь новый домен в Nginx (чтобы сервер понимал запросы от Bunny CDN):

```bash
# На сервере отредактируй /home/vladx/projects/autoro.tech/html/default.conf
# Добавь в server_name новые домены
```

---

## Шаг 4: Обновление переменных окружения фронтенда

В файле `.env` на сервере (где собирается фронтенд) добавь:

```bash
VITE_BLOG_API_URL=https://autoro-bypass.b-cdn.net/api/blog
VITE_SUPABASE_URL=https://autoro-bypass.b-cdn.net  # если тоже нужно через CDN
```

Или создай файл `.env.production`:

```bash
VITE_BLOG_API_URL=https://autoro-bypass.b-cdn.net/api/blog
```

---

## Шаг 5: Пересборка фронтенда

```bash
cd /path/to/frontend
npm run build
# или если используешь Docker:
docker-compose build frontend
docker-compose up -d frontend
```

---

## Шаг 6: Проверка

```bash
# Проверь доступность через CDN
curl -I https://autoro-bypass.b-cdn.net/api/blog/admin/posts

# Должны быть заголовки от Bunny CDN
```

---

## Альтернатива: Использование собственного домена

Если у тебя есть альтернативный домен:

1. В Bunny CDN добавь Custom Hostname:
   - **Hostname:** `api-alt.tld` (твой домен)
   - **SSL Certificate:** Let's Encrypt (автоматически)

2. В DNS твоего домена создай CNAME:
   ```
   api-alt.tld  CNAME  autoro-bypass.b-cdn.net
   ```

3. Используй `https://api-alt.tld/api/blog` вместо `autoro-bypass.b-cdn.net`

---

## Стоимость

- Первые **10GB** бесплатно в месяц
- После: **$1/TB**
- Для небольшого трафика практически бесплатно

---

## Важные замечания

1. **API не кэшируется** благодаря Edge Rules
2. **Cookies передаются** (важно для авторизации)
3. **CORS заголовки** должны быть настроены на origin сервере
4. **WebSocket** может не работать через CDN (если используется)

---

## Если Bunny CDN тоже блокируется

Попробуй другие CDN:
- **KeyCDN:** https://www.keycdn.com
- **StackPath:** https://www.stackpath.com
- **Fastly:** https://www.fastly.com (дороже)

Или используй **Multi-CDN** подход с автоматическим failover.

