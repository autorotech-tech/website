# DeerFlow: синхронизация ключей из Swoop (Postgres)

Админка Swoop пишет ключи и модели в `public.service_settings`. Скрипт `sync_swoop_models.py` в каталоге DeerFlow читает их и обновляет `.env` и `config.yaml`, после чего контейнеры `gateway` и `langgraph` поднимаются заново через `docker-compose` / `docker compose up -d`.

**Список моделей в DeerFlow** подтягивается **live** с API провайдеров, у которых в Swoop есть ключи (не из устаревшего `agent_llm_routing`):

| Провайдер | Источник каталога |
|-----------|-------------------|
| Gemini | `GET generativelanguage.googleapis.com/v1beta/models` |
| OpenRouter | `GET openrouter.ai/api/v1/models` (сортировка по `created`, top N) |
| Groq / OpenAI | OpenAI-compatible `/v1/models` |
| GLM | `GET open.bigmodel.cn/.../models` или актуальный fallback-список |
| LMArena Bridge | `GET {lmarena_base_url}/models` |

Дополнительно всегда добавляются pinned-модели из Swoop: `openrouter_default_model`, `openrouter_qwen_model`, `lmarena_default_model`, а также `api_key_groups[].models`.

Рядом с `sync_swoop_models.py` должен лежать `provider_model_catalog.py` (копия `agent-api/swoop_provider_catalog.py`; обновление: `cp ../../agent-api/swoop_provider_catalog.py provider_model_catalog.py`). Оба файла копируются в корень DeerFlow на сервере.

## Установка на сервере (один раз)

Пути по умолчанию: пользователь `vladx`, проект `~/autoro-dashboard/projects/deer-flow`.

### Вариант A: systemd у пользователя (без `sudo`, уже развёрнуто на прод-сервере)

1. Скопировать `run-swoop-sync.sh` в корень DeerFlow (см. ниже).
2. Создать unit-файлы в `~/.config/systemd/user/` (содержимое как в `deer-flow-swoop-sync.service` / `.timer`, но **без** строк `User=` / `Group=` — юнит и так выполняется от вашего пользователя).
3. Выполнить:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now deer-flow-swoop-sync.timer
   ```

4. Чтобы таймер работал **после перезагрузки без SSH-сессии**, один раз от root:

   ```bash
   sudo loginctl enable-linger vladx
   ```

### Вариант B: system-wide (`/etc/systemd/system/`, нужен `sudo`)

1. Скопировать `run-swoop-sync.sh` в корень DeerFlow рядом с `sync_swoop_models.py`:

   ```bash
   cp deploy/deer-flow-swoop-sync/run-swoop-sync.sh ~/autoro-dashboard/projects/deer-flow/
   chmod +x ~/autoro-dashboard/projects/deer-flow/run-swoop-sync.sh
   ```

2. Убедиться, что в `compose.env` (или окружении при ручном запуске) задан `DATABASE_URL` / переменные, которые ожидает `sync_swoop_models.py`.

3. Установить unit-файлы (подставьте свой пользователь/путь при необходимости):

   ```bash
   sudo cp deploy/deer-flow-swoop-sync/deer-flow-swoop-sync.service /etc/systemd/system/
   sudo cp deploy/deer-flow-swoop-sync/deer-flow-swoop-sync.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now deer-flow-swoop-sync.timer
   ```

4. Проверка:

   ```bash
   systemctl list-timers | grep deer-flow
   sudo systemctl start deer-flow-swoop-sync.service
   journalctl -u deer-flow-swoop-sync.service -n 30 --no-pager
   ```

Таймер по умолчанию: каждые **5 минут** после предыдущего запуска + первый запуск через **3 минуты** после загрузки. Интервал меняется в `deer-flow-swoop-sync.timer` (`OnUnitActiveSec`).

## Ручной запуск без systemd

```bash
cd ~/autoro-dashboard/projects/deer-flow
./run-swoop-sync.sh
```

## Альтернатива: cron

```cron
*/5 * * * * /home/vladx/autoro-dashboard/projects/deer-flow/run-swoop-sync.sh >> /home/vladx/logs/deer-flow-swoop-sync.log 2>&1
```

Предварительно создайте каталог для лога и проверьте права на Docker / `docker-compose`.
