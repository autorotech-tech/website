# Antigravity Handoff — Keep It For Me (`keept.me`)

> **Copy-paste this entire file into Antigravity as session context.**  
> **Updated:** 2026-06-18  
> **Audience:** Google Antigravity autonomous agent  
> **Human operator:** Vlad / Autoro — parallel dev with Cursor IDE

---

## 0. One-minute summary

You are building **Keep It For Me** (brand **Keept**, domain **`keept.me`**). Internal codename **BrowserBro**; legacy paths **`bookmarks-bro`**, **`bookmarksBro`**, **`BOOKMARKS_*`** — **do not rename in Phase 1**.

| | Cursor (human + Composer) | You (Antigravity) |
|---|---------------------------|-------------------|
| **Source of truth** | `github.com/autorotech-tech/website` branch `main` | Mirror: `github.com/autorotech-tech/AuthRAG` branch `bookmarks-bro` |
| **Full monorepo** | Local disk + (eventually) GitHub push | AuthRAG slice only |
| **Memory** | Obsidian MCP vault | Same vault — search `Keep It For Me`, `Bookmarks Bro` |
| **Code map** | Understand Anything skills | Same — run `/understand` on Keept paths |

**Rule:** Implement in **website** paths when available; sync to AuthRAG via `scripts/sync-keept-to-authrag.sh`. Batch sync after meaningful milestones (not every micro-edit).

---

## 1. Product identity

| Layer | Name | Change in Phase 1? |
|-------|------|-------------------|
| Public product | **Keep It For Me** | Yes — user-visible strings |
| Short / domain | **Keept** / **keept.me** | Yes — marketing copy |
| Internal codename | BrowserBro | No |
| Code paths | `bookmarks-bro`, `src/bookmarksBro`, `BOOKMARKS_*` | **No mass rename** |
| API prefix | `/api/v1/bookmarks/*`, `/api/v1/keept/*` | No |

**Tagline:** *Keep what matters — search it later with AI.*

---

## 2. Two products on one VPS

| | **Swoop** (`swoop.autoro.tech`) | **Keept** (`keept.me` target) |
|---|--------------------------------|-------------------------------|
| Users | Autoro operators | End users (B2C) |
| Auth | Main Supabase | **BB Supabase** at `/bb-supabase` |
| UI | Admin, scrapling, blog ops | `/bookmarks-bro` + Chrome extension |
| Role | Control plane (LLM keys, n8n, ops) | Data plane (KB, RAG, Telegram) |

**Keept users never log into Swoop.**

Staging app URL today: `https://swoop.autoro.tech/bookmarks-bro`  
VPS: `46.250.228.229`, user `vladx`. Secrets on server only.

---

## 3. Repository layout (website monorepo)

```
website/                              # SOURCE OF TRUTH (Cursor)
├── agent-api/main.py                 # FastAPI — all Keept backend
├── src/bookmarksBro/                 # React web app (route /bookmarks-bro)
│   ├── BookmarksBroApp.tsx           # Main UI
│   ├── services.ts                   # API client, search, sync, telegram
│   ├── bookmarksBroBuild.ts          # Build label: 0.1.1-testing
│   └── localVectorStore.ts           # KeeptLocalVault (IndexedDB)
├── extensions/bookmarks-bro/         # Chrome MV3 extension (manifest 0.3.1)
├── docs/bookmarks-bro/               # Product + Antigravity docs (READ FIRST)
├── n8n/workflows/keept_telegram_assistant.json
├── migrate_bookmarks_bro_mvp.sql
├── ops/bookmarks-bro-supabase/       # Isolated BB Supabase stack
└── scripts/
    ├── sync-keept-to-authrag.sh      # website → AuthRAG
    ├── setup-understand-anything.sh  # Code knowledge graph tool
    ├── bookmarks-bro-smoke.mjs
    └── bookmarks-bro-api-test.mjs

AuthRAG/                              # YOUR MIRROR (branch bookmarks-bro)
└── (subset of paths above — synced via script)
```

### GitHub reality check (2026-06-18)

- `autorotech-tech/website` on GitHub `main` currently contains **docs only** (`docs/bookmarks-bro/*.md`).
- **Full monorepo lives on operator's Mac** at `~/Desktop/n8n/autoro.tech/website` (mostly untracked in git until pushed).
- **Do not assume** GitHub has `package.json` or `agent-api/` yet — clone from AuthRAG or wait for sync.
- Operator will push full monorepo when ready; until then **AuthRAG + local website** are the code sources.

---

## 4. Read order (mandatory)

