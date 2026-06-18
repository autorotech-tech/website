# Keep It For Me — Auth & Access Setup (Phase 1)

> **Product:** Keep It For Me (Keept) · **Staging:** `https://swoop.autoro.tech/bookmarks-bro`  
> **Audience:** operators and Antigravity agents · **Secrets:** never commit real keys — use VPS / Swoop Admin only

---

## 1. Two Supabase stacks (critical)

| Stack | URL (staging) | Used by |
|-------|---------------|---------|
| **Swoop (main)** | `https://swoop.autoro.tech/supabase` | Swoop admin, blog, scrapling, operator auth |
| **BB (Bookmarks / Keept)** | `https://swoop.autoro.tech/bb-supabase` | Keept web app, Chrome extension, end users |

Keept users **must not** use Swoop operator accounts. All Keept auth goes through **BB Supabase**.

---

## 2. Staging endpoints

| Service | URL |
|---------|-----|
| Keept web app | `https://swoop.autoro.tech/bookmarks-bro` |
| Keept admin (operators) | `https://swoop.autoro.tech/admin/bookmarks-bro` |
| BB Supabase (Auth + REST) | `https://swoop.autoro.tech/bb-supabase` |
| agent-api health | `https://swoop.autoro.tech/api/v1/health` |
| VPS SSH | `vladx@46.250.228.229` (keys on operator machine only) |

---

## 3. Environment variables

### 3.1 Frontend (`.env` / `.env.example` in website root)

Copy from `.env.example`. For local dev:

```bash
# BB Auth — staging anon key from operator (Swoop / VPS .env, NOT committed)
VITE_SUPABASE_URL=https://swoop.autoro.tech/bb-supabase
VITE_SUPABASE_ANON_KEY=<BOOKMARKS_SUPABASE_ANON_KEY>

# agent-api: leave empty in dev → Vite proxies /api/v1 → localhost:8900
# VITE_AGENT_API_BASE=
# VITE_AGENT_API_PROXY_TARGET=http://127.0.0.1:8900

# Optional: direct agent-api key for admin panel
# VITE_BOOKMARKS_API_KEY=<from Swoop Admin → Settings or VPS agent-api env>
```

### 3.2 agent-api (VPS `.env` or `ops/bookmarks-bro-supabase/.env.agent-api.bookmarks.example`)

```bash
BOOKMARKS_SUPABASE_URL=https://swoop.autoro.tech/bb-supabase
BOOKMARKS_SUPABASE_ANON_KEY=<anon key from BB stack>
BOOKMARKS_PGHOST=supabase-db-bb          # or host from VPS compose
BOOKMARKS_PGPORT=5432
BOOKMARKS_PGDATABASE=postgres
BOOKMARKS_PGUSER=postgres              # role varies per stack — see ops README
BOOKMARKS_PGPASSWORD=<from BB stack .env on VPS>

# LLM keys: prefer Swoop Admin → Settings → OpenRouter / Provider keys
# OpenRouter model IDs must be full: anthropic/claude-3.7-sonnet
```

Full template: `ops/bookmarks-bro-supabase/.env.agent-api.bookmarks.example`

### 3.3 Chrome extension (`extensions/bookmarks-bro/`)

In extension **Settings** (or `extension-config.js` defaults for testing):

| Field | Staging value |
|-------|---------------|
| API Base | `https://swoop.autoro.tech` |
| Supabase Auth Path | `/bb-supabase` |
| Workspace | auto via `POST /api/v1/bookmarks/workspaces/ensure` after login |

---

## 4. Where operators get secrets (not in git)

| Secret | Location |
|--------|----------|
| BB anon key, DB password | VPS: BB Supabase `.env` under compose dir (e.g. `/home/vladx/supabase-bookmarks-bro`) |
| agent-api provider keys | Swoop **Admin → Settings → OpenRouter** / Provider API Keys |
| Google OAuth (BB) | Google Cloud Console + BB Supabase **Authentication → Providers → Google** |
| Microsoft OAuth (BB) | Azure App Registration + BB Supabase **Providers → Azure** |
| SSH / deploy | Operator SSH key to `46.250.228.229` |

