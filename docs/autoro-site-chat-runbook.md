# autoro.tech — чат сайта ↔ Telegram bot Autoro

## Архитектура

```
Браузер (autoro.tech)
  POST /api/chat-webhook  ──nginx──► autoro-chat-gateway ──► n8n webhook autoro/chat/site
  GET  /api/chat-poll     ──nginx──► autoro-chat-gateway (poll assistant messages)

n8n Site Chat (autoro.tech):
  site  → уведомление в Telegram admin (#SID:session) + ack пользователю
  telegram (reply) → push-reply → gateway → poll → чат на сайте
```

## Предварительные условия

1. Бот в **Swoop → Chat Agents** с доменом `autoro.tech` и `n8n_webhook_url`.
2. Env на n8n (контейнер):
   - `AUTORO_TELEGRAM_BOT_TOKEN` — токен bot Autoro
   - `AUTORO_TELEGRAM_ADMIN_CHAT_ID` — chat id группы/лички оператора
   - `CHAT_PUSH_SECRET` или `N8N_SHARED_SECRET` — для push-reply
3. Workflow **без Code nodes** (Set + IF + HTTP) — не требует external task runners.
4. `AUTORO_SITE_BOT_ID` — uuid бота (meta tag на сайте + deploy).

## Деплой workflow (VPS)

```bash
cd /home/vladx/projects/autoro.tech/website   # или путь к clone
node scripts/generate-n8n-autoro-site-chat.mjs
export AUTORO_SITE_BOT_ID='<uuid-from-supabase>'
bash scripts/apply-n8n-autoro-site-chat.sh "тест из runbook"
```

## Telegram webhook (операторские ответы)

```bash
curl "https://api.telegram.org/bot${AUTORO_TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://chat.autoro.tech/v1/chat-agent/telegram/webhook?bot_id=${AUTORO_SITE_BOT_ID}"
```

Оператор отвечает **reply** на сообщение с `#SID:…` в Telegram — текст уходит пользователю в веб-чат (poll ~3.5s).

Альтернатива: `/reply <session-uuid> текст ответа`

## Telegram RAG Chat Agent (sales / support)

Мультиарендный inbound живёт в `chat-gateway`, не в n8n Telegram Trigger.

| | |
|---|---|
| Webhook (query) | `POST https://chat.autoro.tech/v1/chat-agent/telegram/webhook?bot_id=<uuid>` |
| Webhook (path) | `POST https://chat.autoro.tech/v1/telegram/webhook/<uuid>` |
| Setup | `POST https://chat.autoro.tech/v1/chat-agent/telegram/setup?bot_id=<uuid>` |

Правила ответа:

- **private** - каждое текстовое сообщение.
- **group/supergroup** - только `@username`, `/cmd@bot` или reply на сообщение бота. Остальное пишется в `chat_messages` без LLM.
- Роль `sales` (Swoop Chat Agents) — логика AskPQuoc (интенты smalltalk/advice/quote/faq/human + CTA). `support` - ответы по KB без воронки.
- Промпты роли задаёт админ Autoro (`/admin/chat-agent`, таблица `chat_agent_role_prompts`). Пусто = дефолт pquoc.com.
- AskPQuoc official UUID (`PQUOC_RAG_BOT_IDS`) по-прежнему идёт в `/internal/ask-phu-quoc` (глобальная KB pquoc).
- Tenant-бот (даже с токеном @AskPQuoc_bot) читает только свою RAG: `match_bot_documents` filter `{bot_id}` / Chroma `chat_agent_{bot_id}`.
- Остальные боты: RAG + Swoop `POST /api/v1/chat/completions`.

Кнопка **Подключить Telegram** в `/chat-agent` и `/admin/chat-agent` вызывает setup (токен уже должен быть в `chat_agents.telegram_bot_token`).

Env gateway: `SWOOP_API_KEY`, `SWOOP_API_BASE`, `CHAT_AGENT_LLM_MODEL` (`openai/gpt-4o-mini`), опционально `TELEGRAM_WEBHOOK_SECRET`, `CHROMA_URL`.

```bash
cd chat-gateway && docker compose build chat-gateway && docker compose up -d chat-gateway
```

## Nginx + фронт

```bash
# nginx.conf на autoro-site (chat proxy уже в репо)
docker cp nginx.conf f67e829e51cf_autoro-site:/etc/nginx/conf.d/default.conf
docker exec f67e829e51cf_autoro-site nginx -t && docker restart f67e829e51cf_autoro-site

# лендинг + chat.js
export AUTORO_SITE_BOT_ID='<uuid>'
bash scripts/deploy-autoro-landing.sh

# пересборка gateway после изменений server.mjs
cd chat-gateway && docker compose build chat-gateway && docker compose up -d chat-gateway
```

## Smoke tests

```bash
# gateway (на VPS)
curl -sS -m 60 -X POST https://autoro.tech/api/chat-webhook \
  -H 'Content-Type: application/json' \
  -d '{"bot_id":"'"$AUTORO_SITE_BOT_ID"'","session":"smoke-1","lang":"ru","message":"тест"}'

# poll
curl -sS "https://autoro.tech/api/chat-poll?bot_id=$AUTORO_SITE_BOT_ID&session_id=smoke-1&since=1970-01-01T00:00:00Z"
```

## Troubleshooting

| Симптом | Причина | Fix |
|---|---|---|
| Stub «Спасибо!…» | n8n пустой reply | проверить workflow active + env Telegram |
| Timeout 60s / Task request timed out | Code nodes + external runners | перегенерировать workflow (`node scripts/generate-n8n-autoro-site-chat.mjs`) — Set nodes, без Code |
| 404 webhook после import | webhook не зарегистрирован | `n8n update:workflow --id=... --active=true` при работающем n8n |
| 404 bot | неверный bot_id | Swoop Chat Agents + meta tag |
| Ответ в TG не доходит на сайт | webhook / push-reply | setWebhook, CHAT_PUSH_SECRET, gateway logs |
| CORS / 502 на /api/chat-* | nginx proxy | nginx.conf, autoro-chat-gateway Up |
