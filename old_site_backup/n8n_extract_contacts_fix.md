# Исправление: Извлечение контактов из БЗ

## Проблема
Контакты из Базы Знаний не извлекаются и не передаются в ответ агента. Контакты должны извлекаться из документов БЗ и передаваться в контекст агента.

## Решение: Добавить узел для извлечения контактов

### 1. Добавить узел "Extract Contacts from KB" после "Answer questions with a vector store"

**Местоположение**: После "Answer questions with a vector store", перед "Multilingual AI Agent"

**Шаги**:
1. Найдите узел "Answer questions with a vector store"
2. Кликните на соединение между "Answer questions with a vector store" и "Multilingual AI Agent"
3. Выберите "Add Node" или нажмите "+"
4. Найдите узел "Code" в поиске
5. Назовите его: `Extract Contacts from KB`

**Код для узла**:
```javascript
// Extract Contacts from KB → извлекаем контакты из документов БЗ
const input = $input.all();
const contacts = {
  telegram: [],
  sites: [],
  phones: [],
  emails: []
};

// Собираем контакты из всех найденных документов
for (const item of input) {
  const doc = item.json;
  
  // Ищем контакты в разных полях документа
  const text = String(doc.content || doc.pageContent || doc.text || doc.output || '').toLowerCase();
  
  // Извлекаем телефоны (форматы: +84..., 0123..., (84)..., tel:...)
  const phoneMatches = text.match(/(?:tel|phone|телефон)[\s:]*([+]?[\d\s\-()]{8,})/gi);
  if (phoneMatches) {
    phoneMatches.forEach(match => {
      const phone = match.replace(/(?:tel|phone|телефон)[\s:]*/i, '').trim();
      if (phone && !contacts.phones.includes(phone)) {
        contacts.phones.push(phone);
      }
    });
  }
  
  // Извлекаем email
  const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emailMatches) {
    emailMatches.forEach(email => {
      if (!contacts.emails.includes(email)) {
        contacts.emails.push(email);
      }
    });
  }
  
  // Извлекаем telegram (t.me/..., @..., telegram:...)
  const telegramMatches = text.match(/(?:t\.me\/|@|telegram[:/])\s*([a-zA-Z0-9_]+)/g);
  if (telegramMatches) {
    telegramMatches.forEach(match => {
      const tg = match.replace(/(?:t\.me\/|@|telegram[:/])\s*/i, '').trim();
      if (tg && !contacts.telegram.includes(tg)) {
        contacts.telegram.push(tg);
      }
    });
  }
  
  // Извлекаем сайты (http://..., https://...)
  const siteMatches = text.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g);
  if (siteMatches) {
    siteMatches.forEach(site => {
      const cleanSite = site.replace(/[.,;!?]+$/, '').trim();
      if (cleanSite && !contacts.sites.includes(cleanSite)) {
        contacts.sites.push(cleanSite);
      }
    });
  }
  
  // Проверяем структурированные данные (если контакты уже в JSON формате)
  if (doc.contacts) {
    if (doc.contacts.telegram) contacts.telegram.push(...doc.contacts.telegram.filter(t => !contacts.telegram.includes(t)));
    if (doc.contacts.sites) contacts.sites.push(...doc.contacts.sites.filter(s => !contacts.sites.includes(s)));
    if (doc.contacts.phones) contacts.phones.push(...doc.contacts.phones.filter(p => !contacts.phones.includes(p)));
    if (doc.contacts.emails) contacts.emails.push(...doc.contacts.emails.filter(e => !contacts.emails.includes(e)));
  }
}

// Передаем исходные данные + извлеченные контакты
const out = [];
for (const item of input) {
  out.push({
    json: {
      ...item.json,
      extracted_contacts: contacts,
      // Добавляем контакты в контекст для агента
      contacts_context: Object.keys(contacts).some(key => contacts[key].length > 0) 
        ? `Найденные контакты в БЗ: ${JSON.stringify(contacts, null, 2)}`
        : ''
    }
  });
}

return out;
```

**Соединения**:
- Input: от "Answer questions with a vector store" (main)
- Output: к "Multilingual AI Agent" (main)

### 2. Обновить System Message для использования извлеченных контактов

**Откройте узел "Multilingual AI Agent"** → вкладка "System Message":

```json
{
  "role": "AI-ассистент-гид по острову Фукуок",
  "task": "Дай полный, конкретный ответ. Сначала используй Базу Знаний.",
  "context": {
    "user_question": "{{ $json.text }}",
    "user_language": "{{ $json.detected_language }}",
    "extracted_contacts": "{{ $json.extracted_contacts }}",
    "contacts_context": "{{ $json.contacts_context }}"
  },
  "instructions": [
    "Язык ответа: СТРОГО {{ $json.detected_language }}.",
    "Запрещена персонификация: пляжи, парки НЕ «советуют».",
    "Полнота: ответ должен быть законченным, не обрезанным.",
    "Контакты: Используй контакты из extracted_contacts. Если contacts_context не пустой - ВСЕГДА включи эти контакты в поле contacts выходного JSON.",
    "Формат вывода: ТОЛЬКО JSON без код-блоков: {\"answer\": string, \"contacts\": {\"telegram\": string[], \"sites\": string[], \"phones\": string[], \"emails\": string[]}, \"sources\": string[]}",
    "answer: кратко, по делу, списки маркерами «• ».",
    "Если точных данных нет — честно скажи; contacts могут быть пустыми только если их действительно нет в БЗ."
  ]
}
```

### 3. Альтернативный вариант: Упрощенное извлечение контактов

Если первый вариант слишком сложный, используйте упрощенную версию:

```javascript
// Extract Contacts from KB (упрощенная версия)
const input = $input.all();
const allContacts = {
  telegram: new Set(),
  sites: new Set(),
  phones: new Set(),
  emails: new Set()
};

// Проходим по всем документам
for (const item of input) {
  const content = String(item.json?.content || item.json?.pageContent || item.json?.text || '').toLowerCase();
  
  // Простой поиск паттернов
  const phoneRegex = /(\+?[\d\s\-()]{8,})/g;
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const telegramRegex = /(?:t\.me\/|@)([a-zA-Z0-9_]+)/g;
  const siteRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
  
  let match;
  while ((match = phoneRegex.exec(content)) !== null) {
    const phone = match[1].trim();
    if (phone.length >= 8) allContacts.phones.add(phone);
  }
  while ((match = emailRegex.exec(content)) !== null) {
    allContacts.emails.add(match[1]);
  }
  while ((match = telegramRegex.exec(content)) !== null) {
    allContacts.telegram.add(match[1]);
  }
  while ((match = siteRegex.exec(content)) !== null) {
    allContacts.sites.add(match[1].replace(/[.,;!?]+$/, ''));
  }
}

// Конвертируем Set в массивы
const contacts = {
  telegram: Array.from(allContacts.telegram),
  sites: Array.from(allContacts.sites),
  phones: Array.from(allContacts.phones),
  emails: Array.from(allContacts.emails)
};

// Передаем дальше
return input.map(item => ({
  json: {
    ...item.json,
    extracted_contacts: contacts
  }
}));
```

## Ожидаемый результат

После добавления узла:
- ✅ Контакты извлекаются из документов БЗ
- ✅ Контакты передаются в контекст агента
- ✅ Агент включает контакты в ответ
- ✅ Контакты отображаются в интерфейсе чата

