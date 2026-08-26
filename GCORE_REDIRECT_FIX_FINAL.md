# Исправление редиректов для OPTIONS/POST запросов

## Проблема

1. OPTIONS запросы получают редирект 301, что браузер не может обработать
2. POST запросы для загрузки файлов получают `ERR_TOO_MANY_REDIRECTS`
3. Ранее созданные посты не отображаются в списке

## Причина

GCore CDN имеет правило **"Redirect HTTP to HTTPS"**, которое редиректит все запросы. Это нормально для GET запросов, но для OPTIONS и POST запросов браузер не может следовать редиректам.

## Решение

### Вариант 1: Отключить "Redirect HTTP to HTTPS" в GCore CDN (РЕКОМЕНДУЕТСЯ)

Если весь трафик уже идет через HTTPS, редирект не нужен:

1. В GCore CDN Dashboard:
   - Перейдите в **CDN resource** → `cdn.autoro.tech`
   - В боковом меню: **OPTIONS** → **Access** → **Redirect HTTP to HTTPS**
   - Отключите переключатель (сделайте серым)
   - Сохраните изменения

**Почему это безопасно?**
- Все запросы к `cdn.autoro.tech` уже идут через HTTPS
- Cloudflare установлен на DNS only (не проксирует)
- GCore CDN обрабатывает SSL

### Вариант 2: Использовать правило для исключения API путей

Если нельзя отключить редирект полностью, можно создать правило в GCore CDN, но это зависит от возможностей GCore CDN.

---

## Проверка после исправления

После отключения "Redirect HTTP to HTTPS":

```bash
# OPTIONS должен возвращать 204 сразу, без редиректа
curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/upload \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Access-Control-Request-Method: POST' \
  -v

# Не должно быть Location заголовка
# Должен быть HTTP/2 204
```

---

## Дополнительные проблемы

### Проблема 2: Ранее созданные посты не отображаются

Возможные причины:
1. Проблема с GET запросом `/api/blog/admin/posts`
2. Проблема с фильтрацией данных
3. Проблема с авторизацией

**Проверка:**
```bash
# Проверить GET запрос с токеном
curl https://cdn.autoro.tech/api/blog/admin/posts \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Origin: https://swoop.autoro.tech'

# Должен вернуть список постов
```

### Проблема 3: Файл upload/route.ts отсутствует или пуст

Нужно создать файл `app/api/admin/upload/route.ts` в блоге с обработчиком загрузки файлов.

---

## Итоговые действия

1. ✅ Отключить "Redirect HTTP to HTTPS" в GCore CDN
2. ⚠️ Создать/восстановить файл `upload/route.ts`
3. ⚠️ Проверить, почему посты не отображаются


