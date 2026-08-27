# OpenModel в Cursor (DeepSeek V4 Flash)

[OpenModel](https://www.openmodel.ai/) — multi-model gateway. Акция: [DeepSeek V4 Flash free](https://docs.openmodel.ai/en/docs/event) (10 RPM / 100K TPM).

**Модель:** `deepseek-v4-flash`  
**API base:** `https://api.openmodel.ai`  
**Протокол:** Anthropic Messages API (`/v1/messages`) — не OpenAI `/chat/completions`.

Ключ храните только в Cursor Settings или `~/.config/autoro/openmodel.env` — **не коммитить** в git.

---

## Быстрая настройка Cursor (IDE)

1. **Cursor Settings** (`Cmd+,`) → **Models**
2. Раздел **Anthropic**:
   - Включить **Anthropic API Key**
   - Ключ: `om-…` из [OpenModel Console](https://www.openmodel.ai/)
   - **Override Anthropic Base URL:** `https://api.openmodel.ai`
3. В списке моделей чата / Agent выберите **Add model** (или введите вручную):
   - Имя: `deepseek-v4-flash`
4. Выберите `deepseek-v4-flash` как модель для **Agent** или **Chat**
5. Перезапустите Cursor (`Cmd+Shift+P` → **Reload Window**) и откройте **новый** чат

### Если модель не появляется

- Проверьте base URL без лишнего слэша: `https://api.openmodel.ai` (документация также допускает `/v1`)
- Убедитесь, что включён именно **Anthropic** override, не OpenAI
- Smoke из терминала:

```bash
source ~/.config/autoro/openmodel.env 2>/dev/null || true
curl -sS "https://api.openmodel.ai/v1/messages" \
  -H "x-api-key: $OPENMODEL_API_KEY" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"deepseek-v4-flash","max_tokens":32,"messages":[{"role":"user","content":"OK"}]}'
```

---

## Локальное сохранение ключа (опционально)

```bash
bash scripts/setup-openmodel-cursor.sh
```

Скрипт создаёт `~/.config/autoro/openmodel.env` (chmod 600). Ключ вводится интерактивно или через `OPENMODEL_API_KEY=om-… bash scripts/setup-openmodel-cursor.sh`.

---

## Лимиты акции

| Параметр | Значение |
|----------|----------|
| Модель | `deepseek-v4-flash` |
| Цена | $0 input / $0 output |
| Rate limit | 10 RPM, 100K TPM на пользователя |

Другие модели OpenModel — со скидкой 20–80%. См. [pricing event](https://docs.openmodel.ai/en/docs/event).

---

## Swoop / agent-api

Для Keept/Swoop OpenModel пока **не** подключён как провайдер в `agent-api`. Для продакшена используйте GLM (Coding Plan) или OpenRouter в Admin → Settings. OpenModel — для локальной разработки в Cursor.
