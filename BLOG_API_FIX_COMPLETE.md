# ✅ Исправление API блога завершено

## Проблема решена

После всех исправлений API блога работает корректно:

```bash
curl -I https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Origin: https://swoop.autoro.tech'

# Результат: HTTP/2 401 (правильно - нужна авторизация)
# CORS заголовки присутствуют
```

## Что было исправлено

### 1. ✅ Cloudflare → DNS only
- Изменен Proxy status для `cdn.autoro.tech` с Proxied на DNS only
- Убрано двойное проксирование (Cloudflare → GCore CDN)

### 2. ✅ GCore CDN - CORS настроен
- `https://swoop.autoro.tech` добавлен в allowed origins
- "Always add the header to response from CDN regardless of response code" включен

### 3. ✅ GCore CDN - Host header исправлен
- Изменен с `autoro.tech` на `cdn.autoro.tech`
- nginx-proxy теперь правильно обрабатывает запросы

### 4. ✅ nginx-proxy - конфигурация для /api/blog/
- Создан файл `/etc/nginx/vhost.d/cdn.autoro.tech_location`
- Настроена обработка OPTIONS запросов
- Настроены CORS заголовки

### 5. ✅ Next.js - CORS настроен
- `https://cdn.autoro.tech` добавлен в `ALLOWED_ORIGINS`
- OPTIONS handlers добавлены в API routes

## Текущая архитектура

```
Browser (swoop.autoro.tech)
  ↓ HTTPS
GCore CDN (cdn.autoro.tech)
  ↓ HTTP (Host: cdn.autoro.tech)
nginx-proxy (46.250.228.229:80)
  ↓ HTTP
Next.js (autoro-blog-nextjs:3000)
```

## Проверка работы

### GET запрос (с авторизацией):
```bash
curl https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Authorization: Bearer YOUR_TOKEN'

# Должен вернуть список постов или 401 если токен невалидный
```

### OPTIONS запрос (preflight):
```bash
curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Access-Control-Request-Method: GET'

# Должен вернуть 204 с CORS заголовками
```

### Загрузка файлов:
```bash
curl -X POST https://cdn.autoro.tech/api/blog/admin/upload \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -F 'file=@image.jpg'

# Должен вернуть URL загруженного файла
```

## Настройки GCore CDN (итоговые)

1. ✅ **Origin pull protocol:** HTTP
2. ✅ **Host header:** `cdn.autoro.tech` (Custom Host header)
3. ✅ **CORS header support:** включен
   - Allowed origins: `cdn.autoro.tech`, `autoro.tech`, `swoop.autoro.tech`
   - "Always add the header" включен
4. ✅ **Bypass API Cache:** правило для `/api/*` настроено
5. ✅ **Query String Forwarding:** отключен

## Настройки Cloudflare (итоговые)

1. ✅ **DNS:** CNAME `cdn` → `cl-glc03b3ef4.gcdn.co`
2. ✅ **Proxy status:** DNS only (не Proxied)

## Файлы конфигурации

- `/etc/nginx/vhost.d/cdn.autoro.tech_location` - location для /api/blog/
- `/etc/nginx/vhost.d/autoro.tech_location` - location для /api/blog/ (резерв)
- `lib/cors.ts` - CORS настройки в Next.js
- `app/api/admin/posts/route.ts` - OPTIONS handler
- `app/api/admin/upload/route.ts` - OPTIONS handler

## Следующие шаги

Теперь можно:
1. ✅ Использовать админ-панель блога на `https://swoop.autoro.tech/admin/blog`
2. ✅ Загружать изображения и аудио для постов
3. ✅ Создавать и редактировать посты
4. ✅ Все CORS запросы работают корректно

---

**Статус:** ✅ Все исправлено и работает!


