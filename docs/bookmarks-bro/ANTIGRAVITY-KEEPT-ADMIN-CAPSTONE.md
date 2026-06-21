# Keept Admin + Kaggle Capstone — handoff для Antigravity

**Product:** Keep It For Me (Keept) · **Domain:** keept.me  
**Capstone:** [Vibe Coding Agents](https://www.kaggle.com/competitions/vibecoding-agents-capstone-project) · Concierge Agents · deadline **6 Jul 2026 PT**

> **Статус (2026-06-20):** Phase A–D **завершены** (Antigravity). Tracks ниже — для доработок и Kaggle. Актуальный roadmap: [KEEPT-DEVELOPMENT-STATUS.md](./KEEPT-DEVELOPMENT-STATUS.md).

---

## Copy-paste в Antigravity (ручной режим)

Вставьте **весь блок ниже** в новую сессию Antigravity после `git pull` в `AuthRAG` (branch `bookmarks-bro`).

```
Ты работаешь в зеркале Keept: github.com/autorotech-tech/AuthRAG, branch bookmarks-bro.
Source of truth — website (main). Синхронизация: npm run keept:sync-authrag:apply из корня website.

КОНТЕКСТ (Cursor уже сделал):
- agent-api: security.py, capture → pending_moderation, queue table, GET/POST /api/v1/keept/moderation/*
- Роут-заглушка /keept/admin → src/keeptAdmin/KeeptAdminApp.tsx (без Swoop Layout)
- НЕ трогать: BookmarksBroApp.tsx (user app), массовый rename bookmarks-bro, ломать monolithic agent-api/main.py на staging

ТВОИ ТРЕКИ (приоритет):

Track A — Keept Admin UI (главное)
- Развить src/keeptAdmin/: ModerationPanel.tsx, список pending из GET /api/v1/keept/moderation/items?workspaceId=&status=pending
- Approve/Reject → POST /api/v1/keept/moderation/resolve { action, queueId, workspaceId }
- Auth: тот же BB Supabase session что у /bookmarks-bro (см. AUTH-SETUP.md)
- Стиль: expense-dashboard / refero-cursor-warm-ivory + DESIGN.md (sidebar, KPI row, cards)
- Отдельный shell — без Swoop sidebar (уже вынесен из Layout)

Track B — ADK playground + evals
- Репо ADK: ~/Desktop/n8n/google intensive/keep-it-for-me (НЕ внутри website/)
- Подключить agent_workflow.py в fast_api_app / make playground
- Док: docs/bookmarks-bro/ADK-WORKFLOW-HITL.md
- make grade — evals security + HITL

Track C — Kaggle writeup
- docs/bookmarks-bro/KAGGLE-CAPSTONE-KEEPT.md: ≥3 концепций (ADK workflow, security/HITL, MCP Obsidian, multi-agent, skills)
- Demo script: capture с PII → pending → admin approve → Obsidian sync

ВЕРИФИКАЦИЯ (правильные пути):
cd "/Users/vlad_x/Desktop/n8n/autoro.tech/website" && npm run build && npm run bookmarks-bro:smoke
cd "/Users/vlad_x/Desktop/n8n/autoro.tech/website/agent-api" && PYTHONPATH=. "/Users/vlad_x/Desktop/n8n/google intensive/keep-it-for-me/.venv/bin/pytest" tests/test_security_backend.py -v
cd "/Users/vlad_x/Desktop/n8n/google intensive/keep-it-for-me" && uv run pytest tests/unit/test_security.py -v && make playground

DNS prod: docs/bookmarks-bro/CLOUDFLARE-KEEPT-DNS.md

Полная спека: docs/bookmarks-bro/ANTIGRAVITY-KEEPT-ADMIN-CAPSTONE.md
```

После правок в **website** — Cursor делает commit; затем `npm run keept:sync-authrag:apply` пушит срез в AuthRAG.

---

## Роли репозиториев

| Repo | Branch | Кто |
|------|--------|-----|
| [website](https://github.com/autorotech-tech/website) | `main` | Cursor — API, user SPA, ops docs |
| [AuthRAG](https://github.com/autorotech-tech/AuthRAG) | `bookmarks-bro` | Antigravity — Admin UI, ADK docs, Kaggle |
| `google intensive/keep-it-for-me` | local | ADK agent, security unit tests, playground |

**Staging сегодня:** `https://swoop.autoro.tech/bookmarks-bro` · BB Supabase path `/bb-supabase` · VPS `46.250.228.229`

---

## Что уже в agent-api (Cursor)

### Security pipeline

- `agent-api/security.py` — SSN, CC, email, US/RU phone, prompt-injection heuristics → `human_review`
- `finalize_knowledge_capture_fields(..., skip_security=False)` — screen **после** Jina merge, **до** `ai_enrich_knowledge`
- При флаге: `status=pending`, запись в `capture_moderation_queue`, **без** embedding / Obsidian

### Moderation API

| Method | Path | Назначение |
|--------|------|------------|
| `GET` | `/api/v1/keept/moderation/items?workspaceId=&status=` | Список pending/approved/rejected |
| `POST` | `/api/v1/keept/moderation/resolve` | `{ action: "approve" \| "reject", queueId, workspaceId }` |

**Approve:** enrich + embedding + Obsidian (с `skip_security=True` на повторном finalize).  
**Reject:** пометить rejected, без sync.

### SQL

- `ops/bookmarks-bro-supabase/sql/003_capture_moderation_queue.sql`
- Runtime: `ensure_capture_moderation_queue_schema()` при старте API

### Frontend stub

- `src/keeptAdmin/KeeptAdminApp.tsx` — отдельный layout, route `/keept/admin/*` **вне** Swoop `Layout`
- User app `BookmarksBroApp.tsx` — **без** moderation UI

---

## Track A — Keept Admin UI (Antigravity)

### UX reference

Expense-manager dashboard (card layout, sidebar, KPI row). Skills: `refero-cursor-warm-ivory`, корневой `DESIGN.md`.

### ModerationPanel — минимальный контракт

1. Загрузка items для `workspaceId` из session / workspace selector
2. Карточка: `raw_text` preview (truncate), `reason`, `created_at`, `source_url`
3. **Approve** → resolve approve → toast + refresh list
4. **Reject** → optional note → resolve reject
5. Empty state: «No pending captures»
6. Error state: API 401/403 → redirect login BB Supabase

### Env (staging)

```bash
VITE_AGENT_API_BASE=https://swoop.autoro.tech
VITE_BOOKMARKS_SUPABASE_URL=https://swoop.autoro.tech/bb-supabase
```

Prod hostnames — см. [CLOUDFLARE-KEEPT-DNS.md](./CLOUDFLARE-KEEPT-DNS.md).

### Manual QA (после UI)

1. Login → `/keept/admin` → видны pending (если есть)
2. Capture с email в тексте → `pending_moderation` в user app
3. Admin approve → item в KB + Obsidian (если bridge включён)

---

## Track B — ADK workflow (Antigravity)

Локальный проект: **`/Users/vlad_x/Desktop/n8n/google intensive/keep-it-for-me`**

```
app/
  security.py          # зеркало agent-api
  agent.py             # human_review → pending, 0 tokens
  agent_workflow.py    # parse → security → HITL → enrich | reject (подключить к playground)
tests/unit/test_security.py
Makefile               # playground, grade
```

**Не путать с website:** из корня `website` команды `cd "google intensive/keep-it-for-me"` **не работают**.

---

## Track C — Kaggle Capstone

Показать **≥3** из:

1. **ADK 2.0 workflow** — граф с HITL gate
2. **Security** — PII + injection → moderation queue
3. **MCP Obsidian** — sync только после approve
4. **Multi-agent** — capture / enrich / moderator roles
5. **Skills** — n8n, frontend-design, security-review

Артефакт: `docs/bookmarks-bro/KAGGLE-CAPSTONE-KEEPT.md` + 3–5 min demo video script.

---

## Ошибки из терминала (FAQ)

Пользователь запускал из `website/`:

```bash
cd "google intensive/keep-it-for-me"   # FAIL — путь относительно n8n, не website
pytest                                  # not found
make playground                         # FAIL — нет target в website
```

**Правильно:**

```bash
cd "/Users/vlad_x/Desktop/n8n/google intensive/keep-it-for-me"
uv run pytest tests/unit/test_security.py -v
make playground
```

Website-only:

```bash
cd "/Users/vlad_x/Desktop/n8n/autoro.tech/website"
npm run build
npm run bookmarks-bro:smoke
npm run keept:security:test    # ADK + agent-api security (из корня website)
npm run keept:adk:playground   # ADK dev UI
```

ADK agent (альтернатива — те же команды через npm выше):

```bash
cd "/Users/vlad_x/Desktop/n8n/google intensive/keep-it-for-me"
uv run pytest tests/unit/test_security.py -v
make playground
```

Полная таблица записей, SSL, nginx, env для prod: **[CLOUDFLARE-KEEPT-DNS.md](./CLOUDFLARE-KEEPT-DNS.md)**

---

## Sync checklist (Cursor → AuthRAG)

```bash
cd "/Users/vlad_x/Desktop/n8n/autoro.tech/website"
npm run build
npm run keept:sync-authrag:apply
```

Antigravity: `git pull` в AuthRAG branch `bookmarks-bro`. Phase A–D done — см. [KEEPT-DEVELOPMENT-STATUS.md](./KEEPT-DEVELOPMENT-STATUS.md). Дальше: staging E2E, Cloudflare, Kaggle video.

---

## Связанные документы

- [ANTIGRAVITY-HANDOFF.md](./ANTIGRAVITY-HANDOFF.md)
- [AUTH-SETUP.md](./AUTH-SETUP.md)
- [ANTIGRAVITY-SWOOP-KEEPT.md](./ANTIGRAVITY-SWOOP-KEEPT.md)
- [CURSOR-INTEGRATION-GUIDE.md](./CURSOR-INTEGRATION-GUIDE.md) (в AuthRAG после sync)
