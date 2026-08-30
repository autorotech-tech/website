# Antigravity — агентский режим Keept, keept.me, Kaggle Capstone

> **Copy-paste в Antigravity** после `git pull` в `AuthRAG` branch `bookmarks-bro`.  
> **Source of truth:** `website` (main) → `npm run keept:sync-authrag:apply`  
> **Deadline capstone:** 30 июня 2026, 23:59 PT

---

## 1. Почему падает CI (и что уже исправлено)

Workflow `.github/workflows/keept-staging-smoke.yml` в AuthRAG **не запускал ни одного job** (0s, failure).

**Причина:** `if: secrets.KEEPT_BOOKMARKS_API_KEY != ''` на уровне **job** — GitHub Actions не допускает `secrets` в job-level `if`, workflow отклоняется до старта.

**Исправление (в website, синк в AuthRAG):**
- `checklist-smoke` — всегда выполняется (статический smoke)
- `api-smoke` — проверка ключа в **step** через `env: API_KEY`; без секрета — notice, не failure
- `KEEPT_STAGING_API_BASE` — через **repository variable** (не secret)

**Секреты в GitHub (AuthRAG → Settings → Secrets):**

| Secret | Назначение |
|--------|------------|
| `KEEPT_BOOKMARKS_API_KEY` | Live API smoke на staging |

**Variable (optional):**

| Variable | Default |
|----------|---------|
| `KEEPT_STAGING_API_BASE` | `https://swoop.autoro.tech` |

---

## 2. Агентский режим работы (Antigravity × Cursor)

### 2.1 Роли

| Роль | Репо | Branch | Зона ответственности |
|------|------|--------|----------------------|
| **Cursor** | `website` | `main` | agent-api, Swoop shell, deploy staging, ops, CI fix |
| **Antigravity** | `AuthRAG` | `bookmarks-bro` | Keept Admin UI, ADK playground, Kaggle writeup/video, Contacts/Babylon Fish |
| **ADK local** | `google intensive/keep-it-for-me` | local | Граф агента, unit/eval tests, `make playground` |

### 2.2 Цикл синхронизации

```
Cursor правит website → npm run build → npm run keept:sync-authrag:apply
Antigravity: git pull AuthRAG/bookmarks-bro → работа → commit в AuthRAG
Cursor cherry-pick / ручной перенос критичных фиксов обратно в website
```

### 2.3 Режимы сессии Antigravity

**Режим A — Product (Keept user app)**  
Пути: `src/bookmarksBro/`, extension `extensions/bookmarks-bro/`  
Цель: capture, search, workspace, Obsidian sync UX.

**Режим B — Admin (moderation HITL)**  
Пути: `src/keeptAdmin/`  
Цель: очередь `pending_moderation`, approve/reject → resume ADK workflow.  
**Без** Swoop sidebar — отдельный shell.

**Режим C — ADK agent (Kaggle demo core)**  
Путь: `~/Desktop/n8n/google intensive/keep-it-for-me`  
Цель: `agent_workflow.py`, security gate, HITL interrupt, `make grade`.

**Режим D — Babylon Fish (voice + hints)**  
Пути: `ai-translator-backend/`, Keept contacts API  
Цель: LiveKit call, контекст контакта, real-time hints из базы Keept.

**Режим E — Capstone packaging**  
Артефакты: `docs/bookmarks-bro/KAGGLE-CAPSTONE-KEEPT.md`, видео 2 min, публичная ссылка.

### 2.4 Правила (не ломать)

- Не переименовывать массово `bookmarks-bro` / `bookmarksBro` в Phase 1
- Не дробить monolithic `agent-api/main.py` на staging без плана
- OpenRouter модели: полный формат `provider/model`
- Верификация после UI: `npm run build && npm run bookmarks-bro:smoke`

---

## 3. Идеи Keept для реализации (приоритет)

### P0 — Kaggle demo (до 30 июня)

1. **Secure capture pipeline** — PII/injection → `human_review` → Admin approve → Obsidian
2. **ADK 2.0 workflow graph** — parse → security → HITL → enrich | reject
3. **Публичная демо-ссылка** — staging `app.keept.me` или AI Studio app + writeup

