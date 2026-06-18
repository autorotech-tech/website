# agent-api — переменные окружения

Сервис: FastAPI + Uvicorn, порт по умолчанию **8900**. Ключ агента задаётся в Supabase `public.service_settings` (`agent_api_key`), не в env.

## Фронтенд (Vite)

| Переменная | Где задавать | Назначение |
|------------|----------------|------------|
| `VITE_AGENT_API_BASE` | Корень проекта: `.env`, `.env.local`, CI build-args | Пусто или не задано → запросы идут на **`/api/v1`** относительно страницы (удобно за nginx на том же домене). Иначе полный URL, например `http://localhost:8900`. |
| `VITE_AGENT_API_PROXY_TARGET` | Только для **`npm run dev`** (читает `vite.config`) | Куда проксировать `/api/v1` (по умолчанию `http://127.0.0.1:8900`). |

Подробности — в **`.env.example`** в корне репозитория website.

## Supabase Auth (Bookmarks Bro: login / signup / OAuth)

Без этих переменных эндпоинты `POST /api/v1/bookmarks/auth/login`, `signup`, `refresh` и проверка пользователя через Supabase возвращают **503**.

| Переменная | Описание |
|------------|----------|
| `SUPABASE_URL` | Базовый URL GoTrue, например `https://swoop.autoro.tech/supabase` |
| `SUPABASE_ANON_KEY` или `VITE_SUPABASE_ANON_KEY` | Публичный anon key проекта (тот же, что у SPA). Дублирование имён — чтобы подхватить тот же ключ из `.env` фронта. |

В **docker-compose** для `agent-api` они уже проброшены из `.env` хоста — добавьте ключи в `.env` на VPS рядом с compose и выполните `docker-compose build agent-api && docker-compose up -d agent-api`.

### OAuth (Google / Microsoft) в расширении Bookmarks Bro

1. В Supabase Dashboard включите провайдеры **Google** и **Azure** (Microsoft).
2. В **Authentication → URL Configuration** добавьте redirect URL вида  
   `chrome-extension://<ID_расширения>/oauth-callback.html`  
   (ID смотрите в `chrome://extensions` → подробности).
3. Пользователь нажимает «Continue with Google/Microsoft» — после редиректа токены сохраняются в `chrome.storage`.

## PostgreSQL

| Переменная | По умолчанию | Описание |
|------------|----------------|----------|
| `PGHOST` | `supabase-db` | Хост БД |
| `PGPORT` | `5433` | Порт |
| `PGDATABASE` | `postgres` | Имя БД |
| `PGUSER` | `supabase_admin` | Пользователь |
| `PGPASSWORD` | *(в образе)* | Пароль |

## Bookmarks Bro — LLM и эмбеддинги

Ключи для эмбеддингов и чата подхватываются из **`public.service_settings`** (поля `glm_keys`, `openai_keys`, `openrouter_keys`, и т.д.). Дополнительно можно задать **`OPENAI_API_KEY`** в env.

| Переменная | По умолчанию | Описание |
|------------|----------------|----------|
| `BOOKMARKS_VECTOR_DIM` | `1536` | Ожидаемая размерность вектора под колонку `embedding` |
| `BOOKMARKS_AI_ENRICH` | `1` | LLM-сводка в `POST .../bookmarks/enrich/run`: `0` / `false` / `no` / `off` — только локальные эвристики |
| `BOOKMARKS_AI_ENRICH_MAX_CALLS` | `0` | Макс. попыток LLM-сводки за один запрос enrich; **0** = без лимита |
| `BOOKMARKS_GLM_BASE` | BigModel OpenAPI v4 base | База для GLM |
| `BOOKMARKS_GLM_EMBEDDING_MODEL` | `embedding-3` | Модель эмбеддингов GLM |
| `BOOKMARKS_GLM_CHAT_MODEL` | `glm-4-flash` | Чат для JSON / enrich |
| `BOOKMARKS_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI-совместимые эмбеддинги |
| `BOOKMARKS_AI_MODEL` | `gpt-4o-mini` | Чат OpenAI при ключах из списка |
| `BOOKMARKS_OPENAI_API_BASE` | `https://api.openai.com/v1` | |
| `BOOKMARKS_OPENROUTER_API_BASE` | `https://openrouter.ai/api/v1` | |
| `BOOKMARKS_OPENROUTER_REFERER` | *(autoro)* | Заголовок для OpenRouter |
| `BOOKMARKS_OPENROUTER_TITLE` | *(autoro)* | Заголовок для OpenRouter |
| `BOOKMARKS_OPENROUTER_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | |
| `BOOKMARKS_GROQ_BASE` | `https://api.groq.com/openai/v1` | |
| `BOOKMARKS_GROQ_EMBEDDING_MODEL` | зависит от провайдера | |
| `BOOKMARKS_GROQ_CHAT_MODEL` | зависит от провайдера | |
| `BOOKMARKS_GEMINI_EMBEDDING_MODEL` | `text-embedding-004` | REST Gemini |
| `BOOKMARKS_GEMINI_CHAT_MODEL` | `gemini-2.0-flash` | `generateContent` |

## Прочее

| Переменная | Описание |
|------------|----------|
| `LOG_LEVEL` | Уровень логирования |
| `OPENAI_API_KEY` | Fallback для OpenAI-совместимых вызовов, если ключи не заданы в БД |

## Worker и Enrich — тело запроса

`POST /api/v1/bookmarks/worker/run` и `POST /api/v1/bookmarks/enrich/run` принимают:

| Поле | Описание |
|------|----------|
| `max_tasks` | Сколько задач/строк обработать за вызов |
| `workspaceId` | **Опционально.** Если задан числовой id — обрабатываются только закладки этого workspace (рекомендуется для стабильного MVP). |

## Ответ `POST /api/v1/bookmarks/enrich/run`

Помимо `processed` и `requested`:

- `workspaceIdFilter`, `failedBookmarks` (ошибки по отдельным закладкам не рвут весь батч)
- `aiEnrichEnabled`, `hasLlmKeys`
- `maxLlmAttemptsPerRun` — `null`, если лимита нет
- `llmAttempts`, `llmSummaries`, `localSummaries`
- `embeddingsComputed`, `embeddingsMissing`

Ответ worker: поле `workspaceIdFilter` при фильтре.
