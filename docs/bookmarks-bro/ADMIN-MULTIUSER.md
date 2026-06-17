# Bookmarks Bro — администрирование множества пользователей

Связано: [[Unified Knowledge Base Plan]], `migrate_bookmarks_bro_mvp.sql`, `ops/bookmarks-bro-supabase/`.

## Два уровня «пользователя»

| Уровень | Сущность | Зачем |
|---------|----------|--------|
| **Tenant / клиент** | `workspace_id` (число) | Одна изолированная KB: закладки, `knowledge_items`, UI-снимок, Obsidian `Autoro KB/ws-{id}` |
| **Человек** | `auth.users` (Supabase) `owner_id` | Владелец workspace; RLS «видит только своё» |

Сейчас в MVP: **данные режутся по `workspaceId` в API**, а **жёсткая привязка «этот JWT → только эти workspace»** в `agent-api` ещё не везде enforced (общий `X-API-Key` для админки допустим).

---

## Рекомендуемая модель (удобное администрирование)

### 1. Один пользователь = один или несколько workspace

- **B2C / solo:** при регистрации `POST /workspaces/ensure` создаёт workspace с `owner_id = auth.uid()`.
- **B2B / агентство:** один `owner_id` → несколько workspace (клиент A = ws-12, клиент B = ws-13).

Таблица **`workspace_members`** (следующий этап после MVP):

```text
workspace_members(user_id, workspace_id, role)
role ∈ { owner, admin, member, readonly }
```

Пока в схеме только **`workspaces.owner_id`** — см. `migrate_bookmarks_bro_mvp.sql` (комментарий «can be extended to workspace_members later»).

### 2. Изолированный Supabase для Bookmarks

Для прод с многими пользователями — **отдельный стек** `supabase-bb`, не общий Swoop KB:

- RLS по `owner_id` на `bookmarks_bro.*` или `public.workspaces`
- Auth: `https://…/bb-supabase`
- Инструкция: `ops/bookmarks-bro-supabase/README.md`

### 3. Операторская админка (уже есть)

**`/admin/bookmarks-bro`** (`AdminBookmarksBro.tsx`):

- `Agent API Key` — ключ из Swoop / `service_settings.agent_api_key`
- **Load Workspaces** — список id из БД
- Worker / Enrich / Search / AI — **всегда с выбранным `workspaceId`**

Это панель **оператора Autoro**, не конечного пользователя приложения.

### 4. Маршрутизация Telegram → workspace

Env **`TELEGRAM_CHAT_WORKSPACE_MAP`** (JSON):

```json
{ "-1001234567890": 12, "-1009876543210": 13 }
```

Или таблица `telegram_workspace_links` + админ-эндпоинт (см. Unified Knowledge Base Plan).

### 5. Чеклист онбординга нового клиента

1. Создать пользователя в Supabase BB (или self-signup).
2. Создать workspace (имя клиента) → записать `workspace_id`.
3. Выдать пользователю: API base, bootstrap / login, **его** `workspaceId` в расширении.
4. Проверить Obsidian-путь: `KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT=Autoro KB/ws-{workspace_id}`.
5. В админке: Load Workspaces → worker/enrich для этого id.
6. При необходимости: строка в `TELEGRAM_CHAT_WORKSPACE_MAP`.

---

## Дальнейшие шаги разработки (приоритет)

| # | Задача | Эффект |
|---|--------|--------|
| 1 | `GET/POST /api/v1/bookmarks/workspaces` с `owner_id` из JWT | Пользователь видит только свои workspace |
| 2 | Middleware: `workspaceId` в запросе ∈ allowed для user | Закрыть дыру «знаю id чужого workspace» |
| 3 | Таблица `workspace_members` + роли | Команды клиента, readonly |
| 4 | Админ UI: таблица workspace (имя, owner, last_sync, token usage) | Без ручного ввода id |
| 5 | n8n: Resolve workspace по `chat_id`, не хардкод | Мульти-клиент Telegram |

---

## Матрица доступа (целевая)

| Роль | Workspaces | Admin panel | Чужой workspace_id |
|------|------------|-------------|---------------------|
| End user | свои | нет | запрещено |
| Client admin | свои + invite | нет | запрещено |
| Autoro ops | все (API key) | да | да (осознанно) |

---

## SafeDep — отдельно от админки пользователей

См. раздел в основном README команды: **не используется** для login, workspace и Bookmarks Bro runtime. Только **безопасность цепочки поставок** при разработке (npm/CI/Cursor MCP).
