# Настройка Gcore CDN и защита от ботов

## Шаг 1: Регистрация и создание CDN ресурса

### 1.1. Регистрация в Gcore

1. Зайди на **https://gcore.com**
2. Зарегистрируйся или войди в аккаунт
3. Перейди в раздел **CDN** → **Resources**

### 1.2. Создание CDN ресурса

1. Нажми **Create Resource** или **Add Resource**
2. Заполни форму:
   ```
   Resource Name: autoro-main
   Origin Type: Single Origin
   Origin Address: 46.250.228.229
   Origin Protocol: HTTP (или HTTPS если есть SSL)
   Port: 80
   ```

3. Настройки Origin:
   - **Host Header:** `autoro.tech` (или оставь IP)
   - **Follow Redirects:** Enabled
   - **Origin Shield:** Disabled (для начала)

4. Сохрани и получи CDN домен: `autoro-main.gcdn.co` (или custom домен)

---

## Шаг 2: Настройка кэширования для API

### 2.1. Создание Cache Rule

Важно: API endpoints не должны кэшироваться!

1. В CDN ресурсе → **Cache Rules** → **Add Rule**
2. Настройки:
   ```
   Rule Name: Bypass API Cache
   Path: /api/*
   Cache Behavior: Bypass Cache
   Enable: ON
   ```

3. Сохрани правило

### 2.2. Дополнительные настройки кэширования

1. **Default Cache Rule:**
   - Cache Time: 86400 (1 день)
   - Query String: Include all
   - Cookies: Forward all

2. **Browser Cache:**
   - Max Age: 3600 (1 час)

---

## Шаг 3: Настройка WAAP (Web Application and API Protection)

### 3.1. Включение WAAP

1. В CDN ресурсе → **Security** → **WAAP**
2. Включи **Enable WAAP**
3. Выбери режим:
   - **Log Only** (для начала, чтобы посмотреть что блокируется)
   - **Block** (после проверки)

### 3.2. Настройка Bot Protection

1. **WAAP** → **Bot Protection**
2. Включи:
   - ✅ **Enable Bot Protection**
   - ✅ **JavaScript Challenge** (для подозрительных запросов)
   - ✅ **CAPTCHA** (опционально, для строгой защиты)

3. Настрой правила:
   ```
   Allow: Googlebot, Bingbot (поисковые боты)
   Challenge: Unknown bots
   Block: Known bad bots
   ```

### 3.3. Rate Limiting

1. **WAAP** → **Rate Limiting** → **Add Rule**
2. Для логина (`/login` или `/auth/*`):
   ```
   Rule Name: Login Rate Limit
   Path: /login, /auth/*
   Limit: 5 requests
   Period: 1 minute
   Action: Block (или Challenge)
   ```

3. Для создания постов (`/api/blog/admin/posts`):
   ```
   Rule Name: Post Creation Rate Limit
   Path: /api/blog/admin/posts
   Method: POST
   Limit: 10 requests
   Period: 5 minutes
   Action: Block
   ```

4. Для генерации постов (`/api/blog/admin/generate-post`):
   ```
   Rule Name: Generate Post Rate Limit
   Path: /api/blog/admin/generate-post
   Method: POST
   Limit: 5 requests
   Period: 10 minutes
   Action: Block
   ```

---

## Шаг 4: Настройка DDoS Protection

1. **Security** → **DDoS Protection**
2. Включи:
   - ✅ **Enable DDoS Protection**
   - **Mode:** Auto (автоматическая защита)
   - **Threshold:** Medium (можно настроить под нагрузку)

---

## Шаг 5: Настройка на сервере

### 5.1. Обновление Nginx

Добавь поддержку Gcore CDN домена:

```bash
# На сервере
ssh vladx@46.250.228.229
```

Отредактируй `/home/vladx/projects/autoro.tech/html/default.conf`:

```nginx
server_name localhost autoro.tech www.autoro.tech autoro-main.gcdn.co;
```

Или используй скрипт:

```bash
bash ~/update_nginx_for_cdn.sh
# Введи: autoro-main.gcdn.co
```

### 5.2. Перезапуск Nginx

```bash
cd /home/vladx/projects/autoro.tech
docker restart autoro-site
```

---

## Шаг 6: Настройка Custom Domain (опционально)

Если у тебя есть альтернативный домен:

1. В CDN ресурсе → **Hostnames** → **Add Hostname**
2. Введи: `api-autoro-alt.tld` (твой домен)
3. SSL будет автоматически (Let's Encrypt)
4. В DNS твоего домена создай CNAME:
   ```
   api-autoro-alt.tld  CNAME  autoro-main.gcdn.co
   ```

---

## Шаг 7: Обновление фронтенда

### 7.1. Создай файл `.env.production`:

```bash
VITE_BLOG_API_URL=https://autoro-main.gcdn.co/api/blog
```

### 7.2. Пересобери фронтенд:

```bash
npm run build
# или
docker-compose build frontend
docker-compose up -d frontend
```

---

## Шаг 8: Проверка

### 8.1. Проверка CDN:

```bash
curl -I https://autoro-main.gcdn.co/api/blog/admin/posts

# Должны быть заголовки:
# Server: G-Core
# X-GCore-RequestID: ...
# X-Cache: MISS или HIT
```

### 8.2. Проверка WAAP:

1. Попробуй несколько быстрых запросов (более 5 в минуту к `/login`)
2. Должен сработать rate limit или challenge
3. Проверь логи в Gcore Dashboard → **Security** → **Events**

---

## Дополнительные настройки безопасности

### Geo-blocking (опционально)

1. **Security** → **Geo-blocking**
2. Можешь заблокировать конкретные страны
3. Или разрешить только определенные

### WAF Rules (Web Application Firewall)

1. **Security** → **WAF Rules**
2. Можешь добавить кастомные правила для блокировки подозрительных запросов
3. Например, блокировать запросы с определенными User-Agent

---

## Мониторинг

1. **Analytics** → **Traffic** - статистика трафика
2. **Security** → **Events** - заблокированные запросы
3. **Security** → **Bot Protection** - статистика ботов

---

## Стоимость

- **CDN:** Зависит от трафика (см. тарифы Gcore)
- **WAAP:** Обычно включен в тариф CDN или отдельно
- Проверь актуальные тарифы на https://gcore.com/pricing

---

## Итог

1. ✅ CDN настроен и работает
2. ✅ API не кэшируется (Cache Rule)
3. ✅ WAAP защищает от ботов
4. ✅ Rate Limiting настроен для логина и создания постов
5. ✅ DDoS Protection включен

**Результат:** Защита от автоматизации регистраций и создания постов через Gcore WAAP! 🛡️

