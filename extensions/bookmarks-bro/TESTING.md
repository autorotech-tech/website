# Bookmarks Bro — расширение (тестирование)

**Build:** `0.1.1-testing` (см. `extension-config.js`). **Manifest version:** `0.3.1` (только целые числа — требование Chrome).

Каноническая папка: **`extensions/bookmarks-bro/`**. Варианты `bookmarks-bro-1/2/3` — устаревшие MVP-копии; для полного прогона используйте эту папку.

## Установка (Chrome / Edge)

1. `chrome://extensions` → Режим разработчика → **Загрузить распакованное** → выбрать `extensions/bookmarks-bro`.
2. **Настройки** расширения:
   - **API Base** — origin с agent-api и веб-приложением (dev: `http://127.0.0.1:5173` если Vite проксирует `/api/v1`, prod: `https://swoop.autoro.tech`).
   - **Resolve workspace** — `POST /api/v1/bookmarks/workspaces/ensure`, подставит реальный `workspaceId`.
   - **Test Connection** — bootstrap + metrics + проверка `workspace-ui-state`.
3. В popup: вход (OAuth) → **Sync** → при необходимости **Knowledge App** (`/bookmarks-bro`).

## Локальный dev

```bash
# Терминал 1 — API
cd agent-api && uvicorn main:app --host 127.0.0.1 --port 8900

# Терминал 2 — сайт + прокси API
npm run dev
```

В настройках расширения **API Base** = URL dev-сервера (тот же origin, что открываете в браузере), не голый `:8900`, если API идёт через Vite proxy.

## Чеклист (10 мин)

| # | Действие | Ожидание |
|---|----------|----------|
| 1 | Resolve workspace | В поле Workspace ID — id с сервера (не обязательно `1`) |
| 2 | Test Connection | Отчёт metrics + строка UI state (ideas/reminders/kb) |
| 3 | Popup → Sync | Job ID, accepted/deduplicated |
| 4 | Knowledge App | Открывается `/bookmarks-bro`, build в шапке |
| 5 | Веб-приложение: идея/KB | `PUT workspace-ui-state` в Network |
| 6 | Повторный popup Sync | Без 401, job обрабатывается |

## Связанные документы

- [docs/bookmarks-bro/TESTING.md](../../docs/bookmarks-bro/TESTING.md) — веб-приложение и API smoke
- [SUPABASE_OAUTH_SETUP.md](./SUPABASE_OAUTH_SETUP.md) — redirect URL для OAuth
