# Keept — статус разработки

**Обновлено:** 2026-06-20  
**Prod domain (planned):** keept.me · **Staging:** swoop.autoro.tech

---

## Фазы

| Phase | Область | Статус | Где |
|-------|---------|--------|-----|
| **A** | Security screen (PII, injection) в ADK | ✅ Done | `keep-it-for-me/app/app_utils/security.py` |
| **B** | Backend port + unit tests | ✅ Done | `website/agent-api/security.py`, AuthRAG mirror |
| **C** | Capture → moderation queue + API | ✅ Done | `agent-api/main.py`, SQL `003_capture_moderation_queue.sql` |
| **D** | Keept Admin UI (`/keept/admin`) | ✅ Done | `src/keeptAdmin/*` (Antigravity) |
| **E** | ADK `capture_workflow` + HITL fix | ✅ Done | `fast_api_app.py` — Event-based HITL detection |
| **F** | Kaggle + ADK docs | ✅ Done | `KAGGLE-CAPSTONE-KEEPT.md`, `ADK-WORKFLOW-HITL.md` |
| **G** | Cloudflare keept.me + nginx | 📋 Operator | [CLOUDFLARE-KEEPT-DNS.md](./CLOUDFLARE-KEEPT-DNS.md), [ops/nginx/keept.me.conf](../../ops/nginx/keept.me.conf) |
| **H** | Staging deploy + E2E QA | 🟡 Deploy ✅ · QA manual | [swoop `/keept/admin`](https://swoop.autoro.tech/keept/admin) |
| **I** | Kaggle video + submission | 🔜 | [KAGGLE-CAPSTONE-KEEPT.md](./KAGGLE-CAPSTONE-KEEPT.md) |

---

## Antigravity deliverables (Phase A–D)

Реализовано в AuthRAG и перенесено в website (source of truth):

- `src/keeptAdmin/KeeptAdminApp.tsx` — изолированный layout, gate по `bookmarks_bro_bootstrap_token`
- `ModerationPanel.tsx` — KPI, workspace selector, approve/reject
- `SettingsPanel.tsx` — Swoop provider catalog
- `services/moderationApi.ts` — `pending_approval`, resolve, catalog
- `styles/admin.css` — warm cream / `#f54e00` CTA

**Verification (Antigravity):** `npm run build` OK · ADK 7+11+6 pytest passed

---

## Cursor / website (Phase C backend)

- `POST /api/v1/knowledge/capture` → `pending_moderation` при security flag
- `GET /api/v1/keept/moderation/items?status=pending_approval`
- `POST /api/v1/keept/moderation/resolve`
- Smoke: `npm run bookmarks-bro:smoke` (включая `keept-admin`)

---

## Команды из корня website

```bash
npm run build
npm run bookmarks-bro:smoke
npm run keept:security:test      # ADK unit + integration + agent-api security
npm run keept:adk:playground     # ADK dev UI (keep-it-for-me)
npm run keept:sync-authrag:apply # website → AuthRAG bookmarks-bro
npm run keept:deploy:staging     # swoop.autoro.tech SPA + agent-api
```

ADK живёт **вне** monorepo — не используйте `cd "google intensive/..."` из `website/`.

---

## Следующие шаги

1. **Staging deploy** — agent-api с moderation API + SPA с `/keept/admin`
2. **Manual QA** — capture с email → pending → approve в admin
3. **Cloudflare** — DNS по [CLOUDFLARE-KEEPT-DNS.md](./CLOUDFLARE-KEEPT-DNS.md)
4. **Kaggle** — запись demo по [KAGGLE-CAPSTONE-KEEPT.md](./KAGGLE-CAPSTONE-KEEPT.md)
5. **Owner role gate** — уточнить RBAC в BB Supabase (сейчас bootstrap token)

---

## Sync workflow

```bash
# Cursor commits website main
npm run keept:sync-authrag:apply

# Antigravity
cd AuthRAG && git checkout bookmarks-bro && git pull
```
