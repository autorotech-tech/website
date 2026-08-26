# Инструкции по оптимизации n8n Workflow для pquoc.com

## 1. Добавить узел "Normalize Agent JSON"

**Местоположение**: После "Multilingual AI Agent", перед "Format Links for Web"

**Шаги**:
1. Откройте workflow в n8n
2. Найдите узел "Multilingual AI Agent"
3. Кликните на соединение (линию) между "Multilingual AI Agent" и "Format Links for Web"
4. Выберите "Add Node" или нажмите "+"
5. Найдите узел "Code" в поиске
6. Назовите его "Normalize Agent JSON"

**Код для узла**:
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

**Соединения**:
- Input: от "Multilingual AI Agent" (main)
- Output: к "Format Links for Web" (main)

## 2. Оптимизация узла "Multilingual AI Agent"

**Откройте настройки узла** → вкладка "Options":

- **maxIterations**: `2` (было 3)
- **maxExecutionTime**: `40` секунд (было 45)

## 3. Оптимизация узла "Gemini Chat Model"

**Откройте настройки узла**:

- **maxOutputTokens**: `1200` (было 2048)
- **temperature**: `0.3` (проверьте текущее значение)

## 4. Оптимизация узла "Answer questions with a vector store"

**Откройте настройки узла**:

- **Limit (topK)**: `7-10` (увеличьте для получения большего количества релевантных документов с контактами)
- **Убедитесь, что узел правильно подключен к Multilingual AI Agent** и передает контекст из БЗ

## 5. Обновление System Message в "Multilingual AI Agent"

**Откройте узел "Multilingual AI Agent"** → вкладка "System Message":

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

## 6. Сохранение workflow

После всех изменений:
1. Нажмите "Save" (Ctrl+S / Cmd+S)
2. Убедитесь, что workflow активен (переключатель "Active" включен)

## Ожидаемый результат

- Время выполнения: 15-30 секунд (вместо 60+)
- Ответы: полные, без обрезки, без персонификации
- Контакты: в контексте вопроса

