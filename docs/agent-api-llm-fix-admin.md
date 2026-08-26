# Agent API LLM — фикс перегрузки (Swoop Admin)

## Симптом

Запросы `/api/v1/chat/completions` «висят» 75–120+ с, `gemini_pool size=13`, массовые 429/404 в логах.

## Причина

1. **Один uvicorn worker** — запросы обрабатываются последовательно.
2. **`api_key_groups` без `provider`** — все группы попадали в `gemini_pool` (Groq/GLM/OR ключи → лишние HTTP).
3. **Длинная цепочка routing** + OpenRouter 404 + Gemini 429.

## Что сделано в коде (PR)

| Файл | Изменение |
|---|---|
| `agent-api/main.py` | `_select_api_key_group_keys`: untagged группы не попадают в provider-specific pool |
| `agent-api/main.py` | `_gemini_chat_key_pool`: только ключи `AIza*` |
| `agent-api/Dockerfile` | `--workers 2` |

## Деплой на VPS

```bash
# 1) SQL (routing без OpenRouter + provider tags)
ssh vladx@46.250.228.229
docker exec -i supabase-db psql -U supabase_admin -d postgres \
  < deploy/agent-api/fix-swoop-llm-routing.sql

# 2) Пересборка agent-api (из репозитория на сервере)
cd /path/to/website
docker compose build autoro-agent-api   # или ваш compose service name
docker compose up -d autoro-agent-api

# 3) Проверка
docker logs autoro-agent-api --since 2m 2>&1 | grep "gemini_pool size"
# Ожидание: size=6 (не 13)

curl -s http://127.0.0.1:8900/health  # если есть health endpoint
```

## Swoop Admin (ручная проверка)

**Settings → API Key Groups** — у каждой группы поле **Provider**:

| Группа | Provider |
|---|---|
| Gemini Reasoning / Fast | `gemini` |
| Groq Reasoning / Fast | `groq` |
| GLM Reasoning / Fast | `glm` |
| OpenRouter * | `openrouter` (не используется в routing) |

**Settings → LLM Routing** — tier `general` / `fast`:

1. `glm` / `glm-4-flash`
2. `groq` / `llama-3.3-70b-versatile`
3. `gemini` / `gemini-2.5-flash`

**OpenRouter не использовать** в цепочках до пополнения баланса и исправления model slugs.

## Smoke test

```bash
# С хоста VPS (та же Docker-сеть, что agent-api)
APIKEY=$(docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "SELECT agent_api_key FROM public.service_settings WHERE id=1")
AGIP=$(docker inspect autoro-agent-api --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' | awk '{print $1}')

curl -s -m 30 -X POST "http://${AGIP}:8900/api/v1/chat/completions" \
  -H "Content-Type: application/json" -H "X-API-Key: $APIKEY" \
  -d '{"model":"glm/glm-4-flash","messages":[{"role":"user","content":"Say OK"}],"max_tokens":20}'
```

**deer-flow-gateway:** контейнер в сети `deer-flow_deer-flow`, agent-api — в `autoro-dashboard_default`. Прямой вызов `http://172.23.0.4:8900` **не работает** (timeout). Нужно: подключить gateway к сети autoro **или** вызывать публичный URL Swoop через proxy.

Ожидание smoke: ответ < 20 с, header `X-LLM-Route: glm glm-4-flash`, `gemini_pool size=6` в логах.
