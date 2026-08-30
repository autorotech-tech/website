# Решение для обхода блокировки через альтернативный CDN

## Проблема
Провайдер блокирует:
- Cloudflare
- VPN/WireGuard
- Прямое соединение с autoro.tech

## Решение: Альтернативный CDN

### Вариант 1: Bunny CDN (Рекомендуется)

**Преимущества:**
- Не блокируется так часто, как Cloudflare
- Дешевле ($1/TB)
- Простая настройка
- Pull Zone (проксирует запросы к origin)

**Настройка:**

1. **Регистрация на Bunny CDN:**
   - Зайди на https://bunny.net
   - Создай аккаунт
   - Добавь Pull Zone:
     - Origin URL: `https://autoro.tech` или `http://46.250.228.229`
     - Name: `autoro-cdn` (получишь домен типа `autoro-cdn.b-cdn.net`)

2. **Настройка DNS для твоего домена (если есть альтернативный):**
   ```
   autoro-alt.tld    CNAME    autoro-cdn.b-cdn.net
   ```

3. **Или используй домен Bunny напрямую:**
   - Используй `https://autoro-cdn.b-cdn.net`
   - В коде админки измени `BLOG_API_URL` на новый домен

**Конфигурация Bunny CDN:**
- Enable Cache: ON
- Cache Expiration: 86400 (1 день)
- Origin Shield: OFF (для начала)
- Query String Varying: ON
- Disable Cookies: OFF (нужны для авторизации)

---

### Вариант 2: AWS CloudFront

**Преимущества:**
- Очень надежный
- Глобальная сеть
- Может не блокироваться в некоторых регионах

**Настройка:**

1. **Создать Distribution в AWS CloudFront:**
   ```bash
   # Origin Domain: autoro.tech или 46.250.228.229
   # Origin Protocol: Match Viewer
   # Viewer Protocol: Redirect HTTP to HTTPS
   ```

2. **Получишь домен типа:** `d1234567890.cloudfront.net`

3. **Используй этот домен вместо autoro.tech**

**Недостатки:**
- Сложнее настройка
- Дороже

---

### Вариант 3: Fastly

**Преимущества:**
- Высокая производительность
- Может не блокироваться

**Недостатки:**
- Дорого для небольших проектов
- Сложная настройка

---

### Вариант 4: KeyCDN

**Преимущества:**
- Дешевый
- Простая настройка
- Pull Zone

**Настройка аналогична Bunny CDN**

---

### Вариант 5: Multi-CDN (Несколько CDN одновременно)

Используй несколько CDN одновременно с автоматическим переключением:

1. Bunny CDN (основной)
2. CloudFront (резервный)
3. KeyCDN (резервный)

Используй DNS с автоматическим failover или скрипт для переключения.

---

### Вариант 6: Собственный прокси через другой сервер

Если у тебя есть VPS в другой стране/провайдере:

1. **Установи Nginx на другом сервере:**
   ```nginx
   server {
       listen 80;
       server_name autoro-proxy.example.com;
       
       location / {
           proxy_pass http://46.250.228.229;
           proxy_set_header Host autoro.tech;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

2. **Используй новый домен для доступа**

---

## Рекомендуемое решение: Bunny CDN

**Шаги:**

1. Зарегистрируйся на https://bunny.net
2. Создай Pull Zone:
   - Name: `autoro-bypass`
   - Origin: `http://46.250.228.229` (или `https://autoro.tech`)
   - Получишь домен: `autoro-bypass.b-cdn.net`

3. **Настройка на сервере (Nginx):**
   - Добавь поддержку нового домена в server_name

4. **В коде админки измени URLs:**
   ```typescript
   // Вместо https://autoro.tech/api/blog
   // Используй https://autoro-bypass.b-cdn.net/api/blog
   ```

5. **Важно:** Для API endpoints может потребоваться отключить кэширование в Bunny CDN (для `/api/*` путей)

---

## Настройка Bunny CDN для API (без кэширования)

В Bunny CDN можно настроить правила кэширования:

1. **Edge Rules:**
   ```
   If Request URL matches: /api/*
   Then: Bypass Cache
   ```

2. **Или через Cache-Control заголовки на origin:**
   ```nginx
   location /api/ {
       add_header Cache-Control "no-store, no-cache, must-revalidate";
   }
   ```

---

## Проверка доступности CDN

После настройки проверь:

```bash
# Проверка доступности
curl -I https://autoro-bypass.b-cdn.net

# Проверка API
curl -I https://autoro-bypass.b-cdn.net/api/blog/admin/posts
```

---

## Стоимость

- **Bunny CDN:** ~$1/TB (первые 10GB бесплатно)
- **CloudFront:** ~$0.085/GB (первые 10TB)
- **KeyCDN:** ~$0.04/GB

---

## Рекомендация

**Используй Bunny CDN** - это самое простое и дешевое решение, которое обычно не блокируется.

Если нужна помощь с настройкой - скажи, и я помогу!

