# Obsidian vault: сервер + Mac через Syncthing (вариант A)

Один vault на VPS (`/home/vladx/obsidian-vault`). Agent-api пишет заметки через `autoro-obsidian-relay`. Mac получает те же файлы через Syncthing.

## 1. VPS

```bash
# из корня репозитория website
export OBSIDIAN_VAULT_MOUNT=/home/vladx/obsidian-vault
docker compose -f docker-compose.syncthing.yml up -d
```

Откройте `http://<IP-VPS>:8384`, задайте пароль GUI.

## 2. Mac

1. Установите [Syncthing](https://syncthing.net/) или `brew install syncthing`.
2. Добавьте remote device (ID с VPS GUI).
3. Shared folder на Mac: **тот же путь**, что открыт в Obsidian как vault:  
   **`/Users/vlad_x/Desktop/soft/ObsidianVault`** (см. `scripts/bootstrap-obsidian-vault.sh`).
4. Тип папки: **Send & Receive** с VPS `ObsidianVault`.

## 3. Agent-api (уже по умолчанию в docker-compose)

```env
KNOWLEDGE_OBSIDIAN_SYNC_MODE=syncthing
KNOWLEDGE_OBSIDIAN_SYNC_LOCAL=0
OBSIDIAN_SYNC_WEBHOOK_URL=http://autoro-obsidian-relay:8787/sync
OBSIDIAN_VAULT_MOUNT=/home/vladx/obsidian-vault
```

Второй relay (`OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY`) **не нужен**.

## 4. Проверка

После сохранения в БЗ из Telegram на VPS:

```bash
ls "/home/vladx/obsidian-vault/Autoro KB/ws-1/Prompts Library/"
```

На Mac — та же заметка после sync (иконка Syncthing «Up to date»).

## 5. Troubleshooting

### «Obsidian: нет» в боте, ID в БЗ есть

1. Папка на VPS: `Autoro KB/ws-1/Knowledge Inbox` (создаётся relay при первой записи).
2. **Сеть Docker:** `autoro-agent-api` должен резолвить `autoro-obsidian-relay`. Если в sync ошибка `Name or service not known`:

```bash
docker network connect autoro-dashboard_default autoro-agent-api
# или подключите оба контейнера к одной user-defined сети в compose
```

3. Повторная запись `.md` из БЗ (с VPS, ключ из env контейнера):

```bash
docker exec autoro-agent-api python3 -c "
import json,urllib.request,subprocess
key=subprocess.check_output(['printenv','AGENT_API_KEY']).decode().strip()
req=urllib.request.Request(
  'http://127.0.0.1:8900/api/v1/knowledge/<ID>/re-enrich',
  data=json.dumps({'workspaceId':'1','forceFetch':False}).encode(),
  headers={'Content-Type':'application/json','X-API-Key':key},
  method='POST',
)
print(urllib.request.urlopen(req,timeout=120).read().decode())
"
```

### Syncthing не открывается (`:8384`)

Контейнер не запущен — см. раздел 1. На VPS без sudo для vault: файлы создаёт relay (root в volume); `mkdir` от пользователя `vladx` может дать Permission denied — это нормально, если relay пишет успешно.
