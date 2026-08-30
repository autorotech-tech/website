# Решение проблемы загрузки файлов через Core Tunnel

## Проблема

При загрузке аудио файлов через Core Tunnel возникает ошибка. Core Tunnel может блокировать:
- Большие файлы (multipart/form-data)
- POST запросы с файлами
- Или просто не пропускать запросы к autoro.tech

## Решение 1: Отключить Core Tunnel для autoro.tech (РЕКОМЕНДУЕТСЯ)

### В Core Tunnel настрой исключения:

1. Открой Core Tunnel
2. Перейди в **Settings** → **Exclusions** (или **Bypass**)
3. Добавь домены:
   - `*.autoro.tech`
   - `autoro.tech`
   - `swoop.autoro.tech`
   - `api.autoro.tech`

Теперь запросы к autoro.tech будут идти напрямую, минуя Core Tunnel.

---

## Решение 2: Использовать альтернативный домен через CDN

Если Core Tunnel нельзя отключить, используй Bunny CDN (см. `BUNNY_CDN_SETUP.md`):

1. Настрой Bunny CDN Pull Zone
2. Используй новый домен: `autoro-bypass.b-cdn.net`
3. Core Tunnel не будет блокировать этот домен

---

## Решение 3: Временное отключение Core Tunnel

Для загрузки файлов временно отключи Core Tunnel:

1. Открой Core Tunnel
2. Отключи туннель
3. Загрузи файлы
4. Включи туннель обратно

---

## Проверка

После применения решения проверь:

```bash
# В браузере открой DevTools → Network
# Попробуй загрузить аудио файл
# Проверь:
# 1. Запрос OPTIONS должен вернуть 204 с CORS заголовками
# 2. Запрос POST должен вернуть 200 с JSON ответом
# 3. Не должно быть ошибок ERR_PROXY_CONNECTION_FAILED
```

---

## Технические детали

### Текущая конфигурация Nginx:

- ✅ CORS заголовки настроены правильно
- ✅ OPTIONS запросы обрабатываются корректно
- ✅ Rewrite работает: `/api/blog/admin/upload` → `/api/admin/upload`

### Проблема в Core Tunnel:

Core Tunnel может:
- Блокировать большие POST запросы
- Не пропускать multipart/form-data
- Иметь ограничения на размер файлов

**Решение:** Отключи Core Tunnel для `*.autoro.tech` или используй CDN.

