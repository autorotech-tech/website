# Personal API keys — Swoop agent-api

Пользователи (не только админы) могут получить свой токен для `https://swoop.autoro.tech/api/v1` и вызывать OpenAI-compatible API из Replit / Google AI Studio.

## Auth modes

| Режим | Заголовок | Источник | Scope |
|-------|-----------|----------|--------|
| Service (ops) | `X-API-Key` / `Bearer` | `service_settings.agent_api_key` (`ak_…`) | Admin + public API |
| Personal | `X-API-Key` / `Bearer` | `agent_user_api_keys` (`auk_…`) | Public `/api/v1/*` (chat, models, scrape…); **не** Admin Settings |
| Keept JWT | `Authorization: Bearer` | Bookmarks Bro Supabase | Bookmarks / knowledge |

## Как получить ключ

1. Зарегистрироваться / войти: [swoop.autoro.tech/login?mode=signup](https://swoop.autoro.tech/login?mode=signup)
2. Открыть [Settings → API Keys](https://swoop.autoro.tech/settings) (`/settings`)
3. **Generate** → скопировать `auk_…` (показывается один раз)
4. Отозвать: **Revoke**

API (JWT сессии Swoop):

- `GET /api/v1/account/api-keys`
- `POST /api/v1/account/api-keys` `{ "name": "replit" }` → `{ api_key, … }`
- `DELETE /api/v1/account/api-keys/{id}`

## Использование

```bash
export SWOOP_API_KEY='auk_…'
curl -sS https://swoop.autoro.tech/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SWOOP_API_KEY" \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 5
  }'
```

Также: `Authorization: Bearer $SWOOP_API_KEY`.

Модели: полный формат `provider/model` (см. AGENTS.md / Admin Settings).

### Replit

Secrets: `SWOOP_API_KEY` = `auk_…`. Base URL = `https://swoop.autoro.tech/api/v1` (уже с `/api/v1`, не добавлять второй `/v1`).

### Google AI Studio

Провайдер **Autoro Swoop (autoro-api)** — см. `pquoc.com/replit-voice-consultant/GOOGLE_AI_STUDIO_AUTORO_API_PROMPT_RU.md`. Ключ: персональный с `/settings` (предпочтительно) или сервисный Admin → Scraping Agent (только для операторов).

## Deploy

1. SQL: `migrate_agent_user_api_keys.sql` на Postgres Swoop (или авто-bootstrap `ensure_agent_user_api_keys_schema` при старте agent-api).
2. Redeploy `agent-api` + frontend (website).
3. `SUPABASE_ANON_KEY` / `SUPABASE_URL` уже нужны для JWT на account endpoints.

## Файлы

- `migrate_agent_user_api_keys.sql`
- `agent-api/main.py` — lookup + CRUD
- `src/components/UserSettings.tsx` — UI `/settings`
