# Администрирование окружения agent-api

## Где что настраивается

| Область | Где менять |
|--------|------------|
| Подключение к Postgres (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) | `.env` сервиса / переменные контейнера `autoro-agent-api` (см. `docker-compose` на VPS) |
| Публичный URL Supabase для клиентов | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Включение agent API, ключ, rate limit | Таблица `public.service_settings` (id=1): `agent_enabled`, `agent_api_key`, `agent_rate_limit` — также доступно из админки Swoop через `service_settings` |
| Ключи LLM / OpenRouter / поиск | `service_settings` в БД (поля `*_keys`, модели OpenRouter) |
| Лимит completion для Hermes / chat completions | `BOOKMARKS_CHAT_MAX_TOKENS` (рекомендуется **8192**; дефолт в коде 1200 даёт ~200 символов на reasoning-моделях) |
| Vision / OCR (`/api/v1/vision/analyze`) | Цепочка `agent_llm_routing.tiers.vision` в Swoop (по умолчанию glm-4v-flash → gemini → openrouter). Переопределение: `BOOKMARKS_GLM_VISION_MODEL`, `BOOKMARKS_GEMINI_CHAT_MODEL`. При сбое — следующая модель в цепочке, затем tier `reasoning`. |
| Закладки / Perplexica | `BOOKMARKS_PERPLEXICA_API_BASE`, `BOOKMARKS_UNAUTHORIZED_*` |
| Шаблон корня Obsidian для KB | `KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT` (по умолчанию `Autoro KB/ws-{workspace_id}`) |
| Запись .md в vault (relay) | По умолчанию `KNOWLEDGE_OBSIDIAN_SYNC=1`: **server** `OBSIDIAN_SYNC_WEBHOOK_URL` → VPS vault; **local** `OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY` или `OBSIDIAN_LOCAL_RELAY_URL` → Mac (`scripts/obsidian-local-relay.sh`). Без второго URL — Syncthing/Obsidian Sync того же vault, что `OBSIDIAN_VAULT_MOUNT` на VPS |
| Basic auth для внутренних маршрутов | `INTERNAL_API_USER`, `INTERNAL_API_PASSWORD` |

После смены переменных окружения — перезапуск контейнера `autoro-agent-api`. После смены полей в `service_settings` перезапуск обычно не обязателен (чтение из БД).

## Отчёт об окружении (без секретов)

`GET /api/v1/admin/environment-report`

- Заголовок: `X-API-Key` — тот же ключ, что для остальных вызовов agent-api (`agent_api_key` в `service_settings`).
- В теле: хост/порт/имя БД, флаги agent, счётчики слотов ключей (без значений), публичный `SUPABASE_URL`, шаблон пути Obsidian, базовые флаги bookmarks и internal API.

Пример:

```bash
curl -sS -H "X-API-Key: YOUR_AGENT_API_KEY" \
  https://swoop.autoro.tech/api/v1/admin/environment-report
```

Публичный путь agent-api в проде: **`https://swoop.autoro.tech/api/v1/`** (см. nginx фронта Swoop).

### Дымовой контроль после деплоя

1. `curl -sS https://swoop.autoro.tech/api/v1/health` → JSON `status: ok`.
2. С валидным ключом: `GET .../admin/environment-report` и `GET .../admin/key-health` → `200`, без утечки значений ключей.
3. Следующий этап продуктового теста: e2e Telegram Knowledge (см. `n8n/workflows/TESTING.telegram-knowledge-ingestion.md`) после импорта актуального workflow и маппинга `chat_id → workspace_id`.

## Ежедневный блок в Telegram (watchdog)

Скрипт `tmp/autoro_healthbot.py` (на сервере — копия вроде `/home/vladx/bin/`): раз в день добавляет секцию **API окружение**, если в env-файле watchdog заданы:

- `AGENT_API_REPORT_URL` — полный URL, например `https://swoop.autoro.tech/api/v1/admin/environment-report`
- `AGENT_API_X_API_KEY` — значение `agent_api_key` (тот же, что в Swoop/БД)

Если переменные не заданы, в отчёте будет строка про пропуск (`skipped (...)`).

## Связанные эндпоинты

- `GET /api/v1/health` — краткая живучесть сервиса.
- `GET /api/v1/admin/key-health` — провайдеры с маскированными ключами и статусами (тот же `X-API-Key`).
