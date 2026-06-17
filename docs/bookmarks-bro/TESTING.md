# Bookmarks Bro — версия для тестирования

**Build:** `0.1.1-testing` (`BOOKMARKS_BRO_BUILD` / `package.json` version).

## Предусловия

1. **agent-api** запущен и доступен (dev: `VITE_AGENT_API_PROXY_TARGET`, prod: nginx `/api/v1`).
2. В `.env` или secrets: ключ API (`VITE_BOOKMARKS_API_KEY` или bootstrap token).
3. Postgres bookmarks: таблица `bookmarks_bro_workspace_ui` создаётся при старте API.

## Быстрый прогон

```bash
npm run build
npm run bookmarks-bro:smoke
npm run bookmarks-bro:api-test    # нужен живой agent-api + .env
npm run dev                       # UI: /bookmarks-bro
```

## Расширение браузера

Каноническая сборка: `extensions/bookmarks-bro/` (manifest `0.3.1`, build `0.1.1-testing` в UI).

1. Chrome → `chrome://extensions` → загрузить распакованное → `extensions/bookmarks-bro`.
2. Настройки: **Resolve workspace** → **Test Connection** (включая `workspace-ui-state`).
3. Popup: **Sync**, **Knowledge App** → `/bookmarks-bro`.

Подробнее: [extensions/bookmarks-bro/TESTING.md](../../extensions/bookmarks-bro/TESTING.md).

## Ручной сценарий (15 мин)

1. Открыть `/bookmarks-bro` — в шапке build `0.1.1-testing`, статус sync «Синхронизировано» или «Локально (сервер недоступен)».
2. Поиск по запросу → результаты (или fallback demo).
3. Создать идею / карточку KB → подождать ~1 с → в Network `PUT .../workspace-ui-state`.
4. Вкладка Knowledge → Export MD / ZIP.
5. Второй браузер (или очистить localStorage) → те же идеи/KB подтягиваются с сервера.

## API (контракт UI state)

- `GET /api/v1/bookmarks/workspace-ui-state?workspaceId={id}`
- `PUT /api/v1/bookmarks/workspace-ui-state`  
  Body: `{ workspaceId, ideas[], reminders[], knowledgeItems[] }`

## Математическая модель

См. [MATHEMATICAL-MODEL.md](./MATHEMATICAL-MODEL.md) — множества, автомат ingestion, merge hydrate, критерий `Ready_test`.

## Не входит в тестовую версию

- SafeDep / Cursor MCP (только supply-chain репозитория).
- Полный offline CRDT.
- Отдельный бэкенд для каждой идеи (только snapshot).
