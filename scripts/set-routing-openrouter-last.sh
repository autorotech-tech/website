#!/usr/bin/env bash
#
# set-routing-openrouter-last.sh — делает OpenRouter ПОСЛЕДНИМ шагом (last resort)
# в КАЖДОМ tier'е маршрутизации Swoop agent-api.
#
# ПОЧЕМУ:
#   У пользователя на OpenRouter НЕТ баланса — его нельзя ставить первым.
#   Это РАЗВОРОТ предыдущего изменения (scripts/set-routing-openrouter-primary.sh
#   apply), которое сделало OpenRouter PRIMARY для платных tier'ов. Нужно:
#   провайдеры с валидными ключами + балансом идут ПЕРВЫМИ, а OpenRouter —
#   ВСЕГДА финальным шагом (только если всё остальное упало).
#
# МЕХАНИЗМ:
#   Маршрутизация data-driven: public.service_settings.agent_llm_routing (jsonb).
#   tiers.<tier> — упорядоченный список шагов {provider, model}. Эффективная
#   цепочка = tier_steps + fallback; первый ответ 200 побеждает. Кэш настроек
#   agent-api ~45с — рестарт контейнера НЕ нужен, только апдейт БД + ожидание.
#
#   ВАЖНО: цепочка = tier_steps + fallback. Чтобы OpenRouter был ГАРАНТИРОВАННО
#   последним, fallback сделан OpenRouter-ONLY — ни один не-openrouter шаг не
#   выполняется после openrouter. (Если бы в fallback остались gemini/glm/groq,
#   они бы шли ПОСЛЕ openrouter-шага tier'а и нарушали правило.)
#
# ПОРЯДОК ПРОВАЙДЕРОВ (эмпирически проверено forced-запросами на VPS 2026-06-25):
#   Реально 200 сейчас отдают только: glm `glm-4-flash` (БЕСПЛАТНО) и openrouter.
#   gemini (400/403) и groq (Cloudflare 1010) сейчас падают, glm-paid → code 1113
#   (баланс исчерпан). gemini/glm-paid/groq оставлены ПЕРВЫМИ шагами: они
#   self-healing (когда вернутся ключи/баланс — подхватятся автоматически), а
#   неживые ключи быстро попадают в cooldown по key_health и пропускаются.
#
#   general/fast: бесплатный glm-4-flash стоит ВЫШЕ openrouter (приемлемое
#                 качество, экономит деньги).
#   code/reasoning/vision: без перехвата бесплатным glm-4-flash (качество),
#                 openrouter — рабочий last resort после платных провайдеров.
#   В каждом tier'е openrouter — ПОСЛЕДНИЙ; глобальный fallback — тоже openrouter.
#
# Использование:
#   scripts/set-routing-openrouter-last.sh [apply|revert|verify]
#     apply  (по умолчанию) — OpenRouter-last во всех tier'ах
#     revert                — вернуть конфиг OpenRouter-PRIMARY (состояние до apply)
#     verify                — только проверить, чем сейчас отвечает роутер
#
# Перед apply/revert делается бэкап текущего конфига на VPS:
#   /tmp/swoop_routing_backup_<timestamp>.json
#
# Переменные окружения (дефолты под этот проект):
#   VPS_HOST=46.250.228.229 VPS_USER=vladx SSH_KEY=~/.ssh/id_ed25519_autoro
#   DB_CONTAINER=supabase-db API_CONTAINER=autoro-agent-api AGENT_PORT=8900
#
set -euo pipefail

ACTION="${1:-apply}"
case "$ACTION" in
  apply|revert|verify) ;;
  *) echo "ОШИБКА: неизвестное действие '$ACTION' (apply|revert|verify)" >&2; exit 1 ;;
esac

VPS_HOST="${VPS_HOST:-46.250.228.229}"
VPS_USER="${VPS_USER:-vladx}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
API_CONTAINER="${API_CONTAINER:-autoro-agent-api}"
AGENT_PORT="${AGENT_PORT:-8900}"
CACHE_WAIT="${CACHE_WAIT:-50}"

SSH_OPTS=(-o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o BatchMode=yes -i "$SSH_KEY")
TARGET="${VPS_USER}@${VPS_HOST}"

