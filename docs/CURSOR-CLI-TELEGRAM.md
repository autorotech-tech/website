# Telegram Autoro + Cursor CLI

Команда `/cursor <задача>` в Telegram Personal Assistant (n8n) и в Hermes `@autorotech_bot`.

## Архитектура

```
Telegram /cursor
  → n8n Detect (mode=cursor)  ИЛИ  Hermes /cursor slash
  → POST /api/v1/hermes/run { mode: "cursor" }
  → agent-api `_run_cursor_cli`
  → `/opt/cursor-local/.../cursor-agent --print` (+ CURSOR_API_KEY)
```

На VPS `agent` смонтирован из `~/.local` хоста в контейнер `autoro-agent-api` (`/opt/cursor-local`).

## Быстрый деплой

```bash
export CURSOR_API_KEY='key_...'   # Cursor Dashboard → Integrations / API Keys
bash scripts/setup-cursor-cli-telegram.sh
```

Без `CURSOR_API_KEY` пайплайн отвечает `502 Authentication required` — это ожидаемо.

## Env (agent-api / autoro-dashboard/.env)

| Переменная | Значение |
|---|---|
| `HERMES_ENABLE_CURSOR_CLI` | `1` |
| `HERMES_CURSOR_CLI_CMD` | `"/opt/cursor-local/share/cursor-agent/versions/<ver>/cursor-agent --print --output-format json"` (в кавычках!) |
| `HERMES_CURSOR_WORKSPACE` | `/workspace` (volume на репозиторий) |
| `HERMES_CURSOR_TIMEOUT_SEC` | `240` |
| `CURSOR_API_KEY` | ключ Cursor |

Volumes в compose: host `~/.local` → `/opt/cursor-local`, workspace → `/workspace`.

## Env (n8n)

Прокидываются из `autoro-dashboard/.env` при recreate контейнера n8n:

| Переменная | Значение |
|---|---|
| `HERMES_AGENT_API_URL` | `http://autoro-agent-api:8900/api/v1/hermes/run` |
| `HERMES_AGENT_API_KEY` | `service_settings.agent_api_key` |
| `TELEGRAM_HERMES_USE_AGENT_API` | `1` |

Workflow **Telegram Personal Assistant Memory** должен быть Active.

## Проверка

```bash
curl -sS -X POST "https://swoop.autoro.tech/api/v1/hermes/run" \
  -H "X-API-Key: <agent_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"cursor","prompt":"Reply with exactly: pong","context":{"cursor_mode":"ask"}}'
```

Telegram: `/cursor объясни структуру agent-api/main.py`

## Hermes

После деплоя patches: `/cursor …` в `@autorotech_bot` → тот же API (без LLM).

Скрипты: `scripts/setup-cursor-cli-telegram.sh`, `scripts/cursor-cli-bridge.py` (опциональный HTTP bridge).
