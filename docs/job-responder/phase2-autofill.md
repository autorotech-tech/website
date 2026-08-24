# Job Responder - Phase 2: autofill и insert

## Принцип

Human gate: расширение **никогда** не отправляет форму отклика автоматически. Только fill/insert после confirm в side panel.

## Autofill ответов на вопросы

1. Content script собирает `questions[]` (label/placeholder -> input/textarea)
2. `generate` mode=`question_answers` -> JSON `[{question, answer}]`
3. Side panel показывает preview mapping
4. Кнопка «Заполнить поля» -> content script:
   - для каждого вопроса найти field по fuzzy match label
   - `input.value = answer` + dispatch `input`/`change` events
5. Пользователь проверяет и жмет Submit на HH вручную

### Селекторы HH (общие для ru/kz/uz)

- Form fields: `[data-qa="vacancy-response-popup-form-field"]`
- Textareas в popup отклика
- Fallback: `document.querySelectorAll('textarea')` с match по ближайшему label

## Insert cover letter в чат/поле отклика

1. Найти textarea сопроводительного письма:
   - `[data-qa="vacancy-response-popup-form-letter-input"]`
   - `textarea[name*="letter"]`
2. После confirm вставить текст из side panel
3. Не вызывать click на «Откликнуться»

## Риски

- SPA re-render HH сбрасывает поля
- Anti-automation: минимизировать частоту, только по явному действию пользователя
