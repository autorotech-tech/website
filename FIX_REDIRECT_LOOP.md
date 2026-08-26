# Исправление ERR_TOO_MANY_REDIRECTS

## Проблема

Все запросы к `https://cdn.autoro.tech/api/blog/admin/*` получают `ERR_TOO_MANY_REDIRECTS`:
- GET `/api/blog/admin/posts?page=1&limit=20` → 301 → цикл редиректов
- GET/POST `/api/blog/admin/upload` → 301 → цикл редиректов

## Причина

GCore CDN имеет правило **"Redirect HTTP to HTTPS"**, которое редиректит все запросы. Но поскольку запросы уже идут через HTTPS, это создает цикл редиректов.

## Решение (КРИТИЧНО!)

### Шаг 1: Отключить "Redirect HTTP to HTTPS" в GCore CDN

**Это самое важное действие!**

1. Откройте GCore CDN Dashboard: https://portal.gcore.com
2. Перейдите в **CDN** → **Resources** → `cdn.autoro.tech`
3. В левом меню: **OPTIONS** → **Access** → **Redirect HTTP to HTTPS**
4. **Отключите переключатель** (должен стать серым)
5. Нажмите **"Save changes"** внизу страницы

**Почему это безопасно:**
- ✅ Все запросы к `cdn.autoro.tech` уже идут через HTTPS
- ✅ GCore CDN обрабатывает SSL сертификат
- ✅ Cloudflare установлен на DNS only (не проксирует)
- ✅ Редирект не нужен, так как трафик уже HTTPS

---

### Шаг 2: Проверить другие настройки редиректа

Также проверьте в GCore CDN:

1. **OPTIONS** → **Content** → **Status code**
   - Убедитесь, что не установлен редирект через status code

2. **OPTIONS** → **Rewrite**
   - Убедитесь, что нет правил rewrite, которые создают редиректы

---

### Шаг 3: Проверить работу после исправления

После отключения "Redirect HTTP to HTTPS":

```bash
# GET запрос должен вернуть 401 (без редиректа)
curl -I https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20 \
  -H 'Origin: https://swoop.autoro.tech'

# OPTIONS запрос должен вернуть 204 (без редиректа)
curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/upload \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Access-Control-Request-Method: POST' \
  -v

# Не должно быть Location заголовка!
```

---

## Дополнительные проблемы

### Проблема 2: Файл upload/route.ts отсутствует

Если после исправления редиректа загрузка все еще не работает, нужно создать файл `app/api/admin/upload/route.ts`.

### Проблема 3: Ранее созданные посты не отображаются

После исправления редиректа GET запрос должен работать. Если посты все еще не отображаются:
1. Проверьте токен авторизации
2. Проверьте фильтры (status=draft/published)
3. Проверьте логи Next.js приложения

---

## Срочные действия

1. **НЕМЕДЛЕННО:** Отключите "Redirect HTTP to HTTPS" в GCore CDN
2. Проверьте работу API после исправления
3. Если проблема останется, проверьте логи на сервере

---

## Проверка в браузере

После исправления:
1. Очистите кеш браузера (Ctrl+Shift+R или Cmd+Shift+R)
2. Откройте DevTools → Network
3. Перезагрузите страницу `https://swoop.autoro.tech/admin/blog`
4. Проверьте, что запросы к `/api/blog/admin/posts` возвращают 401 (не 301)
5. Попробуйте загрузить изображение

Если все еще есть редиректы, проверьте:
- Настройки GCore CDN Rules
- Настройки Origin Group
- Логи nginx-proxy на сервере


