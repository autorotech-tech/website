# Исправление ошибки памяти в Telegram workflow

## Проблема
```
Paired item data for item from node 'Prepare Memory Context' is unavailable
```

Ошибка возникает потому, что узел **"Simple Memory"** пытается получить `sessionKey` из узла, который не передаёт данные напрямую.

## Решение

### Вариант 1: Исправить sessionKey в Simple Memory (РЕКОМЕНДУЕТСЯ)

В узле **"Simple Memory"** измените:

**Текущее (неправильное):**
```json
"sessionKey": "={{ $('Filter Chat Action Output').item.json.chat_id }}"
```

**Исправленное:**
```json
"sessionKey": "={{ $json.chat_id }}"
```

Это будет работать, потому что данные из "Filter Chat Action Output" передаются в "Multilingual AI Agent", а память получает те же данные через порт `ai_memory`.

### Вариант 2: Исправить поток данных

Если Вариант 1 не работает, измените подключение памяти:

1. **Отключите** "Simple Memory" от "Multilingual AI Agent" (удалите связь)
2. **Подключите** "Simple Memory" напрямую к выходу "Filter Chat Action Output":
   - От "Filter Chat Action Output" → порт `main` → к "Simple Memory" → порт `main`
   - Затем от "Simple Memory" → порт `ai_memory` → к "Multilingual AI Agent" → порт `ai_memory`
3. В "Simple Memory" используйте: `sessionKey: "={{ $json.chat_id }}"`

### Вариант 3: Использовать данные из Prepare Memory Context

Если данные уже подготовлены в "Prepare Memory Context", убедитесь, что они передаются через весь поток:

1. В "Prepare Memory Context" данные должны содержать `chat_id`
2. В "Filter Chat Action Output" проверьте, что `chat_id` сохраняется
3. В "Simple Memory" используйте: `sessionKey: "={{ $json.chat_id }}"`

## Проверка потока данных

Правильная последовательность для Telegram workflow:
```
Telegram Trigger 
  → Extract Message Data 
  → Merge (с Detect Language)
  → Process & Combine Data (ИСПРАВИТЬ ОПЕЧАТКУ!)
  → Prepare Memory Context
  → Filter Chat Action Output
  → Multilingual AI Agent (с Memory через ai_memory)
  → Format response
  → Send Telegram Response
```

## Важные замечания

1. **Опечатка в Process & Combine Data** всё ещё должна быть исправлена:
   ```json
   "platform": "=}{{ ... }}"  →  "platform": "={{ ... }}"
   ```

2. **Simple Memory** должен быть подключён к агенту через порт `ai_memory`, а не `main`

3. **SessionKey** должен использовать данные из текущего узла (`$json.chat_id`), а не ссылаться на другой узел через `$('Filter Chat Action Output')`

## Тестирование

После исправления:
1. Сохраните workflow
2. Отправьте тестовое сообщение в Telegram
3. Проверьте, что ошибка исчезла
4. Проверьте память: отправьте два сообщения подряд и убедитесь, что контекст сохраняется

