# Autoro-API (agent-api)

Публичный шлюз Swoop: OpenAI-compatible LLM, скрейпинг, поиск, Keept/RAG, Job Responder, медиа.

| | |
|---|---|
| **Сервис** | FastAPI `agent-api`, контейнер `autoro-agent-api`, порт `8900` за nginx |
| **Публичный base** | `https://swoop.autoro.tech` |
| **API prefix** | `https://swoop.autoro.tech/api/v1` |
| **Алиас OpenAI SDK** | `https://swoop.autoro.tech/v1` (те же `models` и `chat/completions`) |
| **Код** | `agent-api/main.py` и модули `agent-api/swoop_*.py`, `job_responder.py` |
| **Ключи** | Swoop **Admin → Settings** (`service_settings`), не в git |

На лендинге это **AUTORO-API**: авто-выбор модели по тиру, ротация ключей, failover провайдеров.

---

## Ссылки

| Что | URL |
|---|---|
| Dashboard | https://swoop.autoro.tech |
| Регистрация / Google | https://swoop.autoro.tech/login?mode=signup |
| Персональные API-ключи | https://swoop.autoro.tech/settings |
| Admin Settings (ключи + LLM routing) | https://swoop.autoro.tech/admin/settings |
| Якорь LLM routing | https://swoop.autoro.tech/admin/settings#llm-routing |
| Chat Agent (tenant) | https://swoop.autoro.tech/chat-agent |
| Chat Agent admin | https://swoop.autoro.tech/admin/chat-agent |
| Health | https://swoop.autoro.tech/api/v1/health |
| Models (OpenAI list) | https://swoop.autoro.tech/api/v1/models |
| Chat completions | https://swoop.autoro.tech/api/v1/chat/completions |
| OpenAPI / docs (если открыт на контейнере) | `http://127.0.0.1:8900/docs` на VPS |

Смежные гайды: [agent-api-user-keys.md](./agent-api-user-keys.md), [bookmarks-bro/ANTIGRAVITY-SWOOP-API.md](./bookmarks-bro/ANTIGRAVITY-SWOOP-API.md), [job-responder/README.md](./job-responder/README.md), [agent-api/ENV.md](../agent-api/ENV.md), [SWOOP-TOOLS-INVENTORY.md](./SWOOP-TOOLS-INVENTORY.md).

---

## Аутентификация

