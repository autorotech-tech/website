# Пошаговая настройка Gcore CDN для максимальной производительности

## Шаг 1: Настройка Cache Rules (КРИТИЧНО!)

### Правило 1: Bypass для API (не кешировать API)

1. **RULES** → **Create rule** → **Create blank rule**
2. Настройки:
   ```
   Rule name: Bypass API Cache
   
   Match criteria → Rule pattern:
   location ~* ^/api/
   
   Options → Add option:
   - Option: Cache
   - Cache behavior: Bypass Cache
   - Enable: ON
   ```
3. **Create rule**

### Правило 2: Кеширование статики (JS, CSS, изображения)

1. **RULES** → **Create rule** → **Create blank rule**
2. Настройки:
   ```
   Rule name: Cache Static Files
   
   Match criteria → Rule pattern:
   location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp|mp4|mp3|m4a)$
   
   Options → Add option:
   - Option: Cache
   - Cache behavior: Cache
   - TTL: 31536000 (1 год в секундах)
   - Enable: ON
   ```
3. **Create rule**

### Правило 3: Кеширование HTML страниц

1. **RULES** → **Create rule** → **Create blank rule**
2. Настройки:
   ```
   Rule name: Cache HTML Pages
   
   Match criteria → Rule pattern:
   location ~* \.html$
   
   Options → Add option:
   - Option: Cache
   - Cache behavior: Cache
   - TTL: 3600 (1 час)
   - Enable: ON
   ```
3. **Create rule**

### Правило 4: Кеширование страниц блога

1. **RULES** → **Create rule** → **Create blank rule**
2. Настройки:
   ```
   Rule name: Cache Blog Pages
   
   Match criteria → Rule pattern:
   location ~* ^/(en|ru|es|it|fr|vi|kz)/blog
   
   Options → Add option:
   - Option: Cache
   - Cache behavior: Cache
   - TTL: 1800 (30 минут)
   - Enable: ON
   ```
3. **Create rule**

---

## Шаг 2: Настройка Cache (Основные настройки)

### В разделе **Cache**:

1. **CDN caching:**
   - ✅ **Enable CDN caching** - ON
   - **Cache expiration time:** "Origin controlled" (оставляем как есть)
   - **Default cache expiry:** "4 days (recommended)" (оставляем)

2. **Browser caching:**
   - ✅ **Enable browser caching** - **ВКЛЮЧИТЬ**
   - Настроить TTL для браузера: **31536000** (1 год) для статики

3. **Set-Cookie:**
   - ✅ **Ignore Set-Cookie** - **ВКЛЮЧИТЬ**
   - Это улучшит кеширование и уменьшит нагрузку на origin

4. **Query string:**
   - ✅ **Ignore query string** - **ВКЛЮЧИТЬ**
   - Важно для API с query параметрами (например, `?page=1&limit=20`)

5. **Always online:**
   - ✅ **Enable always online** - ON (уже включено)
   - **Serve stale cached content in case of the following errors:**
     - Добавить: `error`, `updating`, `timeout`, `502`, `503`, `504`

6. **Cache key modification:**
   - ❌ **Enable cache key modification** - OFF (не трогать)

---

## Шаг 3: Настройка Compression (Сжатие)

### В разделе **Content**:

1. **GZip compression:**
   - ✅ **Enable GZip compression** - **ВКЛЮЧИТЬ**
   - Это уменьшит размер передаваемых данных на 60-80%

2. **Brotli compression:**
   - ❌ **Enable Brotli compression** - OFF (недоступно без Origin Shielding)

3. **Fetch compressed:**
   - ❌ **Enable fetch compressed** - OFF (оставляем, origin уже сжимает)

---

## Шаг 4: Настройка Origin (Оптимизация)

### В разделе **General**:

1. **Origin pull protocol:**
   - Выбрать: **HTTP and HTTPS** (если origin поддерживает оба)
   - Или: **HTTP** (если только HTTP)

2. **Custom connection timeout:**
   - ✅ **Customize connection timeout** - **ВКЛЮЧИТЬ**
   - Значение: **10** секунд (уменьшить с дефолтного 30s)

3. **Custom read timeout:**
   - ✅ **Customize read timeout** - **ВКЛЮЧИТЬ**
   - Значение: **30** секунд

---

## Шаг 5: Настройка Security (Безопасность)

