# Antigravity — Swoop agent-api для Keept

> **Audience:** Google Antigravity (автономные агенты)  
> **Updated:** 2026-06-19  
> **Base URL (staging):** `https://swoop.autoro.tech`  
> **Service:** `agent-api` (FastAPI, порт 8900 за nginx)

Прочитайте сначала: [ANTIGRAVITY-HANDOFF.md](./ANTIGRAVITY-HANDOFF.md) → [ANTIGRAVITY-SWOOP-KEEPT.md](./ANTIGRAVITY-SWOOP-KEEPT.md).

Keept end-users **не** логинятся в Swoop. Antigravity как оператор/разработчик использует API от имени пользователя (JWT) или с ops-ключом (`X-API-Key`).

---

## 1. Аутентификация

| Режим | Заголовок | Кто | Для чего |
|-------|-----------|-----|----------|
| **Ops / extension bootstrap** | `X-API-Key: <agent_api_key>` | Swoop `service_settings.agent_api_key` | bootstrap, worker, admin, n8n без user JWT |
| **Keept user** | `Authorization: Bearer <BB Supabase access_token>` | BB Supabase Auth | capture, search, workspaces, telegram link |
| **OpenAI-compatible** | `Authorization: Bearer <key>` или `X-API-Key` | клиенты LLM | `/api/v1/chat/completions` |

`agent_api_key` задаётся в Swoop **Admin → Settings**. Не коммитить.

### Получить user JWT (smoke / тест)

```bash
curl -sS -X POST "$BASE/api/v1/bookmarks/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"USER@example.com","password":"***"}' | jq -r .accessToken
```

BB Supabase Auth: `https://swoop.autoro.tech/bb-supabase` (не main Swoop Supabase).

---

## 2. Health & ops

| Method | Path | Auth | Описание |
|--------|------|------|----------|
| `GET` | `/api/v1/health` | — | Liveness |
| `GET` | `/api/v1/admin/key-health` | `X-API-Key` | Статус пулов ключей |
| `GET` | `/api/v1/admin/provider-catalog` | `X-API-Key` | Каталоги моделей (glm, openrouter, …) |
| `GET` | `/api/v1/openrouter/catalog` | `X-API-Key` | OpenRouter meta (341+ моделей) |
| `POST` | `/api/v1/admin/openrouter/refresh` | `X-API-Key` | Принудительный refresh каталога |
| `POST` | `/api/v1/admin/verify-keys` | `X-API-Key` | Пинг всех провайдеров |
| `GET` | `/api/v1/admin/environment-report` | `X-API-Key` | Env snapshot для отладки |

---

## 3. Keept — auth & workspace

| Method | Path | Auth | Body / notes |
|--------|------|------|--------------|
| `POST` | `/api/v1/bookmarks/auth/signup` | — | `{email, password}` |
| `POST` | `/api/v1/bookmarks/auth/login` | — | `{email, password}` |
| `POST` | `/api/v1/bookmarks/auth/refresh` | — | `{refreshToken}` |
| `POST` | `/api/v1/bookmarks/bootstrap` | Bearer user **или** rate-limited | Extension: выдача access token |
| `GET` | `/api/v1/bookmarks/workspaces` | Bearer / API key | Список workspace |
| `POST` | `/api/v1/bookmarks/workspaces/ensure` | Bearer | Создать default workspace при signup |

---

## 4. Keept — bookmarks & library

| Method | Path | Auth | Назначение |
|--------|------|------|------------|
| `POST` | `/api/v1/bookmarks/sync/start` | Bearer / `X-API-Key` | Старт sync job (extension) |
| `GET` | `/api/v1/bookmarks/sync/jobs/{job_id}` | Bearer / `X-API-Key` | Статус sync |
| `POST` | `/api/v1/bookmarks/capture` | Bearer / `X-API-Key` | Быстрый capture URL |
| `GET` | `/api/v1/bookmarks/library` | Bearer | Библиотека с фильтрами |
| `GET` | `/api/v1/bookmarks/library/facets` | Bearer | Facets (tags, category) |
| `POST` | `/api/v1/bookmarks/search` | Bearer | Семантический поиск |
| `POST` | `/api/v1/bookmarks/enrich/run` | `X-API-Key` / ops | Batch enrich (LLM routing) |
| `POST` | `/api/v1/bookmarks/worker/run` | `X-API-Key` | Background worker tick |
| `POST` | `/api/v1/bookmarks/pipeline/run` | `X-API-Key` | Full pipeline |
| `POST` | `/api/v1/bookmarks/ai-recommend` | Bearer | AI ideas / recommendations |
| `POST` | `/api/v1/bookmarks/modify-tags` | Bearer | Bulk tag edit |
| `GET` | `/api/v1/bookmarks/workspace-ui-state` | Bearer | Ideas/reminders snapshot |
| `PUT` | `/api/v1/bookmarks/workspace-ui-state` | Bearer | Save UI state |
| `GET` | `/api/v1/bookmarks/metrics` | `X-API-Key` | Ops metrics |
| `GET` | `/api/v1/bookmarks/token-usage` | Bearer / ops | Token usage log |

---

## 5. Keept — knowledge (RAG)

| Method | Path | Auth | Назначение |
|--------|------|------|------------|
| `POST` | `/api/v1/knowledge/capture` | Bearer / `X-API-Key` | Telegram, paste, n8n → KB |
| `POST` | `/api/v1/knowledge/search` | Bearer | Vector + keyword search |
| `POST` | `/api/v1/knowledge/extract-and-capture` | Bearer | URL extract + capture |
| `POST` | `/api/v1/knowledge/{id}/re-enrich` | ops | Re-run enrich |
| `POST` | `/api/v1/knowledge/sync-obsidian-all` | ops | Obsidian relay sync |
| `POST` | `/api/v1/knowledge/export` | Bearer | Export workspace KB |

