# Сравнение workflow: Telegram vs Site

## Ключевые отличия

### Telegram Workflow (работает с контактами)

**System Message:**
```
"КРИТИЧЕСКИ ВАЖНО:
1. Используй Базу Знаний для ВСЕХ вопросов о Фукуоке.
2. Если в базе знаний нет информации - НЕ выдумывай контакты...
3. Включай в ответ ТОЛЬКО те контакты, ссылки и данные, которые реально есть в результатах поиска в базе знаний.
4. НЕ упоминай телефоны, email, адреса, если их нет в метаданных найденных документов."
```

**Обработка ответа:**
- Multilingual AI Agent → Format response → Set chat_id → Send Telegram Response
- Нет узлов "Normalize Agent JSON" и "Format Links for Web"
- Агент сам включает контакты в текст ответа

### Site Workflow (НЕ работает с контактами)

**System Message:**
```
"Контакты: В найденных документах БЗ ищи контакты..."
```

**Обработка ответа:**
- Multilingual AI Agent → Normalize Agent JSON → Format Links for Web → Build Response
- Ожидается JSON с полем contacts
- Контакты должны быть в JSON, а не в тексте

## Проблема

В Site workflow:
1. System Message менее четкий про контакты
2. Агент возвращает JSON, но contacts пустые
3. Контакты не извлекаются из метаданных БЗ

## Решение

Обновить System Message в Site workflow, чтобы он был похож на Telegram workflow с явными инструкциями о контактах.

