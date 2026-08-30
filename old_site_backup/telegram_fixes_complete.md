# Исправления для Telegram Workflow

## Проблема 1: Нерелевантный ответ с выдуманными контактами

### Решение: Усилить промпт в "Multilingual AI Agent"

Замените промпт на более строгий:

```json
{
  "role": "AI-ассистент",
  "task": "Дай точный ответ, используя ТОЛЬКО инструменты: База Знаний и Погода.",
  "context": {
    "user_question": "{{ $json.text }}",
    "user_language": "{{ $json.detected_language }}"
  },
  "instructions": [
    "Язык ответа: СТРОГО {{ $json.detected_language }}.",
    "КРИТИЧЕСКИ ВАЖНО:",
    "1. Используй Базу Знаний для ВСЕХ вопросов о Фукуоке.",
    "2. Если в базе знаний нет информации - НЕ выдумывай контакты, телефоны, email или адреса.",
    "3. Если база знаний не содержит ответа, скажи честно: 'К сожалению, в моей базе знаний нет информации по вашему запросу. Я могу помочь с [перечисли доступные темы из базы знаний].'",
    "4. Включай в ответ ТОЛЬКО те контакты, ссылки и данные, которые реально есть в результатах поиска в базе знаний.",
    "5. НЕ упоминай телефоны, email, адреса, если их нет в метаданных найденных документов.",
    "Если пользователь спрашивает о погоде - используй инструмент Погода с координатами.",
    "Не упоминай инструменты.",
    "Формат: ТОЛЬКО Telegram HTML (<b>, <i>, <u>, <s>, <a href='...'>, <code>, <pre>).",
    "ЗАПРЕТ: <p>, <ul>, <li>. Абзацы через \\n.",
    "СПИСКИ: \\n• Пункт 1\\n• Пункт 2.",
    "Стиль: полезный, точный, дружелюбный, с эмодзи."
  ]
}
```

## Проблема 2: Ошибка chatId в "Send Telegram Response"

### Решение: Исправить выражение chatId

В узле **"Send Telegram Response"** измените:

**Текущее (неправильное):**
```json
"chatId": "={{ $('Telegram Trigger').item.json.message.chat.id }}"
```

**Исправленное:**
```json
"chatId": "={{ $json.chat_id }}"
```

Или, если `chat_id` сохраняется через весь поток:
```json
"chatId": "={{ $('Format response').item.json.chat_id || $json.chat_id }}"
```

**Лучший вариант:** Передать chat_id через весь поток

1. В узле **"Format response"** добавьте сохранение `chat_id`:
```js
// Код для узла "Format response"
let text = $json.output || $json.answer || '';
// ... (весь код форматирования) ...
return [{ 
  json: { 
    text: text,
    chat_id: $('Filter Chat Action Output').item.json.chat_id || $json.chat_id
  } 
}];
```

2. В узле **"Send Telegram Response"** используйте:
```json
"chatId": "={{ $json.chat_id }}"
"text": "={{ $json.text }}"
```

## Дополнительно: Проверка потока данных

Убедитесь, что `chat_id` проходит через весь workflow:

1. **Extract Message Data** → извлекает `chat_id` из Telegram Trigger ✅
2. **Process & Combine Data** → сохраняет `chat_id` ✅
3. **Prepare Memory Context** → передаёт `chat_id` ✅
4. **Filter Chat Action Output** → передаёт `chat_id` ✅
5. **Format response** → должен сохранить `chat_id` в выходных данных
6. **Send Telegram Response** → использует `$json.chat_id`

## Альтернативное решение (проще)

Если не хотите менять "Format response", используйте в "Send Telegram Response":

```json
"chatId": "={{ $('Extract Message Data').item.json.chat_id }}"
```

Но это может не работать, если данные разъединены. Лучше передавать через весь поток.

## Итоговый код для "Format response"

```js
// Код для узла "Format for Telegram"
let text = $json.output || $json.answer || '';

// Конвертируем экранированные \n в реальные переносы
if (typeof text === 'string' && text.includes('\\n')) {
  text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

// Убираем мусор
text = text.replace(/\u00A0/g, ' ');
text = text.replace(/\r/g, '');
text = text.replace(/[ \t]+\n/g, '\n');
text = text.replace(/\n{3,}/g, '\n\n');

// Удаляем ЗАПРЕЩЕННЫЕ Telegram HTML теги
text = text.replace(/<\/?p[^>]*>/gi, '\n');
text = text.replace(/<\/?ul[^>]*>/gi, '');
text = text.replace(/<\/?li[^>]*>/gi, '\n• ');
text = text.replace(/<\/?div[^>]*>/gi, '');
text = text.replace(/<\/?span[^>]*>/gi, '');

// Нормализуем списки
text = text.replace(/\n\s*[-–—]\s+/g, '\n• ');
text = text.replace(/\n\s*•\s*/g, '\n• ');

// Финальная чистка
text = text.trim();
text = text.replace(/^\s+|\s+$/gm, '');
text = text.replace(/\n{3,}/g, '\n\n');

// ВАЖНО: Сохраняем chat_id для отправки
const chatId = $('Filter Chat Action Output').item.json.chat_id || $json.chat_id;

return [{ 
  json: { 
    text: text,
    chat_id: chatId
  } 
}];
```

