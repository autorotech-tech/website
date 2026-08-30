# Исправление проблемы 503 при двойном проксировании (Cloudflare → GCore CDN)

## Проблема

При запросе к `https://cdn.autoro.tech/api/blog/admin/posts`:
- Запрос идет через Cloudflare (IP 104.21.48.61) 
- Cloudflare проксирует на GCore CDN (`cl-glc03b3ef4.gcdn.co`)
- GCore CDN проксирует на origin (nginx-proxy)
- Получаем 503 Service Unavailable

**Текущая архитектура:**
```
Browser → Cloudflare (Proxied) → GCore CDN → nginx-proxy → Next.js
```

## Решение

### Вариант 1: Отключить Cloudflare Proxy для cdn.autoro.tech (РЕКОМЕНДУЕТСЯ)

GCore CDN уже обрабатывает SSL и кэширование, поэтому Cloudflare proxy не нужен:

1. **В Cloudflare Dashboard:**
   - Перейдите в **DNS** → **Records**
   - Найдите запись `cdn` (CNAME → `cl-glc03b3ef4.gcdn.co`)
   - Нажмите **Edit**
   - Измените **Proxy status** с 🟠 **Proxied** на ⚪ **DNS only** (серое облако)
   - Сохраните

2. **Результат:**
   - Cloudflare будет только резолвить DNS
   - GCore CDN напрямую обработает запросы
   - SSL будет обрабатываться GCore CDN
   - CORS будет работать правильно

**Преимущества:**
- ✅ Нет двойного проксирования
- ✅ Меньше задержка
- ✅ Правильная обработка OPTIONS запросов
- ✅ CORS работает корректно

---

### Вариант 2: Настроить Cloudflare для пропуска OPTIONS (если нужно оставить Proxy)

Если нужно оставить Cloudflare Proxy, настройте правила:

1. **В Cloudflare Dashboard:**
   - Перейдите в **Rules** → **Page Rules** (или **Transform Rules** → **Modify Request Header**)
   - Создайте правило для `cdn.autoro.tech/api/blog/*`:
     - **URL pattern:** `cdn.autoro.tech/api/blog/*`
     - **Settings:**
       - **Cache Level:** Bypass
       - **Security Level:** Medium
       - **Disable Performance**

2. **Настройте CORS в Cloudflare:**
   - Перейдите в **Rules** → **Transform Rules** → **Modify Response Header**
   - Создайте правило:
     - **Rule name:** CORS for blog API
     - **When:** `(http.request.uri.path matches "^/api/blog/.*")`
     - **Then:**
       - **Set static:** `Access-Control-Allow-Origin` = `https://swoop.autoro.tech`
       - **Set static:** `Access-Control-Allow-Methods` = `GET, POST, PUT, DELETE, OPTIONS`
       - **Set static:** `Access-Control-Allow-Headers` = `Content-Type, Authorization`
       - **Set static:** `Access-Control-Allow-Credentials` = `true`

3. **Настройте обработку OPTIONS:**
   - Перейдите в **Rules** → **Transform Rules** → **Override Response**
   - Создайте правило:
     - **When:** `(http.request.method eq "OPTIONS") and (http.request.uri.path matches "^/api/blog/.*")`
     - **Then:**
       - **Status code:** 204
       - **Response headers:**
         - `Access-Control-Allow-Origin`: `https://swoop.autoro.tech`
         - `Access-Control-Allow-Methods`: `GET, POST, PUT, DELETE, OPTIONS`
         - `Access-Control-Allow-Headers`: `Content-Type, Authorization`
         - `Access-Control-Allow-Credentials`: `true`

**НО:** Этот вариант сложнее и может привести к конфликтам с настройками GCore CDN.

---

## Проверка после исправления

После применения Варианта 1 (DNS only):

1. **Проверьте DNS:**
   ```bash
   dig cdn.autoro.tech
   # Должен показывать CNAME на cl-glc03b3ef4.gcdn.co
   ```

2. **Проверьте SSL:**
   ```bash
   curl -I https://cdn.autoro.tech/api/blog/admin/posts -H 'Origin: https://swoop.autoro.tech'
   # Должен возвращать 200 или 401 (не 503)
   # Должен содержать Access-Control-Allow-Origin: https://swoop.autoro.tech
   ```

3. **Проверьте OPTIONS:**
   ```bash
   curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/posts \
     -H 'Origin: https://swoop.autoro.tech' \
     -H 'Access-Control-Request-Method: GET'
   # Должен возвращать 204 с CORS заголовками
   ```

---

## Дополнительные настройки GCore CDN

Убедитесь, что в GCore CDN:

1. ✅ **Origin pull protocol:** HTTP (не HTTPS)
   - Поскольку nginx-proxy на origin не имеет SSL для cdn.autoro.tech
   - GCore CDN должен делать HTTP запросы к origin

2. ✅ **CORS header support:** включен
   - `https://swoop.autoro.tech` в allowed origins
   - "Always add the header to response from CDN regardless of response code" включен

3. ✅ **Host header:** `cdn.autoro.tech` или `autoro.tech`
   - В зависимости от того, как настроен nginx-proxy

4. ✅ **Bypass API Cache:** правило для `/api/*` настроено
   - Чтобы API запросы не кэшировались

---

## Рекомендация

**Используйте Вариант 1** (DNS only в Cloudflare):
- Проще настройка
- Меньше точек отказа
- GCore CDN уже обрабатывает все необходимое (SSL, кэширование, CORS)
- Cloudflare нужен только для DNS управления


