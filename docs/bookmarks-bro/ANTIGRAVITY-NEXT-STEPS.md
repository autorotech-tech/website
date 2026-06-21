# Antigravity — следующие шаги (после Phase A–D)

**Дата:** 2026-06-20  
**Repos:** [AuthRAG](https://github.com/autorotech-tech/AuthRAG) `bookmarks-bro` · [website](https://github.com/autorotech-tech/website) `main` · ADK `google intensive/keep-it-for-me`

---

## Copy-paste в Antigravity

```
Контекст: Phase A–D завершены. website main @ 5881f06+, AuthRAG bookmarks-bro синхронизирован.
Cursor починил ADK integration test (HITL Event vs RequestInput) — см. патч ниже в keep-it-for-me.

СДЕЛАЙ СЕЙЧАС (приоритет):

1) ADK patch (keep-it-for-me, локально — не в AuthRAG)
   - Файл: app/fast_api_app.py → execute_capture_workflow
   - HITL: искать has_request_input_function_call(Event), state из session_service.get_session
   - Makefile grade: agents-cli eval run --dataset tests/eval/datasets/security-dataset.json --config tests/eval/eval_config.yaml
   - Проверка: npm run keept:adk:test-integration (из AuthRAG или website)

2) Staging QA (после deploy)
   - https://swoop.autoro.tech/keept/admin
   - Login → Moderation Queue → approve capture с PII
   - Settings → Swoop Models catalog

3) Kaggle (Track C)
   - Дополнить docs/bookmarks-bro/KAGGLE-CAPSTONE-KEEPT.md скриншотами admin UI
   - Записать demo 3–5 min по script в документе

4) Cloudflare keept.me (operator + Antigravity docs)
   - Следовать docs/bookmarks-bro/CLOUDFLARE-KEEPT-DNS.md чеклисту
   - nginx шаблон: ops/nginx/keept.me.conf

5) eval grade (GCP)
   - make grade требует GOOGLE_CLOUD_PROJECT + ADC
   - Без GCP: достаточно pytest (7 unit + 11 integration)

НЕ ТРОГАТЬ без согласования:
- BookmarksBroApp.tsx (user app)
- Массовый rename bookmarks-bro
- Ломать monolithic agent-api на staging без тестов moderation API

Sync после правок в website:
  npm run keept:sync-authrag:apply

Документы:
- KEEPT-DEVELOPMENT-STATUS.md — roadmap
- ANTIGRAVITY-KEEPT-ADMIN-CAPSTONE.md — capstone handoff
- ADK-WORKFLOW-HITL.md — граф capture_workflow
```

---

## ADK fix (Cursor) — применить в keep-it-for-me

**Проблема:** ADK 2.0 конвертирует `RequestInput` в `Event` с `adk_request_input` function call.  
Старый код проверял `isinstance(last_event, RequestInput)` → HTTP 500.

**Исправление:** в `execute_capture_workflow`:

1. После `runner.run_async` — `session_service.get_session(...)` для workflow state
2. Искать HITL: `has_request_input_function_call(event)` из `google.adk.workflow.utils._workflow_hitl_utils`
3. Читать `redacted_categories`, `security_route` из session state

**Makefile `grade`:**

```makefile
grade:
	uv run agents-cli eval run --dataset tests/eval/datasets/security-dataset.json --config tests/eval/eval_config.yaml
```

(`agents-cli eval --config` больше не существует в v0.5.0)

---

## Команды (из AuthRAG или website)

```bash
npm run build
npm run bookmarks-bro:smoke
npm run keept:adk:test
npm run keept:adk:test-integration
npm run keept:security:test
npm run keept:adk:playground    # нужен Postgres локально для полного capture
npm run keept:adk:grade          # нужен GCP project
bash scripts/deploy-keept-staging.sh   # только из website
```

**Playground без Postgres:** uvicorn стартует, но capture/moderation queue пишет в БД — поднимите BB Postgres или используйте staging VPS.

---

## Staging manual QA — подробная инструкция (operator)

**URLs после deploy:**  
- App: https://swoop.autoro.tech/bookmarks-bro  
- Admin: https://swoop.autoro.tech/keept/admin  
- API health: https://swoop.autoro.tech/api/v1/health  

**Важно про auth:** `/keept/admin` проверяет только `localStorage.bookmarks_bro_bootstrap_token`. Обычный login на `/login` (Swoop Supabase) **не** записывает этот ключ — нужен шаг bootstrap ниже.

### Шаг 0 — Preflight

```bash
curl -sS https://swoop.autoro.tech/api/v1/health | head -c 200
```

Ожидание: JSON с `"ok": true` (не HTML).

### Шаг 1 — Bootstrap token (браузер)

1. Откройте https://swoop.autoro.tech/bookmarks-bro (можно без полного BB OAuth, если есть API key).
2. DevTools → Console. **Вариант A** — BB Supabase JWT (из Network после OAuth BB, если настроен):

```javascript
const bbJwt = '<BB_SUPABASE_ACCESS_TOKEN>' // из bb-supabase session
const r = await fetch('/api/v1/bookmarks/bootstrap', {
  method: 'POST',
  headers: { Authorization: `Bearer ${bbJwt}` },
})
const d = await r.json()
localStorage.setItem('bookmarks_bro_bootstrap_token', d.accessToken)
localStorage.getItem('bookmarks_bro_bootstrap_token') // не пусто
```

**Вариант B** — operator API key (если JWT недоступен): в Console временно:

```javascript
// moderation API принимает X-API-Key, но gate admin всё равно ждёт bootstrap —
// положите любой валидный bootstrap или выдайте через bootstrap с Bearer BB JWT.
// Альтернатива: curl capture + admin с тем же Bearer ниже.
```

3. Узнайте `workspaceId` (Console на `/bookmarks-bro`):

```javascript
const ws = await fetch('/api/v1/bookmarks/workspaces/ensure', {
  method: 'POST',
  headers: { Authorization: `Bearer ${localStorage.getItem('bookmarks_bro_bootstrap_token')}` },
}).then(r => r.json())
console.log(ws.workspaceId)
```

### Шаг 2 — Capture с PII (curl, надёжнее чем UI)

```bash
export BASE=https://swoop.autoro.tech
export TOKEN="$(node -pe "localStorage" 2>/dev/null)" # или вставьте accessToken вручную
export WS=1   # workspaceId из шага 1

curl -sS -X POST "$BASE/api/v1/knowledge/capture" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"workspaceId\": \"$WS\",
    \"source\": \"manual-qa\",
    \"title\": \"QA PII test\",
    \"text\": \"Contact me at qa.test@example.com or SSN 123-45-6789\",
    \"enrich\": false
  }" | jq .
```

Ожидание JSON:

- `"status": "pending_moderation"`
- `"securityRoute": "human_review"`
- `"redactedCategories"` не пустой (email / ssn)
- `"moderationId"` присутствует

### Шаг 3 — Moderation Queue UI

1. https://swoop.autoro.tech/keept/admin  
2. Если редирект на `/login` — вернитесь к шагу 1 (bootstrap token).  
3. Выберите workspace в селекторе → карточка «QA PII test» в очереди.  
4. Проверьте redacted preview и badges категорий PII.

### Шаг 4 — Approve

1. Нажмите **Approve**.  
2. Карточка исчезает из очереди; KPI «Approved today» +1.  
3. (Опционально) Search в `/bookmarks-bro` по фрагменту title — item появился после embed.

### Шаг 5 — Reject (второй capture)

Повторите шаг 2 с другим title → **Reject** → item не в search, status rejected в API:

```bash
curl -sS "$BASE/api/v1/keept/moderation/items?workspaceId=$WS&status=pending_approval" \
  -H "Authorization: Bearer $TOKEN" | jq '.items | length'
```

### Шаг 6 — Settings

1. `/keept/admin/settings` → таблица моделей Swoop (OpenRouter catalog).  
2. Ожидание: список моделей или понятная ошибка 401/503 (не HTML SPA).

### Troubleshooting

| Симптом | Действие |
|---------|----------|
| Admin → `/login` loop | Нет `bookmarks_bro_bootstrap_token` — шаг 1 |
| Capture 401 | Неверный Bearer / нет membership workspace |
| Capture 200 но не pending | Текст без PII — добавьте email или SSN |
| Queue пустая | Неверный workspaceId; status filter = `pending_approval` |
| API returns HTML | nginx не проксирует `/api/v1` — проверить docker `autoro-agent-api` |

---

## Staging manual QA checklist (кратко)

| # | Шаг | Ожидание |
|---|-----|----------|
| 1 | Bootstrap token + workspaceId | localStorage + ensure |
| 2 | POST `/knowledge/capture` с PII | `pending_moderation` |
| 3 | `/keept/admin` | Moderation Queue, KPI cards |
| 4 | Approve item | Исчезает из queue, searchable |
| 5 | Reject item | rejected, не в search |
| 6 | Settings tab | Provider catalog from Swoop |

---

## Cloudflare (operator)

Cursor не имеет доступа к Cloudflare dashboard. Выполните вручную:

1. Cloudflare → keept.me → DNS (таблица в CLOUDFLARE-KEEPT-DNS.md)
2. SSL/TLS → Full (strict) + Origin Certificate на VPS
3. Supabase BB → Redirect URLs: `app.keept.me`, `admin.keept.me`
4. `.env.production`: `VITE_BOOKMARKS_SUPABASE_URL=https://auth.keept.me`

До go-live — staging URLs выше.
