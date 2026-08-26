# Добавление памяти диалога в Telegram workflow

## Шаг 1: Добавить Memory node в Langchain Agent

1. Откройте узел **"Multilingual AI Agent"** в Telegram workflow.

2. В разделе **"Memory"** нажмите **"+"** (Add Memory).

3. Выберите **"Buffer Memory"** (или **"Summary Memory"** для длинных диалогов).

4. Настройки Buffer Memory:
   - **Memory Key**: `chat_history` (по умолчанию)
   - **Input Key**: `input` (по умолчанию)
   - **Output Key**: `output` (по умолчанию)

## Шаг 2: Связать Memory с chat_id

Чтобы память была уникальной для каждого пользователя Telegram:

1. Добавьте узел **Code** между **"Process & Combine Data"** и **"Multilingual AI Agent"** (название: **"Prepare Memory Context"**).

2. Код узла:
```js
// Получаем chat_id для идентификации сессии
const chatId = $json.chat_id || '';
const platform = $json.platform || '';

// Если это Telegram - используем chat_id как уникальный идентификатор памяти
// Для сайта - используется session из Normalize From Site

return [{
  json: {
    ...$json,
    // Добавляем идентификатор для памяти
    memory_session_id: platform === 'telegram' ? chatId : `site:${$json.session || ''}`,
    // Сохраняем историю для передачи в агента
    conversation_id: chatId
  }
}];
```

3. В узле **"Multilingual AI Agent"** → **Settings**:
   - **Memory Type**: Buffer Memory
   - **Session Key**: используйте выражение `{{ $json.memory_session_id }}` или `{{ $json.chat_id }}`
   - Это обеспечит уникальную память для каждого пользователя

## Шаг 3: Альтернатива — Session Memory через n8n Variables

Если Buffer Memory не работает как ожидается:

1. Используйте **"Session Memory"** в Langchain Agent.
2. Установите **Session ID** как: `{{ $json.chat_id }}` (для Telegram) или `{{ $json.session }}` (для сайта).
3. Это создаст отдельную сессию памяти для каждого chat_id/session.

## Шаг 4: Проверка

После добавления памяти:
1. Отправьте сообщение в Telegram: "привет, какие туры лучше посетить?"
2. Получите ответ
3. Следующее сообщение: "да, дай данные"
4. Агент должен помнить контекст первого запроса и предоставить контакты

## Примечания

- **Buffer Memory**: Хранит последние N сообщений (ограничен размером)
- **Summary Memory**: Суммаризирует историю для экономии токенов (лучше для длинных диалогов)
- **Session Memory**: Использует n8n переменные для хранения между вызовами (рекомендуется для production)

