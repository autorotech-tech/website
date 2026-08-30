# Исправление ошибки сохранения настроек GCore CDN

## Проблема

При попытке сохранить настройки CDN получаете ошибку:
```json
{
  "message": {
    "options": {
      "query_string_forwarding": {
        "forward_only_keys": ["This field may not be null."],
        "forward_except_keys": ["This field may not be null."]
      }
    }
  }
}
```

## Причина

Поля `forward_only_keys` и `forward_except_keys` в настройках Query String Forwarding не могут быть `null`. Они должны быть либо пустыми массивами `[]`, либо содержать значения.

## Решение

### Вариант 1: Отключить Query String Forwarding (РЕКОМЕНДУЕТСЯ)

Для API блога Query String Forwarding не нужен. Отключите его:

1. В GCore CDN панели перейдите в раздел **HTTP headers** → **Query String Forwarding**
2. Убедитесь, что **"Enable Query String Forwarding"** выключен (серый переключатель)
3. Если он включен, выключите его
4. Попробуйте сохранить настройки

**Почему отключить?**
- Query String Forwarding нужен только для медиа-контента (HLS playlists → .ts segments)
- Для API блога это не требуется
- У вас уже включен "Ignore query string" в Cache, что достаточно

---

### Вариант 2: Правильно настроить Query String Forwarding (если нужно включить)

Если по какой-то причине нужно включить Query String Forwarding:

1. Перейдите в раздел **HTTP headers** → **Query String Forwarding**
2. Включите **"Enable Query String Forwarding"**
3. **ВОАЖНО:** Заполните поля правильно:
   - **Forward from files types:** Оставьте пустым ИЛИ добавьте минимум одно значение (например, `m3u8`)
   - **Forward to files types:** Оставьте пустым ИЛИ добавьте минимум одно значение (например, `ts`)
   - **Forward only keys:** Оставьте пустым (не добавляйте ничего)
   - **Forward except keys:** Оставьте пустым (не добавляйте ничего)

**НО:** Если вы не используете медиа-контент с HLS, лучше просто отключите Query String Forwarding.

---

## Проверка после исправления

1. Убедитесь, что Query String Forwarding отключен
2. Попробуйте сохранить настройки
3. Ошибка 400 должна исчезнуть

---

## Дополнительные рекомендации

После исправления этой ошибки убедитесь, что:

1. ✅ CORS настроен правильно:
   - `https://swoop.autoro.tech` добавлен в allowed origins
   - "Always add the header to response from CDN regardless of response code" включен

2. ✅ Host header настроен правильно:
   - "Custom Host header" = `cdn.autoro.tech` или `autoro.tech`

3. ✅ Правила кэширования настроены:
   - Правило "Bypass API Cache" для `/api/*` активно

4. ✅ Таймауты настроены:
   - Connection timeout: 5 секунд
   - Read timeout: 30 секунд