**Capture example (n8n / Antigravity):**

```bash
curl -sS -X POST "$BASE/api/v1/knowledge/capture" \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'Content-Type: application/json' \
  -d '{
    "workspaceId": 1,
    "source": "telegram",
    "url": "https://example.com/article",
    "title": "Example",
    "text": "Optional body",
    "enrich": true
  }'
```

---

## 6. Keept — Telegram (Phase 3)

| Method | Path | Auth | Назначение |
|--------|------|------|------------|
| `POST` | `/api/v1/keept/telegram/link-code` | Bearer user | 6-char link code |
| `POST` | `/api/v1/keept/telegram/complete-link` | Bot service / `X-API-Key` | Завершить привязку |
| `GET` | `/api/v1/keept/telegram/status` | Bearer | Статус привязки |
| `GET` | `/api/v1/keept/telegram/resolve` | `X-API-Key` | n8n: chat_id → workspace |
| `DELETE` | `/api/v1/keept/telegram/unlink` | Bearer | Отвязать |
| `POST` | `/api/v1/keept/telegram/bot-token` | Bearer | Tier B: свой BotFather token |

n8n workflow: `n8n/workflows/keept_telegram_assistant.json`

---

## 7. LLM (shared control plane)

| Method | Path | Auth | Назначение |
|--------|------|------|------------|
| `GET` | `/api/v1/models` | Bearer / `X-API-Key` | OpenAI-compatible model list |
| `POST` | `/api/v1/chat/completions` | Bearer / `X-API-Key` | Routed chat (tier + fallback chain) |
| `POST` | `/api/v1/web/search` | Bearer / ops | Tavily / GLM / Brave / DDG |
| `POST` | `/api/v1/vision/analyze` | Bearer / ops | Vision tier chain |
| `POST` | `/api/v1/hermes/run` | ops | Deep research agent |

### LLM routing (Swoop Admin)

Настраивается в **Admin → Settings → LLM routing**:

- **Цепочки** `agent_llm_routing.tiers.{code|fast|general|reasoning|vision}` — ordered fallback.
- **Дефолт Keept/Coding Plan:** `glm` → `openrouter` → остальные.
- **tier_models.glm** / **tier_models.openrouter** — pinned модели per tier.
- **glm_default_model** / **openrouter_default_model** — fallback если model пуст в шаге.

Модели OpenRouter: всегда `<provider>/<model>` (например `anthropic/claude-3.7-sonnet`).

---

## 8. Antigravity workflow

### 8.1 Старт сессии

1. Вставь [ANTIGRAVITY-HANDOFF.md](./ANTIGRAVITY-HANDOFF.md) в чат.
2. Прочитай этот файл для API-контрактов.
3. `/understand src/bookmarksBro agent-api extensions/bookmarks-bro --language en`

### 8.2 Типовые задачи → endpoints

| Задача Antigravity | API |
|--------------------|-----|
| Signup / login flow | `/bookmarks/auth/*`, `/workspaces/ensure` |
| Extension OAuth | `bootstrap`, BB Supabase |
| Capture from Telegram | n8n → `/knowledge/capture` |
| Semantic search UI | `/bookmarks/search`, `/knowledge/search` |
| Enrich backlog | `/bookmarks/enrich/run` (ops key) |
| LLM smoke | `/chat/completions` с tier в routing |
| Telegram link UI | `/keept/telegram/*` |

### 8.3 Smoke (из корня website)

```bash
export AGENT_API_URL=https://swoop.autoro.tech
export BOOKMARKS_AGENT_API_KEY=<from Swoop admin>
npm run bookmarks-bro:smoke
npm run bookmarks-bro:api-test
```

### 8.4 Env для agent-api (Keept slice)

Файл: `ops/bookmarks-bro-supabase/.env.agent-api.bookmarks.example`

Ключевые `BOOKMARKS_*`:

| Variable | Role |
|----------|------|
| `BOOKMARKS_PG_*` | BB Postgres (не main Supabase DB) |
| `BOOKMARKS_SUPABASE_URL` | BB Auth |
| `BOOKMARKS_GLM_BASE` | `https://open.bigmodel.cn/api/paas/v4` |
| `BOOKMARKS_GLM_CHAT_MODEL` | env fallback если нет `glm_default_model` |

---

## 9. Ошибки

| Code | Значение |
|------|----------|
| `401` | Нет/неверный JWT или `X-API-Key` |
| `403` | workspace не принадлежит user |
| `429` | rate limit (bootstrap / agent) |
| `502` | nginx → agent-api недоступен (проверить docker `autoro-agent-api`) |
| `503` | `agent_enabled=false` |

Ответы — JSON `{detail: "..."}`. HTML от Cloudflare не норма.

---

## 10. Sync website → AuthRAG

После milestone в website:

```bash
npm run keept:sync-authrag:apply
```

---

## 11. Copy-paste kickoff (API-focused)

```
Read docs/bookmarks-bro/ANTIGRAVITY-SWOOP-API.md in website monorepo.
Base: https://swoop.autoro.tech/api/v1/
Auth: BB Supabase JWT for user flows; X-API-Key for ops/n8n.
Implement Keept tasks against existing endpoints — do not invent parallel APIs.
LLM: glm primary → openrouter fallback (Swoop Admin routing).
Smoke: npm run bookmarks-bro:smoke
Do not commit secrets.
```
