# Настройка Simple Memory для запоминания диалога

## Проблема
Simple Memory не запоминает предыдущие сообщения пользователя.

## Исправления

### 1. КРИТИЧЕСКАЯ ОШИБКА: Опечатка в Simple Memory

В узле **"Simple Memory"** исправьте:

**Текущее (неправильное):**
```json
"sessionKey": "=={{ $json.chat_id }}"
```

**Исправленное:**
```json
"sessionKey": "={{ $json.chat_id }}"
```

Уберите лишний символ `=`.

### 2. КРИТИЧЕСКАЯ ОШИБКА: Опечатка в Process & Combine Data

В узле **"Process & Combine Data"** исправьте:

**Текущее (неправильное):**
```json
"platform": "=={{ $('Extract Message Data').item.json.platform }}"
```

**Исправленное:**
```json
"platform": "={{ $('Extract Message Data').item.json.platform }}"
```

### 3. Настройка параметров Simple Memory

В узле **"Simple Memory"** добавьте/проверьте параметры:

**Session Key Type**: `customKey`
**Session Key**: `={{ $json.chat_id }}`

**Дополнительные параметры (Options):**
- **Memory Key** (если доступно): `history` или оставить по умолчанию
- **Input Key** (если доступно): `input` 
- **Output Key** (если доступно): `output`

### 4. Проверка подключения памяти

Убедитесь, что:
- **"Simple Memory"** подключен к **"Multilingual AI Agent"** через порт `ai_memory` (не `main`)
- Память получает данные из узла, который содержит `chat_id`
- Поток данных: Filter Chat Action Output → Multilingual AI Agent (с памятью)

### 5. Альтернатива: Настройка Buffer Window Size

Если Simple Memory имеет настройку **"Window Size"** (количество сообщений в памяти):

1. Откройте **"Simple Memory"** → Options
2. Найдите **"Return Messages"** или **"Window Size"**
3. Установите значение: `10` (или больше, для более длинной истории)

### 6. Проверка потока данных для памяти

Правильный поток:
```
Extract Message Data → chat_id извлекается ✅
Process & Combine Data → chat_id сохраняется ✅
Prepare Memory Context → chat_id передаётся ✅
Filter Chat Action Output → chat_id должен быть доступен ✅
Multilingual AI Agent → получает память с sessionKey = chat_id
```

## Альтернативное решение: Использовать Postgres Memory

Если Simple Memory всё равно не работает, переключитесь на **Postgres Chat Memory**:

1. Удалите "Simple Memory"
2. Добавьте **"Postgres Chat Memory"** (находится в поиске "memory")
3. Настройте подключение к PostgreSQL
4. Session ID: `={{ $json.chat_id }}`

## Проверка работы памяти

После исправлений:

1. **Сохраните workflow**
2. **Отправьте тестовое сообщение**: "привет, какие туры лучше посетить?"
3. **Получите ответ**
4. **Отправьте второе сообщение**: "какой вопрос я тебе задавал в предыдущем сообщении?"
5. **Бот должен ответить**: "Вы спрашивали о том, какие туры лучше посетить на острове Фукуок."

## Диагностика

Если память всё равно не работает:

1. Проверьте в n8n → Executions → последнее выполнение
2. Посмотрите на узел "Simple Memory" - есть ли там ошибки?
3. Проверьте INPUT узла "Simple Memory" - приходят ли данные с `chat_id`?
4. Проверьте, что `chat_id` одинаковый для обоих сообщений (один и тот же пользователь)

## Важно

- `chat_id` должен быть **уникальным для каждого пользователя Telegram**
- `sessionKey` в памяти должен использовать этот `chat_id`
- Если `chat_id` меняется между сообщениями - память не будет работать

