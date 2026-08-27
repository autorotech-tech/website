# Оптимизация workflow для сайта + форматирование ссылок

## Задача 1: Оптимизировать память (как в Telegram)

### Шаг 1: Изменить Source for Prompt в Multilingual AI Agent

В узле **"Multilingual AI Agent"** для сайта:

1. Найдите **"Source for Prompt (User Message)"**
2. Измените с **"Define below"** на **"Use Input Data"**
3. В поле **"Prompt (User Message)"** укажите: `={{ $json.text }}`

### Шаг 2: Переместить инструкции в System Message

В узле **"Multilingual AI Agent"** → **Options** → **System Message**:

```
Ты - AI-ассистент для помощи в вопросах о путешествиях на остров Фукуок.

Язык ответа: используй язык пользователя.

КРИТИЧЕСКИ ВАЖНО:
1. Используй Базу Знаний для ВСЕХ вопросов о Фукуоке.
2. Если в базе знаний нет информации - НЕ выдумывай контакты, телефоны, email или адреса.
3. Если база знаний не содержит ответа, скажи честно.
4. Включай в ответ ТОЛЬКО те контакты, ссылки и данные, которые реально есть в базе знаний.
5. Используй историю диалога из памяти для ответов на вопросы о предыдущих сообщениях.

ВСЕГДА включай ссылки и контакты из базы знаний в кликабельном формате:
- Для URL: указывай полный URL (https://example.com)
- Для телефонов: формат +84 XXX XXX XXX
- Для email: формат email@example.com

Если пользователь спрашивает о погоде - используй инструмент Погода с координатами.
Не упоминай инструменты.
Формат: обычный текст. Списки — маркеры «• ». 
Стиль: полезный, точный, дружелюбный, с эмодзи.
```

## Задача 2: Форматирование ссылок в ответах

### Проблема
Сейчас бот возвращает текст без кликабельных ссылок:
```
* **Телеграм-бот** * **Телеграм-канал**
```

### Решение: Добавить узел для форматирования ссылок

Между **"Multilingual AI Agent"** и **"Build Response"** добавьте узел **Code**:

**Название**: "Format Links for Web"

**Код**:
```js
// Форматируем ответ для веб-чата: делаем ссылки кликабельными
let text = $json.output || $json.answer || '';

// Паттерны для поиска ссылок и контактов
const urlPattern = /(https?:\/\/[^\s]+)/gi;
const phonePattern = /(\+?\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,4}[\s-]?\d{1,4})/gi;
const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

// Заменяем URL на кликабельные ссылки
text = text.replace(urlPattern, (url) => {
  const cleanUrl = url.replace(/[.,;:!?]+$/, ''); // Убираем пунктуацию в конце
  return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>`;
});

// Заменяем email на кликабельные ссылки
text = text.replace(emailPattern, (email) => {
  return `<a href="mailto:${email}">${email}</a>`;
});

// Заменяем телефоны на кликабельные ссылки
text = text.replace(phonePattern, (phone) => {
  const cleanPhone = phone.replace(/\s/g, ''); // Убираем пробелы
  return `<a href="tel:${cleanPhone}">${phone}</a>`;
});

// Очищаем форматирование Markdown (если есть)
text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
text = text.replace(/`(.*?)`/g, '<code>$1</code>');

// Нормализуем переносы строк
text = text.replace(/\n/g, '<br>');
text = text.replace(/\n\n/g, '<br><br>');

return [{ json: { formatted_reply: text, original_reply: $json.output || $json.answer } }];
```

### Обновить Build Response

В узле **"Build Response"** используйте отформатированный ответ:

```js
return [{ 
  json: { 
    reply: $json.formatted_reply || $json.original_reply || $json.output || $json.answer || 'Спасибо! Скоро ответим.',
    // Для отладки можно оставить original
    // original: $json.original_reply
  } 
}];
```

## Задача 3: Идентификация сессий пользователей

### Текущая реализация (уже работает)

В файле `chat.js` сессия создаётся так:
```js
const session = localStorage.getItem('autoro_chat_sid') || 
                (()=>{ const id=crypto.randomUUID(); 
                       localStorage.setItem('autoro_chat_sid', id); 
                       return id; })();
```

В узле **"Normalize From Site"** уже используется:
```js
chat_id: `site:${session}`
```

Это создаёт уникальный идентификатор для каждого браузера/устройства.

### Улучшение: Добавить метаданные в память

Для лучшей идентификации можно добавить в узел **"Normalize From Site"**:
```js
// Нормализуем вход с сайта -> единый формат для RAG и логов
const items = $input.all().map(i => {
  const b = i.json.body ?? i.json;
  const session = String(b.session || '');
  
  // Генерируем уникальный chat_id для сайта
  const chatId = `site:${session}`;
  
  return {
    json: {
      // основной текст для RAG
      text: String(b.message || '').slice(0, 2000),
      // единый идентификатор диалога сайта
      chat_id: chatId,
      // платформа
      platform: 'site',
      // язык с сайта
      detected_language: (b.lang || '').slice(0,2),
      // метаданные для идентификации
      session: session,
      session_id: session, // Для памяти
      lang: b.lang,
      tz: b.tz,
      ip: b.ip,
      userAgent: b.userAgent,
    }
  };
});
return items;
```

### Использование session_id в Simple Memory

В узле **"Simple Memory"** убедитесь, что используется:
```json
"sessionKey": "={{ $json.chat_id }}"
```

Это будет `site:${session}` для веб-чата, что уникально идентифицирует каждую сессию.

## Итоговая структура workflow для сайта

```
Webhook
  → Normalize From Site (создаёт chat_id: site:${session})
  → Extract Message Data
  → Detect Language
  → Merge
  → Process & Combine Data
  → Filter Chat Action Output
  → Multilingual AI Agent (Source: Use Input Data, промпт: {{ $json.text }})
    ↑ ai_memory
  Simple Memory (sessionKey: {{ $json.chat_id }})
  → Format Links for Web (новый узел для форматирования)
  → Build Response
  → Respond to Webhook
```

## Обновление chat.js для отображения HTML

В файле `chat.js` нужно обновить функцию `addMsg`, чтобы она поддерживала HTML:

```js
function addMsg(text, me){
  const el = h('div', { class: 'chat-msg '+(me?'user':'bot') });
  if (me) {
    el.textContent = text; // Пользовательские сообщения - только текст
  } else {
    el.innerHTML = text; // Сообщения бота - поддерживаем HTML для ссылок
  }
  scroll.appendChild(el); 
  scroll.scrollTop = scroll.scrollHeight;
  return el;
}
```

Или безопаснее - использовать DOMPurify для санитизации HTML (если доступен).

