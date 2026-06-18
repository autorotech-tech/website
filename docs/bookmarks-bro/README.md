# Keep It For Me — documentation index

Product: **Keep It For Me** (Keept) · Domain: **keept.me** · Code: `bookmarks-bro` / `bookmarksBro`

## Start here (Antigravity)

1. **[ANTIGRAVITY-HANDOFF.md](./ANTIGRAVITY-HANDOFF.md)** — paste entire file into Antigravity session
2. **[AUTH-SETUP.md](./AUTH-SETUP.md)** — staging URLs, env vars, OAuth, where operators get secrets
3. **[ANTIGRAVITY-KEEPT-BRIEF.md](./ANTIGRAVITY-KEEPT-BRIEF.md)** — Phase 1 checklist
4. **[ANTIGRAVITY-SWOOP-KEEPT.md](./ANTIGRAVITY-SWOOP-KEEPT.md)** — Swoop control plane × Keept data plane

## Architecture & ops

| Doc | Topic |
|-----|--------|
| [MATHEMATICAL-MODEL.md](./MATHEMATICAL-MODEL.md) | Scoring, RAG, enrichment model |
| [ADMIN-MULTIUSER.md](./ADMIN-MULTIUSER.md) | Workspaces, Telegram, multi-user |
| [TESTING.md](./TESTING.md) | Smoke tests, Chrome extension |
| [../ops/bookmarks-bro-supabase/README.md](../../ops/bookmarks-bro-supabase/README.md) | BB Supabase stack (RU) |

## Repos & sync

| Repo | Branch | Role |
|------|--------|------|
| [website](https://github.com/autorotech-tech/website) | `main` | Source of truth (Cursor) |
| [AuthRAG](https://github.com/autorotech-tech/AuthRAG) | `bookmarks-bro` | Antigravity mirror |

```bash
# From website root — push slice to AuthRAG
npm run keept:sync-authrag:apply
```

## Code map (Understand Anything)

```bash
npm run understand-anything:install
/understand src/bookmarksBro agent-api extensions/bookmarks-bro --language en
/understand-dashboard
```

Fork: https://github.com/autorotech-tech/Understand-Anything