### В разделе **Access**:

1. **Redirect HTTP to HTTPS:**
   - ✅ **Enable redirect HTTP to HTTPS** - **ВКЛЮЧИТЬ**
   - Все HTTP запросы будут перенаправляться на HTTPS

2. **Country access policy:**
   - ❌ **Enable country access policy** - OFF (если не нужно блокировать страны)

3. **IP access policy:**
   - ❌ **Enable IP access policy** - OFF (если не нужно блокировать IP)

4. **Referrer access policy:**
   - ❌ **Enable referrer access policy** - OFF (если не нужно ограничивать рефереры)

5. **Secure token:**
   - ❌ **Enable secure token** - OFF (не нужно для публичного API)

---

## Шаг 6: Настройка HTTP Headers

### В разделе **HTTP headers**:

1. **CORS header support:**
   - ✅ **Enable CORS header support** - ON (уже включено)
   - Выбрать: **"$http_origin" if an origin is listed below**
   - Добавить origin: `https://swoop.autoro.tech`
   - ✅ **Always add the header to response from CDN regardless of response code** - ВКЛЮЧИТЬ

2. **Request headers:**
   - ❌ **Add request headers** - OFF (если не нужно)

3. **Response headers (add):**
   - ❌ **Add response headers** - OFF (если не нужно)

---

## Шаг 7: Настройка Host Header

### В разделе **HTTP headers**:

1. **Host header:**
   - ✅ **Change Host header** - ON (уже включено)
   - Выбрано: **Custom Host header**
   - Значение: `cdn.autoro.tech` (или `autoro.tech` - проверить что работает)

---

## Шаг 8: Оптимизация Network

### В разделе **Network limits**:

1. **Download speed limit:**
   - ❌ **Enable download speed limit** - OFF (не ограничиваем скорость)

---

## Шаг 9: Оптимизация для больших файлов

### В разделе **Optimization**:

1. **Large files delivery optimization:**
   - ✅ **Enable large files delivery optimization** - **ВКЛЮЧИТЬ** (если есть большие файлы)
   - Ускорит кеширование файлов > 10MB

2. **WebSockets:**
   - ❌ **Enable WebSockets** - OFF (если не используются)

3. **Query String Forwarding:**
   - ✅ **Enable Query String Forwarding** - **ВКЛЮЧИТЬ**
   - Важно для API с параметрами

---

## Итоговая конфигурация

### ✅ Включено:
- CDN caching (с правилами для разных типов контента)
- Browser caching
- Ignore Set-Cookie
- Ignore query string
- Always online
- GZip compression
- Redirect HTTP to HTTPS
- CORS header support (с указанием origin)
- Custom connection timeout (10s)
- Custom read timeout (30s)
- Query String Forwarding
- Large files delivery optimization (опционально)

### ❌ Выключено:
- Brotli compression (недоступно)
- Secure token (не нужно)
- Country/IP/Referrer access policy (если не нужно)
- WebSockets (если не используются)

---

## Проверка производительности

После настройки проверь:

1. **Cache Hit Ratio** в Analytics:
   - Должен быть > 80% для статики
   - API не должен кешироваться (0% для `/api/*`)

2. **Response Time:**
   - Статика: < 100ms (кешированная)
   - API: < 500ms (не кешированная, но оптимизированная)

3. **Bandwidth:**
   - Должен уменьшиться благодаря сжатию

---

## Важные замечания

1. **Правила применяются в порядке приоритета** - более специфичные правила должны быть выше
2. **После изменения настроек кеша** может потребоваться очистка кеша (Purge)
3. **Проверь работу API** после включения "Ignore query string" - некоторые API могут требовать query параметры
4. **CORS настройки** должны соответствовать настройкам на origin сервере

---

## Быстрая проверка

После настройки выполни:

```bash
# Проверка статики (должен быть кеширован)
curl -I https://cdn.autoro.tech/static/js/main.js

# Проверка API (не должен кешироваться)
curl -I https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20

# Проверка сжатия
curl -H "Accept-Encoding: gzip" -I https://cdn.autoro.tech/
```

В заголовках ответа проверь:
- `Cache-Control` - должен быть разным для статики и API
- `Content-Encoding: gzip` - для сжатого контента
- `X-Cache-Status: HIT` - для кешированного контента