1. **This file** — `docs/bookmarks-bro/ANTIGRAVITY-HANDOFF.md`
2. `docs/bookmarks-bro/ANTIGRAVITY-KEEPT-BRIEF.md` — Phase 1 scope, naming, checklist
3. `docs/bookmarks-bro/ANTIGRAVITY-SWOOP-KEEPT.md` — Swoop tools, Telegram, phases
4. `docs/bookmarks-bro/MATHEMATICAL-MODEL.md` — sets, FSM, UI snapshot merge
5. `docs/bookmarks-bro/TESTING.md` — smoke + manual QA
6. `docs/bookmarks-bro/ADMIN-MULTIUSER.md` — workspace vs owner_id
7. AuthRAG: `docs/ANTIGRAVITY-INFRA-BRIEF.md`, `ROADMAP.md` (when present)

---

## 5. Phase map and current status

| Phase | Focus | Status (2026-06-18) |
|-------|--------|---------------------|
| **1** | Auth docs, taxonomy, EN UI, search filters | **In progress** |
| **1.5** | Re-enrich legacy tags in DB | Not started |
| **2** | Multi-user JWT + `workspace_members` | **Partial** — `verify_workspace_membership()` in API |
| **3.0** | Telegram Tier A (platform bot) | **Partial** — API + n8n workflow exist |
| **3.1** | User-owned bot tokens | Not started |
| **4** | RAG quality / LLM routing | Ongoing via Swoop admin |
| **5** | `keept.me` prod domain | Future |

### Phase 1 open items (your priority)

- [ ] `docs/bookmarks-bro/AUTH-SETUP.md` (EN) — **missing**
- [ ] `agent-api/schemas/categories.json` + `normalize_tags()` + tests — **missing**
- [ ] Full **English** UI in `BookmarksBroApp.tsx`, extension HTML/JS
- [ ] User-visible brand **Keep It For Me** / **Keept** (not "Bookmarks Bro")
- [ ] Search filters: category, tag, RAG mode (see brief §2.4)

### Already implemented (do not redo)

- `POST /api/v1/bookmarks/bootstrap` — extension Bearer token
- `POST /api/v1/bookmarks/workspaces/ensure` — workspace id resolution
- `GET/PUT /api/v1/bookmarks/workspace-ui-state` — ideas, reminders, KB snapshot
- `POST /api/v1/keept/telegram/link-code|complete-link|status|unlink|bot-token`
- `verify_workspace_membership()` on many endpoints
- Web UI: Telegram linking, Keept Grounded Brain, `runKeeptAgent`
- Extension: `extension-config.js`, Resolve workspace, Knowledge App button, build `0.1.1-testing`
- n8n: `keept_telegram_assistant.json`

---

## 6. Architecture invariants (never break)

1. **SSOT for metadata:** Postgres + pgvector 1536 (`bookmark_page_content`, `knowledge_items`).
2. **Pipeline FSM:** `captured → enriched → indexed → searchable`.
3. **Extension auth:** bootstrap Bearer only — **never** ship admin `X-API-Key` in extension.
4. **DB env:** `BOOKMARKS_PGHOST` / `PGHOST` — not generic `DATABASE_URL` for BB stack.
5. **OpenRouter models:** full ID only — `anthropic/claude-3.7-sonnet`, not `claude-3.7-sonnet`.
6. **Obsidian export path:** `Autoro KB/ws-{workspace_id}`.
7. **Hydrate merge:** empty server + local data → push up; else server wins.

---

## 7. API quick reference

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/bookmarks/bootstrap` | Short-lived Bearer for extension |
| POST | `/api/v1/bookmarks/auth/login` | Email login |
| POST | `/api/v1/bookmarks/workspaces/ensure` | Create/return workspace id |
| GET/PUT | `/api/v1/bookmarks/workspace-ui-state` | UI snapshot (ideas, reminders, KB) |
| POST | `/api/v1/bookmarks/sync/start` | Extension bookmark sync job |
| POST | `/api/v1/bookmarks/search` | Semantic/text search |
| GET | `/api/v1/bookmarks/library/facets` | Category + tag facets |
| POST | `/api/v1/knowledge/capture` | Ingest knowledge item |
| POST | `/api/v1/keept/telegram/link-code` | Telegram link code (needs user JWT) |
| GET | `/api/v1/keept/telegram/status` | Link status |

Auth: `Authorization: Bearer <token>` or `X-API-Key` (admin only).

---

## 8. Cursor ↔ Antigravity sync workflow

### 8.1 Daily loop

```bash
# Antigravity — start of session
cd ~/AuthRAG && git pull origin bookmarks-bro

