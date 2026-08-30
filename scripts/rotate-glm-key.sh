#!/usr/bin/env bash
#
# rotate-glm-key.sh — заменяет/дополняет пул GLM-ключей (Zhipu/bigmodel)
# в public.service_settings.glm_keys на VPS и перепроверяет key-health.
#
# Причина существования: ключи GLM хранятся как jsonb-массив в основной
# supabase-db. agent-api кэширует настройки 45с (см. _SWOOP_LLM_CACHE_TTL_SEC),
# поэтому рестарт контейнера не нужен — скрипт ждёт окончания кэша и заново
# гоняет реальный chat-ping по каждому ключу (/api/v1/admin/verify-keys).
#
# Где взять новый ключ: https://bigmodel.cn → консоль → API Keys.
# Формат GLM-ключа: "<id>.<secret>" (~49 символов). Префикс провайдера НЕ нужен.
#
# Использование:
#   scripts/rotate-glm-key.sh <NEW_GLM_KEY> [--replace|--append]
#     --replace  (по умолчанию) заменить весь пул одним новым ключом
#     --append   добавить новый ключ к существующему пулу
#
# Переменные окружения (с дефолтами под этот проект):
#   VPS_HOST=46.250.228.229  VPS_USER=vladx  SSH_KEY=~/.ssh/id_ed25519_autoro
#   DB_CONTAINER=supabase-db  API_CONTAINER=autoro-agent-api  AGENT_PORT=8900
#
set -euo pipefail

NEW_KEY="${1:-}"
MODE="${2:---replace}"

if [[ -z "$NEW_KEY" ]]; then
  echo "ОШИБКА: не передан новый GLM-ключ." >&2
  echo "Использование: $0 <NEW_GLM_KEY> [--replace|--append]" >&2
  exit 1
fi
if [[ "$MODE" != "--replace" && "$MODE" != "--append" ]]; then
  echo "ОШИБКА: неизвестный режим '$MODE' (ожидается --replace или --append)." >&2
  exit 1
fi

VPS_HOST="${VPS_HOST:-46.250.228.229}"
VPS_USER="${VPS_USER:-vladx}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
API_CONTAINER="${API_CONTAINER:-autoro-agent-api}"
AGENT_PORT="${AGENT_PORT:-8900}"

SSH_OPTS=(-o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o BatchMode=yes -i "$SSH_KEY")

# Маска ключа для логов: префикс(4) + ...len=N
mask() { printf '%s...len=%s' "${1:0:4}" "${#1}"; }

# Лёгкая валидация формата GLM-ключа (id.secret)
if [[ "$NEW_KEY" != *.* || ${#NEW_KEY} -lt 20 ]]; then
  echo "ВНИМАНИЕ: ключ не похож на GLM-формат (<id>.<secret>, ~49 симв.): $(mask "$NEW_KEY")" >&2
  read -r -p "Продолжить всё равно? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "Отменено."; exit 1; }
fi

echo ">> Целевой VPS: ${VPS_USER}@${VPS_HOST}  БД: ${DB_CONTAINER}  API: ${API_CONTAINER}:${AGENT_PORT}"
echo ">> Новый ключ:  $(mask "$NEW_KEY")   режим: ${MODE}"

# 1) Текущее число ключей (без вывода секретов)
CUR_COUNT="$(ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" \
  "docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc \"select coalesce(jsonb_array_length(glm_keys),0) from public.service_settings where id=1\"" | tr -d '[:space:]')"
echo ">> Сейчас в пуле glm_keys: ${CUR_COUNT} ключ(ей)"

# 2) Обновление glm_keys. Новый ключ передаём через psql-переменную (без интерполяции в shell-кавычки).
if [[ "$MODE" == "--replace" ]]; then
  SQL="update public.service_settings set glm_keys = jsonb_build_array(:'k'::text) where id=1;"
else
  SQL="update public.service_settings set glm_keys = coalesce(glm_keys,'[]'::jsonb) || to_jsonb(:'k'::text) where id=1;"
fi

echo ">> Обновляю glm_keys..."
ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" \
  "docker exec -e NK=\"${NEW_KEY}\" ${DB_CONTAINER} sh -c 'psql -U postgres -d postgres -v k=\"\$NK\" -c \"${SQL}\"'"

NEW_COUNT="$(ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" \
  "docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc \"select coalesce(jsonb_array_length(glm_keys),0) from public.service_settings where id=1\"" | tr -d '[:space:]')"
echo ">> Стало в пуле glm_keys: ${NEW_COUNT} ключ(ей)"

# 3) Ждём истечения кэша настроек agent-api (TTL 45с)
echo ">> Жду 50с (кэш настроек agent-api ~45с)..."
sleep 50

# 4) Реальная перепроверка ключей + key-health (внутри контейнера, python3 urllib)
echo ">> Перепроверяю ключи через /api/v1/admin/verify-keys и /api/v1/admin/key-health..."
VERIFIER='
import json,os,urllib.request as u,urllib.error as e
B=os.environ.get("AGENT_BASE","http://127.0.0.1:'"${AGENT_PORT}"'"); K=os.environ["AK"]
def g(p,t=180):
  r=u.Request(B+p,headers={"X-API-Key":K})
  try:
    with u.urlopen(r,timeout=t) as x: return json.loads(x.read().decode())
  except e.HTTPError as ex: return {"_http":ex.code,"_body":ex.read().decode()[:300]}
vk=g("/api/v1/admin/verify-keys")
for it in (vk.get("results") or []):
  if it.get("provider")=="glm_keys": print("verify:",json.dumps(it,ensure_ascii=False))
kh=g("/api/v1/admin/key-health")
print("health:",json.dumps((kh.get("providers") or {}).get("glm_keys"),ensure_ascii=False))
'
ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" \
  "AK=\$(docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc \"select agent_api_key from public.service_settings where id=1\" | tr -d '[:space:]'); printf '%s' '${VERIFIER}' | docker exec -i -e AK=\"\$AK\" ${API_CONTAINER} python3 -"

echo ">> Готово. Если verify показывает is_valid:true и health status:active — ключ рабочий."
echo ">> Если снова code 1113 (余额不足) — у аккаунта нет баланса: пополните на bigmodel.cn или используйте ключ другого аккаунта."
