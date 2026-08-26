# Исправление зависания узла "Format response"

## Проблема
Workflow зависает на узле "Format response" из-за попытки получить данные из узла `$('Filter Chat Action Output')`, который недоступен в этом контексте.

## Решение 1: Упростить код (РЕКОМЕНДУЕТСЯ)

### Шаг 1: Обновить узел "Format response"

Используйте код из файла `format_response_simple.js`:
- Только форматирование текста
- Без попыток получить `chat_id`

### Шаг 2: Добавить узел "Set chat_id" между Format и Send

После узла **"Format response"** добавьте узел **Set** (название: "Set chat_id"):

**Assignments:**
- `text`: `={{ $json.text }}`
- `chat_id`: `={{ $('Extract Message Data').item.json.chat_id }}`

Это безопасно, так как данные из "Extract Message Data" доступны через весь workflow.

### Шаг 3: Обновить "Send Telegram Response"

В узле **"Send Telegram Response"** используйте:
```json
"chatId": "={{ $json.chat_id }}"
"text": "={{ $json.text }}"
```

## Решение 2: Передать chat_id через поток данных

### Вариант A: Использовать Merge для объединения данных

1. После "Format response" добавьте узел **Merge**
2. **Input 1**: "Format response" (main)
3. **Input 2**: "Extract Message Data" (main) - для получения chat_id
4. В Merge используйте mode: "Append"

### Вариант B: Сохранить chat_id в узле перед Filter

Убедитесь, что `chat_id` сохраняется в узле **"Process & Combine Data"** и передаётся через весь поток до "Format response".

Затем используйте в "Format response":
```js
// Только если chat_id уже есть в данных
return [{ 
  json: { 
    text: text,
    chat_id: $json.chat_id  // Используем из текущего потока
  } 
}];
```

## Решение 3: Исправить ссылку на узел (если данные доступны)

Если данные из "Filter Chat Action Output" действительно должны быть доступны, проверьте:

1. Убедитесь, что поток данных не разорван
2. Используйте правильное имя узла (без пробелов в ID):
```js
// Вместо $('Filter Chat Action Output')
// Используйте точное имя из workflow или ID узла
const chatId = $json.chat_id || $input.item.json.chat_id;
```

## Рекомендуемая структура

```
Multilingual AI Agent
  → Format response (только текст)
  → Set chat_id (добавляем chat_id из Extract Message Data)
  → Send Telegram Response (используем оба поля)
```

## Код для узла "Set chat_id"

**Type**: Set node

**Assignments**:
```json
{
  "assignments": [
    {
      "name": "text",
      "value": "={{ $json.text }}",
      "type": "string"
    },
    {
      "name": "chat_id", 
      "value": "={{ $('Extract Message Data').item.json.chat_id }}",
      "type": "string"
    }
  ]
}
```

Это самое безопасное решение, так как не требует передачи данных через весь поток.

