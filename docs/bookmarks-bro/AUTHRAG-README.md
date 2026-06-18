# AuthRAG — Keep It For Me (Keept)

**AuthRAG** (`bookmarks-bro` branch) — зеркало продукта **Keep It For Me** (Keept, `keept.me`) для Google Antigravity.  
Код: `bookmarks-bro` / `bookmarksBro`. Source of truth: [autorotech-tech/website](https://github.com/autorotech-tech/website) `main`.

## Antigravity: первые 5 минут

1. Вставь в чат целиком: **`docs/bookmarks-bro/ANTIGRAVITY-HANDOFF.md`**
2. Auth & staging: **`docs/bookmarks-bro/AUTH-SETUP.md`**
3. Phase 1 задачи: **`docs/bookmarks-bro/ANTIGRAVITY-KEEPT-BRIEF.md`**
4. Архитектура Swoop × Keept: **`docs/bookmarks-bro/ANTIGRAVITY-SWOOP-KEEPT.md`**
5. Карта кода: `bash scripts/setup-understand-anything.sh` → `/understand src/bookmarksBro agent-api extensions/bookmarks-bro --language en`

Полный индекс: **`docs/bookmarks-bro/README.md`**

## Состав репозитория

| Путь | Назначение |
|------|------------|
| `src/` | React SPA (Vite) — маршрут `/bookmarks-bro` |
| `src/bookmarksBro/` | Keept UI |
| `agent-api/` | FastAPI backend |
| `extensions/bookmarks-bro/` | Chrome MV3 extension |
| `ops/bookmarks-bro-supabase/` | Изолированный BB Supabase |
| `docs/bookmarks-bro/` | Handoff, auth, testing, architecture |
| `package.json` | `npm run dev`, `npm run build`, smoke scripts |
| `GEMINI.md` / `AGENTS.md` | Правила Antigravity |

## Локальная разработка

```bash
npm install
cp .env.example .env   # заполнить BB anon key — см. AUTH-SETUP.md (не коммитить .env)
npm run dev            # SPA + proxy /api/v1 → agent-api:8900

cd agent-api && pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8900

npm run build
npm run bookmarks-bro:smoke
```

Extension: Chrome → Load unpacked → `extensions/bookmarks-bro/`

## Staging (без секретов в git)

| Service | URL |
|---------|-----|
| Keept app | https://swoop.autoro.tech/bookmarks-bro |
| BB Supabase | https://swoop.autoro.tech/bb-supabase |
| agent-api | https://swoop.autoro.tech/api/v1/health |

Секреты: VPS `vladx@46.250.228.229` или оператор — см. **AUTH-SETUP.md §4**.

## Sync из website (Cursor)

```bash
npm run keept:sync-authrag:apply
```

## Дополнительно

- [ROADMAP.md](./ROADMAP.md) — фазы (legacy)
- [docs/ANTIGRAVITY-INFRA-BRIEF.md](./docs/ANTIGRAVITY-INFRA-BRIEF.md) — инфра brief