# After implementing in website (or if you edit AuthRAG directly):
cd ~/Desktop/n8n/autoro.tech/website   # or WEBSITE_ROOT
bash scripts/sync-keept-to-authrag.sh --apply --push
```

Dry-run first: `bash scripts/sync-keept-to-authrag.sh`

### 8.2 Obsidian shared memory

Both agents use Obsidian MCP:

```
search_vault: "Keep It For Me", "Bookmarks Bro", "keept"
read_note: Autoro/Keep It For Me — Antigravity Handoff.md
```

After milestones: append to `Autoro/Bookmarks Bro Progress` or update handoff note.

Physical vault sync: Syncthing (`docker-compose.syncthing.yml`).

### 8.3 Skills (Antigravity)

```bash
cd website && bash scripts/link-antigravity-skills.sh   # Cursor skills → ~/.gemini/antigravity/skills
```

| Task | Skills |
|------|--------|
| UI | `frontend-dev-guidelines`, `refero-cursor-warm-ivory` |
| Multi-phase | `antigravity-workflows`, `supergoal` |
| Debug API | `systematic-debugging` |
| E2E extension | `playwright-skill` |

Read `AGENTS.md` and `GEMINI.md` in website repo.

---

## 9. Understand Anything — codebase knowledge graph

**Repo:** [github.com/autorotech-tech/Understand-Anything](https://github.com/autorotech-tech/Understand-Anything)  
(Fork of Egonex Understand Anything — interactive knowledge graph for any codebase.)

### Install (once per machine)

```bash
cd website
bash scripts/setup-understand-anything.sh
# Restart Antigravity / Cursor
```

Installs skills to:
- Antigravity: `~/.gemini/antigravity/skills/` (via upstream `install.sh antigravity`)
- Cursor: `~/.cursor/skills/skills/` + project `.agent/skills/`

### Use on Keept slice (scoped — do not scan whole monorepo first time)

```
/understand src/bookmarksBro agent-api extensions/bookmarks-bro --language en
/understand-dashboard
/understand-chat How does workspace-ui-state sync work?
/understand-domain
/understand-diff
```

Output: `.understand-anything/knowledge-graph.json` + interactive dashboard.

**When to re-run:** after large refactors in `agent-api/main.py` or `src/bookmarksBro/`.

---

## 10. Verification commands

```bash
# Backend syntax
python3 -m py_compile agent-api/main.py

# Frontend (website root only)
npm run build

# Smoke (needs live agent-api + .env keys)
npm run bookmarks-bro:smoke
npm run bookmarks-bro:api-test
```

Extension: load unpacked `extensions/bookmarks-bro` — manifest version must be `0.3.1` (integers only, no `-testing` suffix).

---

## 11. First message template (paste into Antigravity)

```
You are the Antigravity agent for Keep It For Me (keept.me).

READ IN ORDER:
1. docs/bookmarks-bro/ANTIGRAVITY-HANDOFF.md (this handoff)
2. docs/bookmarks-bro/ANTIGRAVITY-KEEPT-BRIEF.md
3. docs/bookmarks-bro/ANTIGRAVITY-SWOOP-KEEPT.md

SETUP:
- Clone AuthRAG branch bookmarks-bro OR work from synced website paths
- bash scripts/setup-understand-anything.sh && restart IDE
- bash scripts/link-antigravity-skills.sh
- Obsidian: search_vault "Keep It For Me"

SCOPE NOW: Phase 1 only
- AUTH-SETUP.md (EN)
- categories.json + normalize_tags + tests
- EN UI + "Keep It For Me" branding in visible chrome
- Search category/tag/RAG filters per brief §2.4
- DO NOT rename bookmarks-bro code paths
- DO NOT start Phase 2 JWT hardening unless Phase 1 checklist closed

CODE MAP:
/understand src/bookmarksBro agent-api extensions/bookmarks-bro --language en

SYNC:
After milestone → website/scripts/sync-keept-to-authrag.sh --apply --push
```

---

## 12. Related links

| Resource | URL |
|----------|-----|
| Website repo | https://github.com/autorotech-tech/website |
| AuthRAG mirror | https://github.com/autorotech-tech/AuthRAG (branch `bookmarks-bro`) |
| Understand Anything | https://github.com/autorotech-tech/Understand-Anything |
| Staging app | https://swoop.autoro.tech/bookmarks-bro |
| BB Supabase (staging) | https://swoop.autoro.tech/bb-supabase |

---

## 13. Decision log (recent)

| Date | Decision |
|------|----------|
| 2026-06-16 | Product renamed user-facing to **Keep It For Me** / **keept.me**; code stays `bookmarks-bro` |
| 2026-06-17 | GitHub `website` gets Antigravity docs; full monorepo push pending |
| 2026-06-18 | `sync-keept-to-authrag.sh`, Understand Anything wired for Cursor + Antigravity |
| 2026-06-18 | Extension manifest `0.3.1`; build label `0.1.1-testing` in `extension-config.js` |
