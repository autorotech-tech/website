# Сценарии тестирования: Telegram Knowledge Ingestion (Phase 2)

Workflow: **Telegram Knowledge Ingestion Phase2 v2** (`k2P2a501x7Lm9QdR`).  
Webhook production: `POST /webhook/telegram-knowledge-ingest`, retry: `POST /webhook/telegram-knowledge-retry`.

## 1. Цель и роли

| Роль | Задача |
|------|--------|
| **QA / разработчик** | Подтвердить приём webhook, прохождение веток, запись в API/Obsidian, очереди retry. |
| **Операции** | Проверить env в контейнере `n8n`, стабильность после рестартов, лимиты таймаутов. |
| **Продукт** | Убедиться, что контент попадает в единую базу знаний (вектор + человекочитаемый слой). |

**Критерий успеха e2e:** HTTP **200** с `{"message":"Workflow was started"}` (режим `onReceived`), в execution узлы **Prepare Input → … → Reliable Sync** завершаются без ошибки (или ожидаемо падают capture/Obsidian с записью в `failedCapture` / `failedObsidian`), в **agent-api** появляется/обновляется запись knowledge, при доступном Obsidian — файл заметки.

---

## 2. Предусловия

- [ ] В n8n активна **одна** версия workflow с путями `telegram-knowledge-ingest` / `telegram-knowledge-retry` (нет дубликатов с тем же path).
- [ ] После рестарта `n8n` подождать стабильный `GET https://<host>/healthz` → **200**, затем пробовать webhook (кратковременные **502/404** допустимы при прогреве).
- [ ] В окружении контейнера заданы (см. `telegram_knowledge_ingestion.env.example`):
  - `TELEGRAM_WEBHOOK_SECRET` (если пусто — секрет не проверяется),
  - `KNOWLEDGE_API_BASE`, `KNOWLEDGE_API_TOKEN`, `KNOWLEDGE_WORKSPACE_ID`,
  - при необходимости: `OBSIDIAN_LOCAL_REST_URL`, `OBSIDIAN_LOCAL_REST_API_KEY`,
  - опционально тюнинг: `KNOWLEDGE_HTTP_TIMEOUT_MS`, `KNOWLEDGE_RETRY_BATCH_CAPTURE`, `KNOWLEDGE_RETRY_BATCH_OBSIDIAN`.
- [ ] Понимание формата тела запроса: n8n кладёт распарсенный JSON POST в **`$json.body`**. В теле HTTP ожидается **объект как у Telegram Update** (поля `message` / `edited_message` / `callback_query` на **верхнем уровне** JSON после парсинга — см. фикстуры в `n8n/workflows/fixtures/telegram-knowledge/`).

---

## 3. Базовые команды

Из корня репозитория:

```bash
# Дымовой тест (секрет из аргумента или TELEGRAM_WEBHOOK_SECRET)
bash n8n/workflows/smoke-test.telegram-knowledge.sh \
  "https://tech.autoro.tech/webhook/telegram-knowledge-ingest" \
  "<TELEGRAM_WEBHOOK_SECRET>"

bash n8n/workflows/retry-sync.telegram-knowledge.sh \
  "https://tech.autoro.tech/webhook/telegram-knowledge-retry"
```

Произвольный JSON (пример с секретом):

```bash
curl -sS -X POST "https://tech.autoro.tech/webhook/telegram-knowledge-ingest" \
  -H "Content-Type: application/json" \
  -H "x-telegram-bot-api-secret-token: <TELEGRAM_WEBHOOK_SECRET>" \
  --data-binary @n8n/workflows/fixtures/telegram-knowledge/tc01_baseline.json
```

---

## 4. Матрица сценариев (запросы и постановка задач)