Run on VPS to inspect (operator only):

```bash
grep BOOKMARKS_ /home/vladx/website/.env 2>/dev/null || true
docker compose -f docker-compose.yml ps agent-api
```

---

## 5. OAuth — Chrome extension

See **`extensions/bookmarks-bro/SUPABASE_OAUTH_SETUP.md`** (RU checklist).

**Redirect URL** (required in BB Supabase → Authentication → URL Configuration):

```text
chrome-extension://<EXTENSION_ID>/oauth-callback.html
```

Get `EXTENSION_ID` from `chrome://extensions` (Developer mode). ID changes when reloading unpacked extension — update Supabase when it changes.

**Web app redirects** (if using email magic link / OAuth in browser):

```text
https://swoop.autoro.tech/bookmarks-bro
https://swoop.autoro.tech/bookmarks-bro/*
```

---

## 6. Deploy / connect agent-api to BB stack

From website root on VPS:

```bash
docker compose \
  -f docker-compose.yml \
  -f ops/bookmarks-bro-supabase/docker-compose.agent-api.bookmarks.override.yml \
  up -d --build agent-api
```

Bootstrap BB stack: `ops/bookmarks-bro-supabase/bootstrap.sh`  
Recovery: `ops/bookmarks-bro-supabase/recover_bb_stack.sh`  
SQL: `ops/bookmarks-bro-supabase/sql/001_bookmarks_bro_isolation.sql`, `002_telegram_assistant.sql`  
App schema: `migrate_bookmarks_bro_mvp.sql`

---

## 7. Local development

```bash
npm install
npm run dev                    # SPA + proxy /api/v1 → agent-api
cd agent-api && pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8900

npm run build                  # production bundle
npm run bookmarks-bro:smoke    # needs live API + env
npm run bookmarks-bro:api-test
```

Extension: Chrome → Load unpacked → `extensions/bookmarks-bro/` (manifest version **integers only**, e.g. `0.3.1`).

---

## 8. Troubleshooting (B1 / B2)

| Symptom | Check |
|---------|--------|
| OAuth popup closes, no session | Redirect URL in BB Supabase matches `chrome-extension://…/oauth-callback.html` |
| 401 on API | User logged into BB (not Swoop); `Authorization: Bearer <jwt>` present |
| Extension "Test Connection" fails | API Base + Auth Path; agent-api up; CORS/nginx `/api/v1` |
| Wrong user's data | RLS + `workspace_id` — see `ADMIN-MULTIUSER.md` |
| Google login error | Google Console redirect = `https://swoop.autoro.tech/bb-supabase/auth/v1/callback` |

---

## 9. Phase 1 vs Phase 2

**Phase 1 (now):** document and fix OAuth/email; workspace via `workspaces/ensure`; no JWT middleware hardening.  
**Phase 2 (later):** JWT-scoped workspaces, `workspace_members`, RLS hardening — see `ANTIGRAVITY-KEEPT-BRIEF.md` §2.5.

**Re-enrich existing bookmarks with new taxonomy:** Phase 1.5 — normalization on write-path only in Phase 1.

---

## 10. Related docs

| Doc | Purpose |
|-----|---------|
| `ANTIGRAVITY-HANDOFF.md` | Full Antigravity session context |
| `ANTIGRAVITY-KEEPT-BRIEF.md` | Phase 1 task checklist |
| `ANTIGRAVITY-SWOOP-KEEPT.md` | Swoop × Keept architecture |
| `ADMIN-MULTIUSER.md` | Workspaces, Telegram |
| `TESTING.md` | Smoke tests, extension |
| `ops/bookmarks-bro-supabase/README.md` | BB stack ops (RU) |
