# Antigravity Brief — BrowserBro / Keep It For Me (`keept.me`)

> **Audience:** Google Antigravity and other autonomous agents.  
> **Updated:** 2026-06-16  
> **Status:** active — Phase 1 in progress  
> **Companion docs:** [ANTIGRAVITY-INFRA-BRIEF](https://github.com/autorotech-tech/AuthRAG/blob/bookmarks-bro/docs/ANTIGRAVITY-INFRA-BRIEF.md), [ROADMAP](https://github.com/autorotech-tech/AuthRAG/blob/bookmarks-bro/ROADMAP.md)

---

## 0. Product identity (read first)

| Layer | Name | Notes |
|-------|------|--------|
| **Public product** | **Keep It For Me** | User-facing EN brand |
| **Short / domain** | **keept.me** | Marketing site and future prod host |
| **Internal codename** | **BrowserBro** / `browserbro` | Tasks, Obsidian, agent prompts |
| **Legacy code name** | **Bookmarks Bro** | Still in paths, tables, env prefixes — **do not mass-rename in Phase 1** |
| **Repo codename** | **AuthRAG** | Authenticated RAG slice for autonomous dev |

**Tagline (EN):** *Keep what matters — search it later with AI.*

### Naming rules for agents

1. **Phase 1:** Change **user-visible strings only** (UI, extension title, docs) to **Keep It For Me** / **Keept**.  
   Example: popup `<h1>Keep It For Me</h1>`, kicker `Keept · build …`.
2. **Do not rename** in Phase 1: npm package names, folder `src/bookmarksBro/`, route `/bookmarks-bro`, table `bookmarks_bro_bookmarks`, env `BOOKMARKS_*`, extension id folder `extensions/bookmarks-bro/`, API paths `/api/v1/bookmarks/*`.
3. **Phase 5+ (future):** optional mechanical rename `bookmarks-bro` → `keept` with migration plan — out of scope now.
4. **Russian:** brief RU only in `extensions/bookmarks-bro/SUPABASE_OAUTH_SETUP.md`; all other new ops docs **EN**.

---

## 1. Where to work

| What | Source of truth | Antigravity clone |
|------|-----------------|-------------------|
| Implementation | `autoro.tech/website` monorepo | `github.com/autorotech-tech/AuthRAG` branch `bookmarks-bro` |
| UI build | `npm run build` in **website** | AuthRAG has no `package.json` |
| API | `website/agent-api/main.py` | Copy in AuthRAG |
| Extension | `website/extensions/bookmarks-bro/` | Copy in AuthRAG |

**Sync policy:** one batch sync **AuthRAG ← website** at **end of Phase 1** (not after every PR).

### Key paths (website)

```
src/bookmarksBro/BookmarksBroApp.tsx   # Web app UI
src/bookmarksBro/services.ts           # API client, search, ideas
src/bookmarksBro/uiSyncStatus.ts       # Sync labels
src/bookmarksBro/types.ts              # SearchItem, etc.
agent-api/main.py                      # Backend (monolith slice)
agent-api/schemas/categories.json      # NEW — taxonomy schema
extensions/bookmarks-bro/                # Chrome MV3 extension
ops/bookmarks-bro-supabase/            # Isolated BB Supabase stack
migrate_bookmarks_bro_mvp.sql          # DB schema
docs/bookmarks-bro/                    # Product docs
```

### SPA routes (unchanged in Phase 1)

- App: `/bookmarks-bro`
- Admin ops: `/admin/bookmarks-bro`

### Hosting (current → target)

| Env | Host | BB Supabase |
|-----|------|-------------|
| Dev/staging | `swoop.autoro.tech` | `https://swoop.autoro.tech/bb-supabase` |
| Prod (target) | **`keept.me`** | TBD — same BB stack pattern, separate Kong route |

VPS: `46.250.228.229`, user `vladx`. Do not commit secrets.

---

## 2. Locked decisions (Phase 1 — 2026-06-16)

### 2.1 Auth documentation

- Create **`docs/bookmarks-bro/AUTH-SETUP.md`** — **EN only**, full ops guide.
- Update **`extensions/bookmarks-bro/SUPABASE_OAUTH_SETUP.md`** — **brief RU** checklist + link to AUTH-SETUP.md.
- Topics: BB vs Swoop Supabase, env vars, Google/Microsoft OAuth, `chrome-extension://<ID>/oauth-callback.html`, web redirects, B1/B2 troubleshooting.
- **Scope:** fix + document OAuth/email auth. **No** JWT middleware / workspace enforcement (Phase 2).

### 2.2 Taxonomy (B3)

- `agent-api/schemas/categories.json` — canonical categories (`general`, `ai-ml`, `dev-tools`, `marketing`, `business`, `design`), aliases, reserved words.
- `load_tags_schema()`, `normalize_tags()`, `normalize_category()`.
- Refactor existing `infer_category()` hardcoded rules to read from schema.
- Apply normalization in: `local_enrich_bookmark`, `ai_enrich_bookmark`, `ai_enrich_knowledge`, capture `out_tags` (~4743).
- **Unit tests** for `normalize_tags` (15–20 cases). `py_compile` alone is insufficient.
- **Re-enrich existing rows:** deferred to **Phase 1.5** — document in AUTH-SETUP; normalization on **write-path only** in Phase 1.

### 2.3 English UI + brand (B4)

- Translate all user-facing strings to **English**; use product name **Keep It For Me** (or **Keept** in tight spaces).
- Files: `BookmarksBroApp.tsx`, `services.ts`, `uiSyncStatus.ts`, `extensions/bookmarks-bro/*.{html,js}`.
- **Acceptance:** no Cyrillic in UI chrome; user bookmark/note content exempt.
- `npm run build` must pass.

### 2.4 Search filters — parity with extension + RAG context

Extension library already has category + tag facets. Web Search must match:

| Control | Implementation |
|---------|----------------|
| **Category** | `<select>` from `GET /api/v1/bookmarks/library/facets` |
| **Tag** | `<select>` from same facets |
| **RAG context** | (1) **Corpus** = existing `sourceFilter` (All / Obsidian / Bookmarks / Links); (2) **Mode** = Semantic / Keyword → `semantic` in `POST /api/v1/bookmarks/search` |
| **Tag pills** | Under each result snippet; click sets tag filter |
| **Filtering** | Client-side on current `searchItems` after search (no new API in Phase 1) |

Extend `SearchItem` + `normalizeSearchItem` with `category?: string` (API already returns `category`, `tags`, `distance`).

### 2.5 Phase 2 boundary

Do **not** start until B1–B4 closed:

- JWT-scoped workspaces, workspace guard middleware, `workspace_members`, RLS hardening.

---

## 3. Phase 1 task checklist

### 3.1 Auth (B1, B2)

- [ ] BB Supabase up (`ops/bookmarks-bro-supabase/bootstrap.sh` or `recover_bb_stack.sh`)
- [ ] Google OAuth: redirect URI + extension `chrome-extension://…/oauth-callback.html`
- [ ] `BOOKMARKS_SUPABASE_URL` / anon key → BB stack (not main Swoop)
- [ ] E2E: Google login + email signup in extension + web app
- [ ] `AUTH-SETUP.md` + RU extension doc update

### 3.2 Taxonomy (B3)

- [ ] `schemas/categories.json`
- [ ] `normalize_tags` / `normalize_category` + tests
- [ ] Wire into enrich + capture pipelines
- [ ] Refactor `infer_category()` to schema

### 3.3 UI (B4 + filters + brand strings)

- [ ] EN translation + **Keep It For Me** in visible chrome
- [ ] Search: category, tag, RAG context, pills
- [ ] Extension: EN + product name in manifest `name` / titles

### 3.4 Verification

```bash
python3 -m py_compile agent-api/main.py
# + run normalize_tags unit tests when added
npm run build   # in website monorepo
```

Manual:

- [ ] No Russian in UI (except user content)
- [ ] OAuth + email auth smoke
- [ ] Search filters + pills work
- [ ] Extension loads; all screens EN

---

## 4. Architecture invariants (do not break)

1. **SSOT:** metadata + pipeline in Postgres (`knowledge_items`, `bookmark_page_content`, pgvector 1536).
2. **Pipeline:** `captured → enriched → indexed → searchable`.
3. **Extension auth:** bootstrap Bearer (`POST /api/v1/bookmarks/bootstrap`) — never ship admin API key in extension.
4. **DB env:** use `PGHOST` / `BOOKMARKS_PGHOST` — **not** `DATABASE_URL`.
5. **OpenRouter models:** full ID `<provider>/<model>` only.
6. **Obsidian path:** `Autoro KB/ws-{workspace_id}`.

Full infra: see AuthRAG `docs/ANTIGRAVITY-INFRA-BRIEF.md`.

---

## 5. Skills (Antigravity)

Run once in website monorepo:

```bash
bash scripts/link-antigravity-skills.sh
```

| Task | Skills |
|------|--------|
| UI / React | `modern-web-guidance`, `frontend-dev-guidelines`, `refero-cursor-warm-ivory` |
| API debug | `systematic-debugging`, `cbh-debug-playbook` |
| E2E extension | `playwright-skill` |
| Multi-phase build | `antigravity-workflows` or `supergoal` |

Read `AGENTS.md` (website or AuthRAG) before coding.

---

## 6. Obsidian memory protocol

**On session start:**

```
search_vault: "Keep It For Me", "BrowserBro", "Bookmarks Bro Phase 1"
```

**After Phase 1 milestone:**

- Update `Autoro/Bookmarks Bro Progress` (or create `Autoro/Keep It For Me Phase 1.md`)
- Tags: `#ai`, `#architecture`, `#bookmarks-bro`, `#keept`

---

## 7. API quick reference

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/bookmarks/bootstrap` | Extension service token |
| `POST /api/v1/bookmarks/auth/login` | Email login |
| `POST /api/v1/bookmarks/search` | Semantic/text search (`semantic`, `workspaceId`, `query`) |
| `GET /api/v1/bookmarks/library/facets` | Category + tag facets |
| `POST /api/v1/bookmarks/sync/start` | Start bookmark sync job |
| `POST /api/v1/knowledge/capture` | Ingest knowledge item |

---

## 8. Phase 1.5 preview (not now)

- Admin or batch **re-enrich** to normalize legacy tags in DB.
- Optional server-side category/tag filters in `bookmark_search` SQL.
- Domain cutover `keept.me` + marketing landing (separate from app route rename).

---

## 9. First message to Antigravity (copy-paste)

```
You are working on BrowserBro (product: Keep It For Me, domain keept.me).
Read docs/bookmarks-bro/ANTIGRAVITY-KEEPT-BRIEF.md and docs/ANTIGRAVITY-INFRA-BRIEF.md.
Implement Phase 1 in website monorepo (source of truth); AuthRAG sync at end.
Do not rename code paths (bookmarks-bro) — only user-visible EN strings → "Keep It For Me".
Re-enrich legacy tags: Phase 1.5 only.
Start with AUTH-SETUP.md (EN) + taxonomy schema, then UI EN + Search filters.
```
