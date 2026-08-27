# Swoop / Autoro — каталог сервисов и API

Живая инвентаризация сервисов Swoop (swoop.autoro.tech), публичного каталога (autoro.tech) и agent-api endpoints для разработки.

Источник карточек на главной: [`landing/services-catalog.json`](../landing/services-catalog.json).

---

## Платформа: Autoro Multi-Agent API

| Компонент | Описание |
|-----------|----------|
| **agent-api** | FastAPI на `https://swoop.autoro.tech/api/v1/` |
| **LLM routing** | `service_settings.agent_llm_routing` — тиры `general`, `fast`, `code`, `reasoning`, `vision`, `fallback` |
| **Key pools** | `glm_keys`, `gemini_keys`, `openrouter_keys`, `openmodel_keys`, … + health `/api/v1/admin/key-health` |
| **Workers** | scrapling-worker, deep-search-worker, marketing-audit-processor |

### Основные API endpoints

| Endpoint | Назначение |
|----------|------------|
| `GET /api/v1/health` | Health check |
| `POST /api/v1/chat/completions` | OpenAI-compatible LLM (tier routing) |
| `POST /api/v1/scrape` | Web scraping jobs (X-API-Key: `agent_api_key`) |
| `GET/POST /api/deep-search` | Deep research |
| `GET/POST /api/v1/expired-domains` | Expired domains search |
| `GET/PUT /api/v1/findefender/*` | FinDefender (банкротство): settings + KB proxy |
| `GET /api/v1/admin/key-health` | Provider key health |
| `GET /api/v1/admin/provider-catalog` | LLM model catalogs |

Auth для admin endpoints: header `X-API-Key` = `service_settings.agent_api_key`.

---

## Сервисы Swoop

### Marketing Audit — Live

- **Admin:** `/admin/marketing-audit`
- **User:** `/`, `/task/:id`
- **Теги:** `analytics`, `RAG`, `ads`
- **Возможности:** Google/Meta/TikTok/Yandex/GA4; CSV/XLSX/PDF/DOC/Sheets; vector RAG; multi-LLM
- **Backend:** `marketing-audit-processor/`, таблицы `tasks`, `marketing_audit_jobs`, `marketing_audit_vectors`

### Chat Agent — Live

- **Admin:** `/admin/chat-agent`
- **User:** `/chat-agent`
- **Теги:** `chat`, `n8n`, `embed`
- **Возможности:** client→bot→domains; embed widget; n8n webhooks; KB roles
- **Backend:** `chat-gateway/`, `chat-indexer/`

### Blog Generation — Beta

- **Admin:** `/admin/blog`
- **Теги:** `content`, `SEO`, `LLM`
- **Возможности:** AI post generation; SEO meta; featured images; blog API `/api/blog`
- **Note:** UI в разработке (`BlogAdmin.tsx`)

### Social Crossposting — Planned

- **Admin:** `/admin/social-crossposting`
- **Теги:** `social`, `crosspost`
- **Возможности:** X, Threads, Instagram, LinkedIn, Facebook; Postproxy/Late API; blog→social pipeline

### Web Scraping (Stealth) — Live

- **Admin:** `/admin/web-scraping`
- **Теги:** `scrapling`, `stealth`, `gologin`
- **Режимы:** `fetcher`, `stealth`, `dynamic`, `gologin`
- **Job types:** single, batch, crawl
- **API:** `POST /api/v1/scrape` (ключ `AUTORO_SCRAPE_API_KEY` / `agent_api_key`)
- **Backend:** `scrapling-worker/`, `scrapling_jobs`

### Deep Search — Live

- **Admin:** `/admin/deep-search` (native), `/admin/perplexica` (legacy iframe)
- **Теги:** `research`, `citations`, `perplexity-level`
- **Источники:** arxiv, wikipedia, news, brave, searxng, web
- **API:** `/api/deep-search`
- **Backend:** `deep-search-worker/`, `deep_search_history`

### FinDefender (банкротство) — Live

- **Admin:** `/admin/findefender`
- **Telegram:** `@FinDefender_bot`, HITL `@findefender`
- **Теги:** `Telegram`, `RAG`, `qualification`
- **Settings:** `service_settings.findefender_*` (api_base, tokens masked, HITL group, APP_PUBLIC_URL)
- **API (agent-api proxy):** `GET/PUT /api/v1/findefender/settings`, `GET /health|/status`, `GET/POST /kb/*`
- **Bot upstream:** FinDefender FastAPI `/admin/status`, `/admin/kb/sources|ingest|upload|sync-files` (auth = `SWOOP_API_KEY`)
- **Repo:** sibling `FinDefender/` (не в website monorepo)

### Expired Domains — Live

- **Admin:** `/admin/expired-domains`
- **Теги:** `SEO`, `domains`, `scoring`
- **Scoring:** keyword, theme, spam, authority, seo_prospect, business
- **API:** `/api/v1/expired-domains`
- **Credentials:** Settings → ExpiredDomains.net

### Keept — Live

- **Product:** [keept.me](https://keept.me)
- **Admin:** `/keept/admin`, ops `/admin/bookmarks-bro`
- **User app:** `/bookmarks-bro`
- **Теги:** `KB`, `bookmarks`, `RAG`
- **Возможности:** browser extension sync (Chrome/Edge/Brave/Opera/Firefox); Telegram capture; RAG; moderation queue
- **Extension:** `extensions/bookmarks-bro/` (manifest `0.3.3`, zip `bookmarks-bro-0.3.3.zip`)
- **Docs:** `docs/bookmarks-bro/`, `extensions/bookmarks-bro/INSTALL.md`

### DeerFlow (Research) — Live

- **URL:** `http://46.250.228.229:2026` (env: `VITE_DEERFLOW_URL`)
- **Теги:** `multi-agent`, `research`
- **Sync:** `deploy/deer-flow-swoop-sync/` — ключи из `service_settings` по systemd timer

---

## LLM providers (agent-api routing)

| Provider | Keys column | Default model (typical) |
|----------|-------------|-------------------------|
| OpenModel.ai | `openmodel_keys` | `deepseek-v4-flash` |
| GLM | `glm_keys` | `glm-4.7` / tier_models |
| Gemini | `gemini_keys` | `gemini-2.5-flash` |
| Groq | `groq_keys` | — |
| OpenAI | `openai_keys` | — |
| OpenRouter | `openrouter_keys` | last resort |
| LMArena | `lmarena_keys` | bridge slug |

Приоритет для `general`/`fast`: OpenModel → Gemini/Groq/GLM → OpenRouter (last).

---

## Деплой

| Что | Команда |
|-----|---------|
| Публичный лендинг autoro.tech | `bash scripts/deploy-autoro-landing.sh` |
| Swoop dashboard + agent-api | `npm run deploy:swoop:full` |

---

## Связанные файлы

- [`docs/autoro-api.md`](./autoro-api.md) — полный каталог Autoro-API, auth, ротация моделей
- [`landing/services-catalog.json`](../landing/services-catalog.json) — карточки для autoro.tech
- [`src/components/Layout.tsx`](../src/components/Layout.tsx) — sidebar nav Swoop
- [`agent-api/swoop_provider_catalog.py`](../agent-api/swoop_provider_catalog.py) — LLM catalogs
- [`DESIGN.md`](../DESIGN.md) — Cursor warm ivory design system
- [`SWOOP_AUTORO_OVERVIEW.md`](../SWOOP_AUTORO_OVERVIEW.md) — обзор стека (частично устарел)