| ID | Постановка задачи | Вход | Ожидание HTTP | Ожидание в n8n / данных |
|----|-------------------|------|---------------|-------------------------|
| **TC-01** | «Пользователь пересылает ссылку с коротким контекстом в приват боту» | `tc01_baseline.json` + корректный секрет (если включён) | 200, `Workflow was started` | Есть execution; в **Reliable Sync** `sync_result`: при валидном API — `captureOk: true` (или осмысленная ошибка в `captureError`); Obsidian — по доступности. |
| **TC-02** | «Длинное сообщение с переносами строк и одной ссылкой» | `tc02_multiline.json` | 200 | Текст обрезан/сохранён в payload; категория из эвристики; нет падения **Prepare Input**. |
| **TC-03** | «Только текст без URL» | `tc03_no_url.json` | 200 | `sourceUrl` null; capture всё равно с текстом; заметка с пустым url в frontmatter — допустимо. |
| **TC-04** | «Пустое сообщение / нет текста» | `tc04_empty_text.json` | 200 | Ветка **Has Text?** false — цепочка на **Build Payload** не идёт (узлы дальше не выполняются для этого пути); в логах нет необработанного исключения webhook. |
| **TC-05** | «Подделка источника: неверный секрет» | `tc01_baseline.json` + заголовок с **неправильным** токеном при заданном `TELEGRAM_WEBHOOK_SECRET` | 200 | `secret_valid: false`; дальше по графу только «ложная» ветка IF (убедиться в UI, что нет записи в очереди pending для этого апдейта). |
| **TC-06** | «Редактирование сообщения в Telegram» | `tc06_edited_message.json` | 200 | Текст взят из `edited_message.text`; chat_id корректен. |
| **TC-07** | «Нажатие inline-кнопки (callback)» | `tc07_callback.json` | 200 | Текст из `callback_query.data`; проверка `chat_id` из `callback_query.message.chat.id`. |
| **TC-08** | «Повторная обработка очереди ошибок» | Сначала вызвать ingest с **невалидным** `KNOWLEDGE_API_TOKEN` или отключить API, затем `retry-sync.sh` после восстановления токена | 200 на оба | В retry: `retry_summary` с `captureRecovered` / остатками; при большой очереди — за один вызов обрабатывается **батч** (до 25/50), поле `deferredCapture` / `deferredObsidian` > 0 при необходимости. |
| **TC-09** | «Нагрузка: несколько быстрых запросов» | 5–10 раз подряд TC-01 с разным `message_id` / текстом | все 200 | Executions не зависают дольше **executionTimeout** (75 с); нет массового 502 от прокси при нормальной нагрузке. |
| **TC-10** | «Локализация и символы» | `tc10_unicode.json` (emoji, кириллица) | 200 | Корректная запись в capture и markdown без кракозябр (UTF-8). |
| **TC-11** | «Таймауты HTTP» | Временно указать недоступный `KNOWLEDGE_API_BASE` или очень маленький `KNOWLEDGE_HTTP_TIMEOUT_MS` | 200 | `captureOk: false`, запись в `failedCapture`; после фикса конфига — **TC-08** восстанавливает. |
| **TC-12** | «Obsidian недоступен» | Пустой/неверный `OBSIDIAN_LOCAL_REST_API_KEY` или URL | 200 | `obsidianOk: false`, `failedObsidian` пополняется; capture может быть true — данные не «теряются» с точки зрения API. |

---

## 5. Пошаговые сценарии (чек-листы)

### S1 — Первичная приёмка за 15 минут

1. Выполнить **TC-01** через `smoke-test.telegram-knowledge.sh`.
2. В n8n: **Executions** → последний run → проверить **Prepare Input** (`has_text`, `secret_valid`).
3. Проверить **Reliable Sync** → `sync_result` (capture/obsidian).
4. В **agent-api** / БД: наличие `knowledge_item` (или ответ API capture).
5. При настроенном Obsidian: файл по `notePath` / политике именования.

### S2 — Регрессия секрета

1. Убедиться, что `TELEGRAM_WEBHOOK_SECRET` задан в проде.
2. **TC-05** с неверным заголовком — нет побочных записей в knowledge.
3. Повтор **TC-01** с верным заголовком — снова успех.

### S3 — Устойчивость очереди

1. Спровоцировать ошибку capture (**TC-11**).
2. Убедиться, что в static data растёт `failedCapture` (через повторные retry или логи).
3. Вызвать **retry** несколько раз, пока `failedCaptureRemaining` не станет приемлемым; при большой очереди проверить, что счётчики **deferred*** уменьшаются сериями вызовов.

### S4 — После деплоя / рестарта

1. `docker restart n8n` (или эквивалент).
2. Дождаться **healthz** 200.
3. **TC-01**; при 404/502 — подождать 30–60 с и повторить (не считать дефектом единичный отказ в окне прогрева).

---

## 6. Негативные и граничные случаи (кратко)

- Невалидный JSON в теле → ожидаем ошибка на стороне n8n / 4xx по настройке прокси; зафиксировать фактическое поведение.
- Огромный текст (например > 100k символов) → возможен отказ API capture; зафиксировать лимиты продуктом.
- Дубликаты одного контента — идемпотентность по `sha256`/политике **agent-api** (проверить отдельным тест-планом API).

---

## 7. Артефакты

| Файл | Назначение |
|------|------------|
| `smoke-test.telegram-knowledge.sh` | Быстрый e2e с секретом |
| `retry-sync.telegram-knowledge.sh` | Триггер батч-retry |
| `smoke-test.telegram-knowledge.payload.json` | Базовый payload (как TC-01) |
| `fixtures/telegram-knowledge/*.json` | Варианты тел для TC-02–TC-10 |

---

## 8. Критерии выхода из тестирования

- Все обязательные **TC-01, TC-04, TC-05, TC-08, TC-12** выполнены с ожидаемым поведением.
- Нет «вечных» **running** executions дольше **executionTimeout** без объяснения (узкий HTTP, БД n8n, прокси).
- Документированы отклонения (версия n8n, фактический формат `$json` в **Webhook** — при расхождении с фикстурами обновить JSON или документ).