### P1 — keept.me cutover

4. DNS Cloudflare (см. §4)
5. Prod env: `VITE_BOOKMARKS_SUPABASE_URL=https://auth.keept.me`
6. E2E: login → capture → admin approve

### P2 — Concierge agents (capstone track)

7. **Smart Contacts** — `bookmarks_bro.contacts`, context_summary, tags
8. **Babylon Fish integration** — Call button → LiveKit → Hints Engine из Keept KB
9. **Telegram assistant** — n8n workflow `keept_telegram_assistant.json` (уже в репо)
10. **Multi-agent roles** — Ingestion / Security / Moderator / Enricher / Sync (описано в KAGGLE-CAPSTONE-KEEPT.md)

### P3 — Production hardening

11. Spec-driven tests (Gherkin) для capture + moderation
12. Rate limits на `POST /api/v1/knowledge/capture`
13. Code-splitting SPA (bundle ~1 MB)

---

## 4. Cloudflare — keept.me (повтор инструкций)

**Origin VPS:** `46.250.228.229` (тот же хост, что `swoop.autoro.tech`)

### 4.1 DNS (зона keept.me)

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | @ | 46.250.228.229 | Proxied |
| A | app | 46.250.228.229 | Proxied |
| A | admin | 46.250.228.229 | Proxied |
| A | auth | 46.250.228.229 | Proxied |
| A | api | 46.250.228.229 | Proxied |
| CNAME | www | keept.me | Proxied |

### 4.2 SSL/TLS

1. Cloudflare → SSL/TLS → **Full (strict)**
2. Origin Server → создать **Origin Certificate** (15 лет)
3. На VPS: `/etc/ssl/cloudflare/keept.me.pem` + `.key`
4. nginx: `listen 443 ssl` с origin cert

### 4.3 Redirect rules

- `https://keept.me/` → 302 → `https://app.keept.me/`
- `https://www.keept.me/*` → 301 → `https://app.keept.me$1`

### 4.4 Cache

- `app.keept.me/assets/*` — cache 1 month
- `index.html`, `admin.*`, `auth.*`, `api.*` — **bypass cache**

### 4.5 nginx

Шаблон: `ops/nginx/keept.me.conf` → `/etc/nginx/sites-available/keept.me`  
Snippet BB Supabase: `ops/bookmarks-bro-supabase/nginx.bb-supabase.location.conf`

### 4.6 Supabase BB (после DNS)

Redirect URLs:
- `https://app.keept.me/**`
- `https://admin.keept.me/**`

Google OAuth callback: `https://auth.keept.me/auth/v1/callback`

### 4.7 Frontend build (prod)

```bash
VITE_AGENT_API_BASE=https://api.keept.me
VITE_BOOKMARKS_SUPABASE_URL=https://auth.keept.me
npm run build
```

### 4.8 Go-live checklist

- [ ] NS делегированы на Cloudflare
- [ ] A/CNAME записи
- [ ] Origin cert на VPS, `nginx -t`, reload
- [ ] Prod build с env выше
- [ ] BB Supabase redirect URLs + OAuth
- [ ] Smoke: app login → capture → admin approve
- [ ] CSP `connect-src` включает auth/api/app hostnames

**Полная версия:** [CLOUDFLARE-KEEPT-DNS.md](./CLOUDFLARE-KEEPT-DNS.md)

### Staging vs prod

| | Staging | Prod |
|---|---------|------|
| App | `swoop.autoro.tech/bookmarks-bro` | `app.keept.me` |
| Admin | `swoop.autoro.tech/keept/admin` | `admin.keept.me` |
| Auth | `swoop.autoro.tech/bb-supabase` | `auth.keept.me` |
| API | path `/api/v1` | `api.keept.me` |

---

## 5. Kaggle Capstone — соответствие требованиям

