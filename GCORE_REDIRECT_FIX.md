# Исправление редиректов для OPTIONS запросов

## Проблема

При загрузке изображений возникает ошибка:
- `ERR_TOO_MANY_REDIRECTS`
- `Redirect is not allowed for a preflight request`

OPTIONS запросы (preflight) получают редирект 301, что браузер не может обработать.

## Причина

В GCore CDN включено правило **"Redirect HTTP to HTTPS"**, которое редиректит все запросы, включая OPTIONS.

## Решение

### Вариант 1: Отключить "Redirect HTTP to HTTPS" (НЕ рекомендуется)

Это может нарушить безопасность сайта.

### Вариант 2: Правило в GCore CDN для исключения OPTIONS (РЕКОМЕНДУЕТСЯ)

В GCore CDN нужно создать правило, которое НЕ редиректит OPTIONS запросы.

**К сожалению, GCore CDN может не поддерживать условные редиректы для OPTIONS.**

### Вариант 3: Обрабатывать OPTIONS на уровне nginx-proxy (РАБОЧЕЕ РЕШЕНИЕ)

Убедиться, что nginx-proxy обрабатывает OPTIONS ДО того, как GCore CDN может сделать редирект.

**НО:** GCore CDN находится ПЕРЕД nginx-proxy, поэтому это не поможет.

### Вариант 4: Проверить настройки GCore CDN "Redirect HTTP to HTTPS"

1. В GCore CDN Dashboard:
   - Перейдите в **CDN resource** → `cdn.autoro.tech`
   - В боковом меню: **OPTIONS** → **Access** → **Redirect HTTP to HTTPS**
   - Проверьте, включено ли это правило

2. Если включено, попробуйте:
   - Отключить для этого ресурса (если весь трафик идет через HTTPS)
   - Или создать правило исключения для `/api/*` путей

### Вариант 5: Использовать HTTPS для Origin (ЛУЧШЕЕ РЕШЕНИЕ)

Настроить nginx-proxy для работы с SSL для `cdn.autoro.tech`, тогда GCore CDN будет делать HTTPS запросы к origin, и редирект не нужен.

Но это требует SSL сертификата на origin сервере.

---

## Временное решение

Проверить, можно ли в GCore CDN отключить "Redirect HTTP to HTTPS" для API путей через правила.

Если нет такой возможности, возможно нужно:
1. Оставить редирект включенным
2. Обрабатывать OPTIONS на стороне приложения (Next.js уже делает это)
3. Надеяться, что GCore CDN правильно обрабатывает preflight запросы

---

## Проверка

После исправления:
```bash
# OPTIONS должен возвращать 204 сразу, без редиректа
curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/upload \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Access-Control-Request-Method: POST' \
  -v

# Не должно быть Location заголовка
```


