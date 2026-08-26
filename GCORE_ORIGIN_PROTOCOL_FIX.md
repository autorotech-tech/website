# Исправление 503 после изменения Cloudflare на DNS only

## Проблема

После изменения Cloudflare на DNS only все еще получаем 503 Service Temporarily Unavailable:
- DNS резолвится правильно: `cdn.autoro.tech` → `cl-glc03b3ef4.gcdn.co`
- Заголовок `server: nginx` (не `cloudflare`) - значит запрос идет через GCore CDN
- CORS заголовок присутствует: `access-control-allow-origin: https://swoop.autoro.tech`
- Но GCore CDN не может получить ответ от origin сервера

## Причина

GCore CDN не может достучаться до origin сервера. Возможные причины:

1. **Origin pull protocol неправильно настроен** (HTTPS вместо HTTP)
   - nginx-proxy на origin не имеет SSL для `cdn.autoro.tech`
   - `ssl_reject_handshake on;` в конфигурации nginx-proxy

2. **Host header неправильно настроен**
   - В GCore CDN установлен Host header = `autoro.tech`
   - Но nginx-proxy может ожидать `cdn.autoro.tech`

3. **Origin группа или IP неправильно настроены**

## Решение

### Шаг 1: Проверить Origin Pull Protocol в GCore CDN

**В GCore CDN Dashboard:**

1. Перейдите в **CDN resource** → `cdn.autoro.tech`
2. В боковом меню: **OPTIONS** → **General** → **Origin pull protocol**
3. Убедитесь, что выбран **HTTP** (не HTTPS, не "HTTP and HTTPS")

**Почему HTTP?**
- nginx-proxy на origin не имеет SSL сертификата для `cdn.autoro.tech`
- SSL обрабатывается на стороне GCore CDN
- Трафик от GCore CDN к origin должен быть HTTP

---

### Шаг 2: Проверить Origin Group в GCore CDN

1. Перейдите в **CDN resource** → `cdn.autoro.tech`
2. В боковом меню: **OPTIONS** → **General** → **Origin pull protocol**
3. Проверьте **Origin group**:
   - Должен указывать на `autoro-origin-auth` или правильную группу
   - Origin должен быть: `http://46.250.228.229` или `http://autoro.tech`
   - Порт должен быть 80 (HTTP)

---

### Шаг 3: Проверить Host Header

Из скриншота видно, что Host header = `autoro.tech`. Это правильно, потому что:

1. nginx-proxy слушает на `autoro.tech`
2. GCore CDN должен отправлять запросы с Host = `autoro.tech` (или `cdn.autoro.tech`)

**Вариант A: Оставить Host = `autoro.tech` (РЕКОМЕНДУЕТСЯ)**

Если nginx-proxy правильно обрабатывает `autoro.tech`, оставьте как есть.

**Вариант B: Изменить Host = `cdn.autoro.tech`**

Если nginx-proxy настроен для `cdn.autoro.tech`, измените:

1. В GCore CDN → **HTTP headers** → **Host header**
2. Убедитесь, что **"Change Host header"** включен
3. **Custom Host header** = `cdn.autoro.tech`
4. Сохраните

---

### Шаг 4: Проверить правило "Bypass API Cache"

Из скриншота видно правило "Bypass API Cache" для `/api/`:

1. **Origin pull protocol:** "Inherit from resource"
   - Это означает, что используется протокол из общих настроек ресурса
   - Убедитесь, что в общих настройках установлен **HTTP**

2. **CDN caching:** выключен (правильно для API)

3. **Rule pattern:** `^/api/`
   - Правильно для `/api/blog/admin/posts`

---

### Шаг 5: Проверить доступность Origin с сервера

Выполните на сервере:

```bash
# Проверка HTTP доступа с Host: autoro.tech
curl -I http://46.250.228.229/api/blog/admin/posts -H 'Host: autoro.tech'

# Проверка HTTP доступа с Host: cdn.autoro.tech
curl -I http://46.250.228.229/api/blog/admin/posts -H 'Host: cdn.autoro.tech'
```

Один из этих запросов должен вернуть ответ (не 503).

---

## Проверка после исправления

После настройки Origin pull protocol = HTTP:

```bash
# Проверка GET запроса
curl -I https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Origin: https://swoop.autoro.tech'

# Должен вернуть 401 Unauthorized (не 503!)
# CORS заголовки должны присутствовать

# Проверка OPTIONS запроса
curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Access-Control-Request-Method: GET'

# Должен вернуть 204 No Content с CORS заголовками
```

---

## Резюме действий

1. ✅ Cloudflare изменен на DNS only (уже сделано)
2. ⚠️ **НУЖНО:** Проверить/изменить Origin pull protocol = HTTP в GCore CDN
3. ⚠️ **НУЖНО:** Проверить Origin group и IP (должен быть `http://46.250.228.229` или `http://autoro.tech`)
4. ✅ Host header = `autoro.tech` (правильно, если nginx-proxy слушает autoro.tech)
5. ✅ CORS настроен правильно
6. ✅ Правило "Bypass API Cache" настроено

**Главное действие:** Убедитесь, что Origin pull protocol = **HTTP** (не HTTPS) в общих настройках GCore CDN ресурса!