| Режим | Заголовок | Откуда | Scope |
|---|---|---|---|
| Ops / n8n | `X-API-Key: ak_…` или `Bearer` | Admin → Settings → Scraping Agent (`service_settings.agent_api_key`) | Весь API, включая admin |
| Пользователь | `X-API-Key: auk_…` или `Bearer` | [/settings](https://swoop.autoro.tech/settings) | chat, models, scrape, search; **не** Admin Settings |
| Keept JWT | `Authorization: Bearer <access_token>` | BB Supabase / `POST /api/v1/bookmarks/auth/login` | bookmarks, knowledge, JR resume |
| Internal landings | без ключа / внутренние пути | `/go/`, `/l/`, `/api/internal/*` | трекинг кликов, не публичный LLM |

Если `agent_enabled=false` → **503**. Неверный ключ → **401**.

Получить ops-ключ из репозитория (локально, не печатать в чат): `npm run swoop:scrape-key`.

---

## Ротация модели: как устроен запрос

Два слоя:

1. **Ротация провайдеров (модель в цепочке)** - `service_settings.agent_llm_routing.tiers.*`
2. **Ротация ключей внутри провайдера** - пул `*_keys` + `key_pool_strategy`

Настройка: [Admin → Settings → LLM routing](https://swoop.autoro.tech/admin/settings#llm-routing).

Тиры: `fast` | `general` | `code` | `reasoning` | `vision`.  
Провайдеры шлюза (префикс `model`): `openrouter`, `groq`, `glm`, `openai`, `gemini`, `lmarena`, `mimo`, `kimi`, `openmodel`.

Дефолтная цепочка (если в БД пусто): **glm → openrouter → groq/openai/gemini** (порядок зависит от тира), затем fallback `api_key_groups` и `env_openai`.

Стратегия ключей:

| `key_pool_strategy` | Поведение |
|---|---|
| `fill-first` (дефолт) | Один ключ, пока не ошибка |
| `round-robin` | Следующий ключ на каждый запрос |

Ключи с last_code `401`/`403` и выключенные в health UI пропускаются. Успех/фейл пишется в `key_health`. Failover по HTTP ошибкам провайдера: переход к **следующему ключу**, затем к **следующему шагу цепочки**.

OpenRouter-модель всегда в полном виде: `anthropic/claude-3.7-sonnet` (не короткое `claude-3.7-sonnet`). В поле `model` запроса шлюза это выглядит как `openrouter/anthropic/claude-3.7-sonnet`.

LMArena: `lmarena/<slug-на-bridge>` (не путать с OpenRouter `provider/model`).

### Авто-ротация (рекомендуемый запрос)

Пустой `model` или модель **без** префикса шлюза (`openrouter`/`glm`/…). Тир выбирается эвристикой по тексту последнего сообщения (`_classify_llm_task_tier`: код / reasoning / fast / general).

```bash
export SWOOP_API_KEY='auk_…'   # или ops ak_…
curl -sS https://swoop.autoro.tech/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SWOOP_API_KEY" \
  -d '{
    "model": "",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 32,
    "temperature": 0.35
  }'
```

В ответе смотрите заголовки:

- `X-LLM-Tier` - какой тир сработал
- `X-LLM-Route` - `provider model` фактически использованные

Тело - стандартный OpenAI `chat.completion` (`id`, `choices[0].message`, `model` = resolved).

### Форсировать провайдера, затем failover по цепочке

Если `model` = `<шлюз>/<модель>`, первый шаг - этот провайдер; при ошибке идут остальные шаги тира + fallback (кроме `route_strict` у Job Responder).

```bash
# GLM first, then rest of general/fast chain
curl -sS https://swoop.autoro.tech/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SWOOP_API_KEY" \
  -d '{
    "model": "glm/glm-4-flash",
    "messages": [{"role": "user", "content": "Say OK"}],
    "max_tokens": 20
  }'
```

```bash
# OpenRouter Claude, then failover
curl -sS https://swoop.autoro.tech/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SWOOP_API_KEY" \
  -d '{
    "model": "openrouter/anthropic/claude-3.7-sonnet",
    "messages": [{"role": "user", "content": "Say OK"}],
    "max_tokens": 20
  }'
```

```bash
# Gemini pool
curl -sS https://swoop.autoro.tech/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SWOOP_API_KEY" \
  -d '{
    "model": "gemini/gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Say OK"}],
    "max_tokens": 20
  }'
```

Важно: `google/gemini-2.5-flash` и `anthropic/claude-3.7-sonnet` **не** форсят шлюз (`google` / `anthropic` нет в списке провайдеров). Это уходит в **авто-ротацию**. Чтобы попасть в Gemini/OpenRouter, нужен префикс `gemini/` или `openrouter/`.

`POST /api/v1/chat/completions` **не** читает `X-LLM-Tier`. Тир для этой ручки = эвристика текста или дефолт. `X-LLM-Tier` работает на `POST /api/v1/hermes/run` и части Keept JSON-LLM.

Список доступных id:

```bash
curl -sS https://swoop.autoro.tech/api/v1/models \
  -H "X-API-Key: $SWOOP_API_KEY"
```

Если все ключи/провайдеры исчерпаны → **502** `All keys/providers from Swoop settings exhausted`.

Stream: `"stream": true` → SSE `text/event-stream` (после того как ответ уже собран на сервере).

---

## Каталог функций

Auth в таблицах: **ops** = `ak_…`, **user** = `auk_…` или JWT, **keept** = BB JWT, **any** = ops или user.

### Health, admin, каталоги

| Method | Path | Auth | Назначение |
|---|---|---|---|
| GET | `/api/v1/health` | - | Liveness |
| GET | `/api/v1/account/api-keys` | Swoop JWT | Список персональных ключей (без секрета) |
| POST | `/api/v1/account/api-keys` | Swoop JWT | Создать `auk_…` |
| DELETE | `/api/v1/account/api-keys/{id}` | Swoop JWT | Отозвать |
| GET | `/api/v1/admin/key-health` | ops | Health пулов ключей |
| GET | `/api/v1/admin/provider-catalog` | ops | Каталоги моделей (GLM, OpenRouter, …) |
| GET | `/api/v1/admin/openmodel/status` | ops | OpenModel |
| GET | `/api/v1/admin/serpapi/status` | ops | SerpApi |
| GET | `/api/v1/openrouter/catalog` | ops | Meta OpenRouter |
| POST | `/api/v1/admin/openrouter/refresh` | ops | Обновить каталог OpenRouter |
| GET/POST | `/api/v1/admin/verify-keys` | ops | Пинг провайдеров |
| GET | `/api/v1/admin/environment-report` | ops | Env snapshot |

### LLM и медиа

| Method | Path | Auth | Назначение |
|---|---|---|---|
| GET | `/api/v1/models` и `/v1/models` | any | OpenAI `list` моделей |
| POST | `/api/v1/chat/completions` и `/v1/chat/completions` | any | Routed chat + ротация |
| POST | `/api/v1/hermes/run` | any | Deep research / ask / json; `X-LLM-Tier` |
| POST | `/api/v1/web/search` | any | Tavily / Brave / GLM / DDG, `mode=raw\|hybrid` |
| POST | `/api/v1/web/search/serpapi` | ops | Текстовый SERP через SerpApi |
| POST | `/api/v1/web/search/google-cse` | ops | Google Custom Search |
| POST | `/api/v1/serpapi/engine` | ops | Полный engine (maps reviews, …) |
| GET | `/api/v1/serpapi/keys` | ops | Пул SerpApi для trusted-скриптов |
| POST | `/api/v1/vision/analyze` | any | Vision-тир |
| POST | `/api/v1/social/parse` | any | Парсинг соцссылок |
| POST | `/api/v1/media/transcribe` | any | STT по URL |
| POST | `/api/v1/media/transcribe-upload` | any | STT upload |
| POST | `/api/v1/media/speech` | any | TTS (Gemini / hermes_media) |

Hermes `mode`: `ask` | `research` | `optimize` | `json` | `cursor`.

### Скрейпинг

| Method | Path | Auth | Назначение |
|---|---|---|---|
| POST | `/api/v1/scrape` | any (`X-API-Key` обязателен) | Создать job |
| GET | `/api/v1/scrape/{job_id}` | any | Статус |
| GET | `/api/v1/scrape/{job_id}/download` | any | Скачать результат |

Тело `POST /scrape`:

```json
{
  "url": "https://example.com",
  "urls": ["https://a.example", "https://b.example"],
  "mode": "fetcher",
  "output_format": "markdown",
  "selector": null,
  "ai_prompt": null,
  "crawl_depth": 0,
  "max_pages": 20,
  "template_name": null
}
```

`mode`: `fetcher` | `stealth` | `dynamic` | `gologin`.  
`output_format`: `markdown` | `html` | `text` | `json`.  
Несколько `urls` → batch; `crawl_depth > 0` → crawl. Воркер: `scrapling-worker`.

### Bing Webmaster

| Method | Path | Auth | Назначение |
|---|---|---|---|
| GET | `/api/v1/bing/webmaster/sites` | ops | Сайты |
| GET | `/api/v1/bing/webmaster/query-stats` | ops | Query stats |
| GET | `/api/v1/bing/webmaster/quota` | ops | Квота |
| POST | `/api/v1/bing/webmaster/submit-url` | ops | Submit URL |

### Telegram gateway (Autoro / Keept)

| Method | Path | Auth | Назначение |
|---|---|---|---|
| POST | `/api/v1/telegram/autoro-gateway` | ops | Маршрутизация ассистента |
| POST | `/api/v1/telegram/webhook` | Telegram | Входящий webhook |
| POST | `/api/v1/telegram/webhook/setup` | ops | setWebhook |
| POST | `/api/v1/telegram/webhook/setup/autoro-gateway` | ops | Setup Autoro gateway |
| POST | `/api/v1/keept/telegram/link-code` | keept | 6-символьный код привязки |
| POST | `/api/v1/keept/telegram/complete-link` | ops | Завершить привязку |
| GET | `/api/v1/keept/telegram/resolve` | ops | chat_id → workspace |
| GET | `/api/v1/keept/telegram/status` | keept | Статус |
| DELETE | `/api/v1/keept/telegram/unlink` | keept | Отвязать |
| POST | `/api/v1/keept/telegram/bot-token` | keept | Свой BotFather token |
| GET | `/api/v1/keept/moderation/items` | ops | Очередь модерации |
| POST | `/api/v1/keept/moderation/resolve` | ops | Резолв |

Отдельный продукт Chat Agent (виджет/Telegram RAG) живёт на **chat-gateway** `https://chat.autoro.tech`, не в этом файле. LLM для него всё равно ходит сюда: `POST /api/v1/chat/completions`.

### Keept: auth, библиотека, knowledge

| Method | Path | Auth | Назначение |
|---|---|---|---|
| POST | `/api/v1/bookmarks/auth/signup` | - | Регистрация BB |
| POST | `/api/v1/bookmarks/auth/login` | - | Логин |
| POST | `/api/v1/bookmarks/auth/refresh` | - | Refresh |
| POST | `/api/v1/bookmarks/bootstrap` | Bearer / rate-limit | Extension token |
| GET | `/api/v1/bookmarks/workspaces` | keept / ops | Список workspace |
| POST | `/api/v1/bookmarks/workspaces/ensure` | keept | Default workspace |
| POST | `/api/v1/bookmarks/sync/start` | keept / ops | Sync job |
| GET | `/api/v1/bookmarks/sync/jobs/{id}` | keept / ops | Статус sync |
| POST | `/api/v1/bookmarks/capture` | keept / ops | Capture URL |
| GET | `/api/v1/bookmarks/library` | keept | Библиотека |
| GET | `/api/v1/bookmarks/library/facets` | keept | Facets |
| POST | `/api/v1/bookmarks/search` | keept | Семантический поиск |
| POST | `/api/v1/bookmarks/pipeline/run` | ops | Полный pipeline |
| POST | `/api/v1/bookmarks/worker/run` | ops | Тик воркера |
| POST | `/api/v1/bookmarks/enrich/run` | ops | Batch enrich |
| POST | `/api/v1/bookmarks/ai-recommend` | keept | AI-рекомендации |
| POST | `/api/v1/bookmarks/modify-tags` | keept | Теги |
| GET/PUT | `/api/v1/bookmarks/workspace-ui-state` | keept | UI state |
| GET | `/api/v1/bookmarks/metrics` | ops | Метрики |
| POST | `/api/v1/bookmarks/token-usage/log` | keept / ops | Лог токенов |
| GET | `/api/v1/bookmarks/token-usage` | keept / ops | Usage |
| POST | `/api/v1/knowledge/capture` | keept / ops | Telegram/paste → KB |
| POST | `/api/v1/knowledge/files/enrich` | keept / ops | Enrich файлов |
| POST | `/api/v1/knowledge/extract-and-capture` | keept | URL extract + capture |
| POST | `/api/v1/knowledge/{id}/re-enrich` | ops | Re-enrich |
| POST | `/api/v1/knowledge/sync-obsidian-all` | ops | Sync Obsidian |
| POST | `/api/v1/knowledge/search` | keept | Vector + keyword |
| POST | `/api/v1/knowledge/export` | keept | Экспорт KB |

Тела worker/enrich: `max_tasks`, опционально `workspaceId`. Подробности: [ENV.md](../agent-api/ENV.md).

### Job Responder

Префикс `/api/v1/job-responder`. Auth: Keept JWT (workspace) или ops. Детали: [job-responder/README.md](./job-responder/README.md), маршруты моделей: [job-responder/model-routing.md](./job-responder/model-routing.md).

| Method | Path | Назначение |
|---|---|---|
| GET | `/default-prompt` | Системный промпт отклика |
| GET | `/resume/status` | Статус резюме в KB |
| GET | `/resume/sources` | Источники резюме |
| POST | `/resume/sources/delete` | Удалить источник |
| DELETE | `/resume/sources/{knowledge_item_id}` | Удалить по id |
| POST | `/resume/capture` | Capture резюме |
| POST | `/resume/text-capture` | Текст → KB |
| POST | `/resume/patch` | Патч резюме |
| POST | `/resume/optimize` | Оптимизация под JD |
| POST | `/resume/file-capture` | Файл |
| POST | `/resume/link-capture` | Ссылка |
| POST | `/resume/drive-import` | Google Drive |
| POST | `/resume/search` | Поиск по резюме |
| POST | `/relevance` | Релевантность JD |
| POST | `/relevance/batch` | Batch + CE rerank |
| GET | `/gemini-rag/status` | Gemini File Search |
| POST | `/gemini-rag/sync` | Sync store |
| POST | `/outbound/prepare` | Outbound пакет |
| POST | `/generate` | Сгенерировать отклик (`llm_provider` / `llm_model` в headers) |

### Expired domains

Префикс `/api/v1/expired-domains`, auth ops.

| Method | Path | Назначение |
|---|---|---|
| GET | `/lists` | Каталог списков ExpiredDomains.net |
| GET | `/jobs` | История |
| GET | `/jobs/{job_id}` | Job |
| POST | `/verify-credentials` | Проверка логина member area |
| POST | `/search` | Поиск + scoring |

Креды: Admin Settings → ExpiredDomains.net.

### FinDefender (модуль)

Префикс `/api/v1/findefender` в `swoop_findefender.py`: `GET/PUT /settings`, `GET /health`, `GET /status`, `GET /kb/sources`, `POST /kb/ingest|sync-files|upload`. Admin UI: `/admin/findefender`.

### Internal / affiliate landings

Не для внешних LLM-клиентов.

| Method | Path | Назначение |
|---|---|---|
| GET | `/go/{spot_id}` | Редирект + click id |
| GET | `/l/{slug}` | Лендинг |
| GET | `/api/internal/click/{click_id}` | Клик |
| GET/POST | `/api/internal/landings` | CRUD лендингов |
| PATCH/DELETE | `/api/internal/landings/{id}` | Изменить / удалить |
| POST | `/api/internal/conversion` | Конверсия |

---

## Клиенты (как звать шлюз)

OpenAI SDK / совместимые клиенты:

- `base_url`: `https://swoop.autoro.tech/api/v1` (уже с `/api/v1`, не добавлять второй `/v1`)
- `api_key`: `auk_…` или `ak_…`

Chat Agent gateway: `SWOOP_API_BASE=https://swoop.autoro.tech`, `SWOOP_API_KEY`, модель `CHAT_AGENT_LLM_MODEL` (дефолт `openai/gpt-4o-mini` форсит пул `openai_keys` с моделью `gpt-4o-mini`, затем failover по цепочке). Для Claude через OpenRouter: `openrouter/anthropic/claude-3.7-sonnet`.

pquoc.com / скрипты: сначала Swoop `POST /api/v1/chat/completions` с `X-API-Key` (см. `pquoc.com/scripts/lib/pquoc-llm.mjs`).

Replit / Google AI Studio: [agent-api-user-keys.md](./agent-api-user-keys.md).

---

## Ошибки

| HTTP | Значение |
|---|---|
| 400 | Пустой `messages` / битый JSON / неверный `mode` scrape |
| 401 | Нет или неверный ключ |
| 403 | Workspace не принадлежит пользователю |
| 429 | Rate limit |
| 502 | nginx не достучался до контейнера **или** все LLM-провайдеры исчерпаны |
| 503 | Agent выключен / нет SerpApi keys / нет Supabase для auth |

Ответ: JSON `{ "detail": "..." }`. Заголовки маршрута: `X-LLM-Tier`, `X-LLM-Route`.

---

## Код ротации (ориентиры)

| Функция | Файл | Роль |
|---|---|---|
| `_default_agent_llm_routing` | `agent-api/main.py` | Дефолтные тиры и `tier_models` |
| `_iter_keys_for_llm` | `agent-api/main.py` | Обход ключей пула |
| `openai_chat_completions_generic` | `agent-api/main.py` | Цепочка провайдеров + ключей |
| `chat_completions_openai_compatible` | `agent-api/main.py` | HTTP `/chat/completions` |
| `_classify_llm_task_tier` | `agent-api/main.py` | Авто-тир по тексту |

Известный бэклог: дожать failover всех N ключей на 401/402/403/429/5xx и канонические health id (`openrouter_pool` ↔ `openrouter_keys`). План в vault: `Projects/NEXT Swoop key rotation after chat-agent`.