**Competition:** [Vibe Coding Agents Capstone](https://www.kaggle.com/competitions/vibecoding-agents-capstone-project)  
**Course:** [5-Day AI Agents Intensive](https://www.kaggle.com/learn-guide/5-day-agents)

### 5.1 Обязательные артефакты submission

| Артефакт | Keept mapping |
|----------|---------------|
| **Kaggle Writeup** | `docs/bookmarks-bro/KAGGLE-CAPSTONE-KEEPT.md` + публикация на Kaggle |
| **Описание ≤250 слов** | Secure knowledge concierge: capture → security → HITL → Obsidian |
| **Video demo ≤2 min** | Script в KAGGLE-CAPSTONE-KEEPT.md § Demonstration |
| **Публичная ссылка на app** | `https://app.keept.me` (prod) или AI Studio published app |
| **Track** | Concierge Agents / production agents |

### 5.2 Критерии оценки → что показать в демо

| Критерий | Вес | Keept proof |
|----------|-----|-------------|
| Impact | 40% | Личная KB + безопасный capture PII-heavy контента |
| Technical depth | 30% | ADK workflow, pgvector search, moderation API, Obsidian MCP |
| Creativity | 20% | HITL + multi-agent + Contacts→Babylon Fish hints |
| Quality | 10% | Refero Ivory admin UI, чёткий 2-min story |

### 5.3 ≥3 концептов курса (обязательно в writeup)

1. **ADK 2.0 stateful workflow** — граф с interrupt на `human_review_node`
2. **Security / zero-trust ingress** — `security.py`, redaction, moderation queue
3. **Human-in-the-loop** — Keept Admin approve → resume session
4. **MCP Obsidian** — sync только после approve
5. **Multi-agent** — classifier, enricher, moderator roles
6. **Vibe coding / Antigravity** — UI admin + ADK playground в отдельных репо

### 5.4 Видео-сценарий (2 минуты)

1. **0:00–0:30** — Clean capture → auto enrich → searchable in Keept
2. **0:30–1:15** — PII capture → pending → Admin queue с redacted preview
3. **1:15–1:45** — Approve → Obsidian note + embedding
4. **1:45–2:00** — Optional: ADK playground или search retrieval

### 5.5 Команды верификации (Antigravity)

```bash
# Website / AuthRAG mirror
cd "/Users/vlad_x/Desktop/n8n/autoro.tech/website"
npm run build
npm run bookmarks-bro:smoke
npm run keept:security:test

# ADK agent (НЕ из website/)
cd "/Users/vlad_x/Desktop/n8n/google intensive/keep-it-for-me"
uv run pytest tests/unit/test_security.py -v
make playground
make grade   # если настроено
```

---

## 6. Copy-paste prompt для Antigravity

```
Ты в AuthRAG branch bookmarks-bro (зеркало Keept из website).

ЗАДАЧИ (порядок):
1) git pull — убедись что keept-staging-smoke.yml исправлен (нет secrets в job if)
2) Track Capstone: дополни KAGGLE-CAPSTONE-KEEPT.md, запиши 2-min video script, подготовь writeup ≤250 слов
3) Track keept.me: следуй docs/bookmarks-bro/CLOUDFLARE-KEEPT-DNS.md (operator делает DNS; ты — nginx checklist + prod env)
4) Track Contacts: GET/POST /api/v1/keept/contacts + вкладка Contacts в bookmarksBro
5) Не трогай Swoop TaskList/Layout без запроса

Верификация:
npm run build && npm run bookmarks-bro:smoke
cd "../google intensive/keep-it-for-me" && uv run pytest tests/unit/test_security.py -v

Полная спека: docs/bookmarks-bro/ANTIGRAVITY-AGENT-MODE-KEEPT-ME.md
```

---

## Связанные документы

- [ANTIGRAVITY-HANDOFF.md](./ANTIGRAVITY-HANDOFF.md) — Keept × Babylon Fish
- [ANTIGRAVITY-KEEPT-ADMIN-CAPSTONE.md](./ANTIGRAVITY-KEEPT-ADMIN-CAPSTONE.md)
- [CLOUDFLARE-KEEPT-DNS.md](./CLOUDFLARE-KEEPT-DNS.md)
- [KAGGLE-CAPSTONE-KEEPT.md](./KAGGLE-CAPSTONE-KEEPT.md)
- [KEEPT-DEVELOPMENT-STATUS.md](./KEEPT-DEVELOPMENT-STATUS.md)
