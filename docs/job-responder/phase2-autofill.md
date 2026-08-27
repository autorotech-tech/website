# Job Responder - Phase 2/5: autofill и insert

## Принцип

Human gate: расширение **никогда** не отправляет форму отклика автоматически. Только fill/insert после confirm в side panel.

## Autofill ответов на вопросы

1. Content script собирает `questions[]` (label/placeholder -> input/textarea)
2. `generate` mode=`question_answers` -> JSON `[{question, answer}]`
3. Side panel показывает preview mapping
4. Кнопка «Заполнить поля» -> confirm (human gate) -> content script (`JR_FILL_FORM_FIELDS`):
   - для каждого вопроса найти field по fuzzy match label
   - `input.value = answer` + dispatch `input`/`change` events
5. Пользователь проверяет и жмет Submit на HH вручную

### Селекторы HH (общие для ru/kz/uz)

- Form fields: `[data-qa="vacancy-response-popup-form-field"]`
- Textareas в popup отклика
- Fallback: `document.querySelectorAll('textarea')` с match по ближайшему label
- Реализация: `extensions/job-responder/content/autofill.js` + platform selectors в `platforms/hh.js`

## Insert cover letter в чат/поле отклика

1. Найти textarea сопроводительного письма:
   - `[data-qa="vacancy-response-popup-form-letter-input"]`
   - `textarea[name*="letter"]`
2. После confirm («Вставить письмо») вставить текст из side panel (`JR_INSERT_LETTER`)
3. Не вызывать click на «Откликнуться»

## Очередь после «Оценить список» (Phase 5)

1. Batch relevance -> чекбоксы топ-карточек
2. «Подготовить к отклику» -> `POST /api/v1/job-responder/outbound/prepare`
3. Очередь в `chrome.storage.local` (`jrOutboundQueue`); открытие вакансии / «В результат» без auto-send

## Риски

- SPA re-render HH сбрасывает поля
- Anti-automation: минимизировать частоту, только по явному действию пользователя
