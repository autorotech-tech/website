# Пошаговые инструкции по оптимизации n8n Workflow

## Проблемы
- Workflow отменяется через ~1 минуту (таймаут)
- Multilingual AI Agent работает очень долго (67 секунд)
- Ответ агента обернут в `\`\`\`json` блоки
- Нужно добавить узел "Normalize Agent JSON" между "Multilingual AI Agent" и "Format Links for Web"

---

## Шаг 1: Добавить узел "Normalize Agent JSON"

### 1.1 Откройте workflow
- URL: https://tech.autoro.tech/workflow/CgebhGkDUlrfXmgC
- Логин: seller.mekker2gmail.com
- Пароль: autoro777_TECH

### 1.2 Найдите узел "Multilingual AI Agent"
- В списке узлов слева или на canvas найдите "Multilingual AI Agent"

### 1.3 Добавьте новый узел Code
1. Нажмите на соединение между "Multilingual AI Agent" и "Format Links for Web"
2. Или кликните "+" рядом с "Multilingual AI Agent"
3. В поиске узлов введите "Code"
4. Выберите узел "Code"
5. Назовите его: `Normalize Agent JSON`

### 1.4 Вставьте код в узел
Откройте узел "Normalize Agent JSON" → вкладка "Code" → вставьте:

```javascript
// Normalize Agent JSON → гарантированно массив [{ json: {...} }]
const input = $input.all();
if (!Array.isArray(input) || input.length === 0) {
  return [{ json: { answer: '', contacts: {}, sources: [], detected_language: 'en' } }];
}

const out = [];
for (const item of input) {
  let text = String(item.json?.output ?? item.json?.answer ?? item.json?.text ?? '').trim();
  
  // Убираем ```json, ```, <br>
  text = text.replace(/```json/gi, '').replace(/```/g, '').replace(/<br\s*\/?>/gi, '\n').trim();
  
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { answer: text, contacts: {}, sources: [] };
  }
  
  out.push({
    json: {
      output: data.answer ?? '',
      answer: data.answer ?? '',
      contacts: data.contacts ?? {},
      sources: data.sources ?? [],
      detected_language: item.json?.detected_language ?? item.json?.lang ?? 'en'
    }
  });
}

return out;
```

### 1.5 Подключите узлы
- **Отключите** прямое соединение: "Multilingual AI Agent" → "Format Links for Web"
- **Подключите**: "Multilingual AI Agent" (main) → "Normalize Agent JSON" (main)
- **Подключите**: "Normalize Agent JSON" (main) → "Format Links for Web" (main)

---

## Шаг 2: Оптимизация узла "Multilingual AI Agent"

### 2.1 Откройте настройки узла
- Кликните на узел "Multilingual AI Agent"
- Перейдите на вкладку "Options"

### 2.2 Измените параметры
- **maxIterations**: `2` (уменьшите с 3 до 2)
- **maxExecutionTime**: `40` (уменьшите с 45 до 40 секунд)

---

## Шаг 3: Оптимизация узла "Gemini Chat Model"

### 3.1 Найдите узел "Gemini Chat Model"
- Обычно он подключен к "Multilingual AI Agent" через порт "ai_languageModel"

### 3.2 Измените параметры
- **maxOutputTokens**: `1200` (уменьшите с 2048 до 1200)
- **temperature**: `0.3` (оставьте как есть, если уже 0.3)

---

## Шаг 4: Обновление System Message

### 4.1 Откройте узел "Multilingual AI Agent"
- Перейдите на вкладку "System Message" или "Prompt"

### 4.2 Замените System Message на:

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
    "КРИТИЧЕСКИ ВАЖНО - КОНТАКТЫ И ДАННЫЕ:",
    "1. Используй Базу Знаний для ВСЕХ вопросов о Фукуоке.",
    "2. Если в базе знаний нет информации - НЕ выдумывай контакты, телефоны, email или адреса.",
    "3. Включай в ответ ТОЛЬКО те контакты, ссылки и данные, которые реально есть в результатах поиска в базе знаний.",
    "4. НЕ упоминай телефоны, email, адреса, если их нет в метаданных найденных документов.",
    "5. Контакты могут быть в тексте документа (content) или в метаданных (metadata). Ищи везде.",
    "6. Если в найденных документах есть контакты (Telegram, сайты, телефоны, email) - ОБЯЗАТЕЛЬНО включи их в поле contacts JSON и органично в текст answer.",
    "Формат вывода: ТОЛЬКО JSON без код-блоков: {\"answer\": string, \"contacts\": {\"telegram\": string[], \"sites\": string[], \"phones\": string[], \"emails\": string[]}, \"sources\": string[]}",
    "answer: кратко, по делу, списки маркерами «• ». Если в найденных документах есть контакты - включи их в текст answer.",
    "Если точных данных нет — честно скажи; contacts могут быть пустыми только если их действительно нет в БЗ."
  ]
}
```

---

## Шаг 5: Сохранение и активация

1. Нажмите **"Save"** (или Ctrl+S / Cmd+S)
2. Убедитесь, что workflow активен (переключатель "Active" включен в правом верхнем углу)

---

## Ожидаемый результат

- ✅ Время выполнения: **15-30 секунд** (вместо 60+)
- ✅ Ответы: полные, без обрезки, без персонификации
- ✅ Контакты: в контексте вопроса
- ✅ Формат: чистый JSON без `\`\`\`json` блоков

---

## Проверка

После применения правок:
1. Откройте https://pquoc.com
2. Отправьте тестовый вопрос: "What tours are available on Phu Quoc?"
3. Проверьте время ответа в n8n Executions
4. Проверьте формат ответа (не должно быть `\`\`\`json`)

