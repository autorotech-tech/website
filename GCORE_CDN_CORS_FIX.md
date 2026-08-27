# Исправление CORS и настройка GCore CDN для cdn.autoro.tech

## Проблема
1. ❌ CORS ошибка: запросы с `https://swoop.autoro.tech` блокируются
2. ❌ 503 Service Unavailable при запросах через `https://cdn.autoro.tech/api/blog/admin/posts`

## Решение

### Шаг 1: Добавить `swoop.autoro.tech` в CORS allowed origins

В GCore CDN панели:

1. Перейдите в раздел **HTTP headers** → **CORS header support**
2. Убедитесь, что **"Enable CORS header support"** включен ✅
3. В опции **"$http_origin" if an origin is listed below"** добавьте:
   - `https://swoop.autoro.tech` (ОБЯЗАТЕЛЬНО добавить!)
   - Убедитесь, что уже есть: `https://cdn.autoro.tech` и `https://autoro.tech`
4. ✅ Включите **"Always add the header to response from CDN regardless of response code"**
5. Сохраните изменения

**Результат:** Запросы с `swoop.autoro.tech` теперь будут разрешены CORS политикой.

---

### Шаг 2: Настроить Host header правильно

В GCore CDN панели:

1. Перейдите в раздел **HTTP headers** → **Host header**
2. Включите **"Change Host header"** ✅
3. Выберите **"Custom Host header"**
4. Установите значение: `cdn.autoro.tech` (или оставьте `autoro.tech` если сервер правильно обрабатывает оба)

**Важно:** Убедитесь, что nginx-proxy на сервере может обрабатывать запросы с Host header `cdn.autoro.tech`.

---

### Шаг 3: Настроить правило для пропуска .well-known/acme-challenge/ (если нужно получать сертификат на сервере)

**Если сертификат уже выпущен в GCore CDN, этот шаг можно пропустить.**

Если все-таки нужно получать сертификат на сервере через Let's Encrypt:

1. Перейдите в раздел **RULES** → **Create rule**
2. **Rule name:** `Allow ACME Challenge`
3. **Match criteria** → **Rule pattern:**
   ```
   location ~* ^/\.well-known/acme-challenge/
   ```
4. **Options** → **Add option** → Выберите **"Cache"**
   - **Cache behavior:** `Bypass Cache`
   - **Enable:** ON
5. **Options** → **Add option** → Выберите **"Rewrite"** (если доступно)
   - Это позволит проксировать запрос на origin сервер без кэширования
6. **Create rule**

**Важно:** Это правило должно быть с **высоким приоритетом** (в списке правил должно быть одним из первых).

---

### Шаг 4: Настроить правила кэширования для API

1. Перейдите в раздел **RULES**
2. Убедитесь, что есть правило **"Bypass API Cache"**:
   - **Rule pattern:** `location ~* ^/api/`
   - **Cache behavior:** `Bypass Cache`
   - **Enable:** ON

Это гарантирует, что API запросы не кэшируются и всегда идут на origin сервер.

---

### Шаг 5: Проверить Origin настройки

В разделе **General** → **Origin**:

1. **Origin Address:** `46.250.228.229`
2. **Origin Protocol:** `HTTP` (так как SSL терминируется на CDN)
3. **Port:** `80`
4. **Host header:** `cdn.autoro.tech` (или `autoro.tech`)

---

### Шаг 6: Настроить таймауты

В разделе **Network**:

1. **Custom connection timeout:** ✅ Включено, значение: `5` секунд
2. **Custom read timeout:** ✅ Включено, значение: `30` секунд

Это гарантирует, что GCore CDN будет ждать ответ от origin сервера достаточно долго.

---

### Шаг 7: Проверить настройки на сервере

На сервере nginx-proxy должен быть настроен для обработки запросов с Host header `cdn.autoro.tech`:

```bash
# Проверить, что nginx-proxy обрабатывает запросы
ssh vladx@46.250.228.229
curl -v http://localhost/api/blog/admin/posts -H 'Host: cdn.autoro.tech'
```

Должен вернуть `401 Unauthorized` (это нормально, так как нет авторизации), но **НЕ** `503`.

---

## Итоговая проверка

После всех настроек:

1. ✅ CORS: Добавлен `https://swoop.autoro.tech` в allowed origins
2. ✅ Host header: Установлен правильно (`cdn.autoro.tech` или `autoro.tech`)
3. ✅ API Cache: Правило "Bypass API Cache" активно
4. ✅ Timeouts: Настроены правильно (5s connection, 30s read)
5. ✅ Origin: Настроен правильно (`46.250.228.229:80`)

---

## Тестирование

```bash
# Тест OPTIONS запроса (preflight)
curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Access-Control-Request-Method: GET' \
  -v

# Должен вернуть:
# HTTP/2 204
# Access-Control-Allow-Origin: https://swoop.autoro.tech
# Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
# Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With

# Тест GET запроса
curl -X GET https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -v

# Должен вернуть:
# HTTP/2 200 (или 401 если нет токена, но НЕ 503)
# Access-Control-Allow-Origin: https://swoop.autoro.tech
```

---

## Возможные проблемы

### Проблема: Все еще 503 Service Unavailable

**Решение:**
1. Проверьте, что origin сервер доступен: `curl -I http://46.250.228.229/`
2. Проверьте логи nginx-proxy: `docker logs nginx-proxy --tail 50`
3. Убедитесь, что Host header в GCore CDN совпадает с server_name в nginx-proxy

### Проблема: CORS все еще блокирует запросы

**Решение:**
1. Убедитесь, что `https://swoop.autoro.tech` добавлен в список allowed origins
2. Проверьте, что включена опция "Always add the header to response from CDN regardless of response code"
3. Очистите кэш CDN (если включено кэширование)

### Проблема: Запросы идут на Cloudflare вместо GCore CDN

**Решение:**
1. Проверьте DNS записи для `cdn.autoro.tech`
2. Убедитесь, что CNAME указывает на GCore CDN домен, а не на Cloudflare

---

## Дополнительные настройки безопасности

Если нужно настроить Rate Limiting для API:

1. Перейдите в раздел **Security** → **WAAP** → **Rate Limiting**
2. Создайте правило:
   - **Path:** `/api/blog/admin/posts`
   - **Method:** `POST`, `PUT`, `DELETE`
   - **Limit:** `10 requests per 5 minutes`
   - **Action:** `Block` или `Challenge`

---

## Примечания

- SSL сертификат терминируется на GCore CDN, поэтому на origin сервере SSL не нужен
- GCore CDN автоматически добавляет CORS заголовки согласно настройкам
- API запросы не должны кэшироваться (правило "Bypass API Cache")
- Всегда тестируйте изменения через curl перед проверкой в браузере


