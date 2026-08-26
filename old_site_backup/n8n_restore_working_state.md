# Восстановление рабочего состояния workflow

## Проблема
Контакты не отображаются в чате. Нужно вернуть рабочее состояние, где контакты передаются текстом в виде кликабельных ссылок.

## Решение

### 1. Исправить System Message в "Multilingual AI Agent"

**Откройте узел "Multilingual AI Agent"** → вкладка **"System Message"** → замените на:

```json
{
  "role": "AI-ассистент-гид по острову Фукуок",
  "task": "Дай полный, конкретный ответ. Сначала используй Базу Знаний.",
  "context": {
    "user_question": "{{ $json.text }}",
    "user_language": "{{ $json.detected_language }}"
  },
  "instructions": [
    "Язык ответа: СТРОГО {{ $json.detected_language }}.",
    "Запрещена персонификация: пляжи, парки НЕ «советуют».",
    "Полнота: ответ должен быть законченным, не обрезанным.",
    "Контакты: включай ТОЛЬКО из БЗ. В контексте вопроса (VinWonders → контакты для билетов VinWonders).",
    "Если вопрос про «где купить/как связаться» — ОБЯЗАТЕЛЬНО верни контакты из метаданных БЗ в тексте ответа как кликабельные ссылки.",
    "Формат вывода: ТОЛЬКО JSON без код-блоков: {\"answer\": string, \"contacts\": {\"telegram\": string[], \"sites\": string[], \"phones\": string[], \"emails\": string[]}, \"sources\": string[]}",
    "answer: кратко, по делу, списки маркерами «• ». Контакты (ссылки, телефоны, email) включай прямо в текст answer как кликабельные ссылки.",
    "Если точных данных нет — честно скажи; contacts могут быть пустыми."
  ]
}
```

**Важно**: Убрать все дублирования и упоминания kb_contacts. Контакты должны быть в тексте answer как кликабельные ссылки.

### 2. Проверить узел "Format Links for Web"

**Откройте узел "Format Links for Web"** → вкладка **"Code"** → убедитесь что код форматирует контакты:

Код должен:
- Принимать `contacts` из предыдущего узла
- Форматировать контакты в текст как кликабельные ссылки (Markdown формат)
- Добавлять их в `formatted_reply`
- Прокидывать `contacts` и `sources` дальше

Пример правильного кода:
```javascript
const items = $input.all();
return items.map(item => {
  const lang = item.json.detected_language || item.json.lang || 'en';
  let text = String(item.json.output || item.json.answer || '').trim();
  const contacts = item.json.contacts || {};
  
  if (!text) {
    return {
      json: {
        formatted_reply: 'Спасибо! Скоро ответим.',
        original_reply: '',
        detected_language: lang,
        contacts,
        sources: item.json.sources || []
      }
    };
  }

  // Форматируем контакты в текст если они есть
  let contactsText = '';
  if (contacts.sites && contacts.sites.length > 0) {
    contactsText += '\n\n**Ссылки:**\n';
    contacts.sites.forEach(site => {
      contactsText += `• [${site}](${site})\n`;
    });
  }
  if (contacts.telegram && contacts.telegram.length > 0) {
    contactsText += '\n**Telegram:**\n';
    contacts.telegram.forEach(tg => {
      contactsText += `• [@${tg}](https://t.me/${tg})\n`;
    });
  }
  if (contacts.phones && contacts.phones.length > 0) {
    contactsText += '\n**Телефоны:**\n';
    contacts.phones.forEach(phone => {
      contactsText += `• [${phone}](tel:${phone.replace(/\s/g, '')})\n`;
    });
  }
  if (contacts.emails && contacts.emails.length > 0) {
    contactsText += '\n**Email:**\n';
    contacts.emails.forEach(email => {
      contactsText += `• [${email}](mailto:${email})\n`;
    });
  }

  // Добавляем контакты к тексту ответа
  if (contactsText) {
    text += contactsText;
  }

  return {
    json: {
      formatted_reply: text,
      original_reply: item.json.output || item.json.answer || '',
      detected_language: lang,
      contacts,
      sources: item.json.sources || []
    }
  };
});
```

### 3. Проверить узел "Answer questions with a vector store"

**Откройте узел "Answer questions with a vector store"**:
- Убедитесь что **description** содержит: "в метаданных есть контакты/ссылки и их нужно возвращать"
- **topK**: `5` (или больше для получения большего количества документов)

### 4. Проверить подключения узлов

Убедитесь что поток данных:
```
[Answer questions with a vector store] → [Multilingual AI Agent]
[Multilingual AI Agent] → [Normalize Agent JSON] → [Format Links for Web] → [Build Response]
```

### 5. Сохранить и протестировать

1. Нажмите **"Save"** (Ctrl+S / Cmd+S)
2. Протестируйте с вопросами:
   - "где купить экскурсии?"
   - "где найти гида?"
   - "контакты VinWonders"
3. Проверьте что контакты отображаются в чате как кликабельные ссылки

## Ожидаемый результат

После исправления:
- ✅ Контакты из БЗ включаются в ответ агента
- ✅ Контакты форматируются как кликабельные ссылки в тексте
- ✅ Контакты отображаются в чате на сайте
- ✅ Нет дублирования в System Message
- ✅ Контакты берутся из метаданных БЗ