# OpenRouter-LAST во всех tier'ах. fallback — OpenRouter-only (гарант "последним").
read -r -d '' APPLY_JSON <<'JSON' || true
{
  "tiers": {
    "general": [
      {"provider": "gemini", "model": "gemini-2.5-flash"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"},
      {"provider": "glm", "model": "glm-4-flash"},
      {"provider": "openrouter", "model": "qwen/qwen3.7-plus"}
    ],
    "fast": [
      {"provider": "glm", "model": "glm-4-flash"},
      {"provider": "gemini", "model": "gemini-2.5-flash"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"},
      {"provider": "openrouter", "model": "stepfun/step-3.7-flash"}
    ],
    "code": [
      {"provider": "gemini", "model": "gemini-2.5-pro"},
      {"provider": "glm", "model": "glm-4-plus"},
      {"provider": "groq", "model": "deepseek-r1-distill-llama-70b"},
      {"provider": "openrouter", "model": "moonshotai/kimi-k2.7-code"}
    ],
    "reasoning": [
      {"provider": "gemini", "model": "gemini-2.5-pro"},
      {"provider": "glm", "model": "glm-4-plus"},
      {"provider": "groq", "model": "deepseek-r1-distill-llama-70b"},
      {"provider": "openrouter", "model": "anthropic/claude-opus-4.8"}
    ],
    "vision": [
      {"provider": "gemini", "model": "gemini-2.5-flash"},
      {"provider": "glm", "model": "glm-4v-flash"},
      {"provider": "openrouter", "model": "google/gemini-3.1-flash-image"}
    ]
  },
  "fallback": [
    {"provider": "openrouter", "model": "qwen/qwen3.7-plus"}
  ]
}
JSON

# REVERT = конфиг OpenRouter-PRIMARY (состояние, которое было ДО этого apply,
# снято с VPS 2026-06-25). Полный откат — одной командой.
read -r -d '' REVERT_JSON <<'JSON' || true
{
  "tiers": {
    "general": [
      {"provider": "openrouter", "model": "qwen/qwen3.7-plus"},
      {"provider": "glm", "model": "glm-4-flash"},
      {"provider": "gemini", "model": "gemini-2.5-flash"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"}
    ],
    "code": [
      {"provider": "openrouter", "model": "moonshotai/kimi-k2.7-code"},
      {"provider": "glm", "model": "glm-4-plus"},
      {"provider": "gemini", "model": "gemini-2.5-pro"},
      {"provider": "groq", "model": "deepseek-r1-distill-llama-70b"}
    ],
    "reasoning": [
      {"provider": "openrouter", "model": "anthropic/claude-opus-4.8"},
      {"provider": "glm", "model": "glm-4-plus"},
      {"provider": "gemini", "model": "gemini-2.5-pro"},
      {"provider": "groq", "model": "deepseek-r1-distill-llama-70b"}
    ],
    "vision": [
      {"provider": "openrouter", "model": "google/gemini-3.1-flash-image"},
      {"provider": "glm", "model": "glm-4v-flash"},
      {"provider": "gemini", "model": "gemini-2.5-flash"}
    ],
    "fast": [
      {"provider": "glm", "model": "glm-4-flash"},
      {"provider": "openrouter", "model": "stepfun/step-3.7-flash"},
      {"provider": "gemini", "model": "gemini-2.5-flash"},
      {"provider": "groq", "model": "llama-3.3-70b-versatile"}
    ]
  },
  "fallback": [
    {"provider": "gemini", "model": "gemini-2.5-flash"},
    {"provider": "glm", "model": "glm-4-flash"},
    {"provider": "groq", "model": "llama-3.3-70b-versatile"}
  ]
}
JSON

run_verify() {
  echo ">> Проверка маршрутизации (forced-провайдер НЕ задаётся; смотрим X-LLM-Route)..."
  local PROBE
  PROBE=$(cat <<'PYEOF'
import json,os,urllib.request as u,urllib.error as e
B="http://127.0.0.1:%PORT%"; K=os.environ["AK"]
def chat(content):
  body={"model":"routed-model","messages":[{"role":"user","content":content}],"max_tokens":16}
  r=u.Request(B+"/api/v1/chat/completions",headers={"X-API-Key":K,"Content-Type":"application/json"},data=json.dumps(body).encode(),method="POST")
  try:
    with u.urlopen(r,timeout=120) as x:
      hd={k.lower():v for k,v in x.getheaders()}; b=json.loads(x.read().decode())
      return x.status,b.get("model"),hd.get("x-llm-route",""),hd.get("x-llm-tier","")
  except e.HTTPError as ex: return ex.code,"(err)",ex.read().decode()[:120],""
for label,txt in [("general","Say hello in one word"),
                  ("reasoning","Solve step by step: if 3x+7=22, what is x? Explain your reasoning."),
                  ("fast","ok")]:
  st,m,route,tier=chat(txt)
  flag="<<< OPENROUTER (last resort)" if route.startswith("openrouter") else "OK (non-openrouter)"
  print(f"  [{label}] http={st} model={m} tier={tier} route='{route}' {flag}")
PYEOF
)
  PROBE="${PROBE/\%PORT\%/$AGENT_PORT}"
  printf '%s' "$PROBE" > /tmp/swoop_routing_verify.py
  scp "${SSH_OPTS[@]}" /tmp/swoop_routing_verify.py "${TARGET}:/tmp/swoop_routing_verify.py" >/dev/null
  ssh "${SSH_OPTS[@]}" "$TARGET" \
    "AK=\$(docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc \"select agent_api_key from public.service_settings where id=1\" | tr -d '[:space:]'); docker cp /tmp/swoop_routing_verify.py ${API_CONTAINER}:/tmp/swoop_routing_verify.py >/dev/null 2>&1; docker exec -e AK=\"\$AK\" ${API_CONTAINER} python3 /tmp/swoop_routing_verify.py"
}

if [[ "$ACTION" == "verify" ]]; then
  echo ">> Цель: ${TARGET}  БД: ${DB_CONTAINER}  API: ${API_CONTAINER}:${AGENT_PORT}"
  run_verify
  exit 0
fi

if [[ "$ACTION" == "apply" ]]; then
  PAYLOAD="$APPLY_JSON"; HUMAN="OpenRouter-LAST (last resort во всех tier'ах)"
else
  PAYLOAD="$REVERT_JSON"; HUMAN="OpenRouter-PRIMARY (откат к состоянию до apply)"
fi

echo ">> Цель: ${TARGET}  БД: ${DB_CONTAINER}  API: ${API_CONTAINER}:${AGENT_PORT}"
echo ">> Действие: ${ACTION} -> ${HUMAN}"

# 1) Бэкап текущего конфига на VPS
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="/tmp/swoop_routing_backup_${TS}.json"
echo ">> Бэкап текущего agent_llm_routing -> ${BACKUP} (на VPS)"
ssh "${SSH_OPTS[@]}" "$TARGET" \
  "docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc \"select coalesce(agent_llm_routing,'{}'::jsonb) from public.service_settings where id=1\" > ${BACKUP}; wc -c < ${BACKUP} | xargs echo '   backup bytes:'"

# 2) Готовим payload + SQL локально и заливаем на VPS
printf '%s\n' "$PAYLOAD" > /tmp/swoop_routing_payload.json
cat > /tmp/swoop_routing_apply.sql <<'SQL'
\set j `cat /tmp/swoop_routing_payload.json`
update public.service_settings set agent_llm_routing = :'j'::jsonb where id=1;
select 'tiers: ' || string_agg(k, ', ' order by k) from jsonb_object_keys((select agent_llm_routing->'tiers' from public.service_settings where id=1)) k;
SQL
scp "${SSH_OPTS[@]}" /tmp/swoop_routing_payload.json "${TARGET}:/tmp/swoop_routing_payload.json" >/dev/null
scp "${SSH_OPTS[@]}" /tmp/swoop_routing_apply.sql "${TARGET}:/tmp/swoop_routing_apply.sql" >/dev/null

# 3) Применяем в БД (psql читает JSON из файла внутри контейнера через \set)
echo ">> Обновляю public.service_settings.agent_llm_routing..."
ssh "${SSH_OPTS[@]}" "$TARGET" \
  "docker cp /tmp/swoop_routing_payload.json ${DB_CONTAINER}:/tmp/swoop_routing_payload.json >/dev/null && docker cp /tmp/swoop_routing_apply.sql ${DB_CONTAINER}:/tmp/swoop_routing_apply.sql >/dev/null && docker exec ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -f /tmp/swoop_routing_apply.sql"

# 4) Ждём истечения кэша настроек agent-api (TTL ~45с)
echo ">> Жду ${CACHE_WAIT}с (кэш настроек agent-api ~45с, рестарт не нужен)..."
sleep "$CACHE_WAIT"

# 5) Проверка
run_verify

echo ">> Готово (${ACTION}). Откат: scripts/set-routing-openrouter-last.sh revert"
