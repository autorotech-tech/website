# GEMINI.md — Google Antigravity

Настройки для **Antigravity** в этом репозитории. Общие правила и маршрутизация skills: см. `[AGENTS.md](AGENTS.md)`.

## Подключение skills

Antigravity читает skills из:

- **Глобально:** `~/.gemini/antigravity/skills/<имя>/SKILL.md`
- **Проект:** `.agent/skills/<имя>/SKILL.md` (имеет приоритет над глобальными с тем же именем)

Чтобы подтянуть **всю** коллекцию из Cursor (`~/.cursor/skills/skills/`), выполните из корня репозитория:

```bash
bash scripts/link-antigravity-skills.sh
```

Перезапустите Antigravity после первого подключения или после массового обновления skills.

## Keep It For Me (Keept) — handoff для Antigravity

Продукт **Keep It For Me** (бренд **Keept**, домен **keept.me**). В коде Phase 1 пути **`bookmarks-bro`** / **`bookmarksBro`** не переименовывать.

| Роль | Репозиторий | Ветка |
|------|-------------|-------|
| Source of truth (Cursor) | `github.com/autorotech-tech/website` | `main` |
| Зеркало для Antigravity | `github.com/autorotech-tech/AuthRAG` | `bookmarks-bro` |

**Первое сообщение в новой сессии Antigravity:** вставьте целиком `docs/bookmarks-bro/ANTIGRAVITY-HANDOFF.md`.

**Синхронизация website → AuthRAG** (из корня website):

```bash
npm run keept:sync-authrag          # dry-run
npm run keept:sync-authrag:apply    # rsync + git push в AuthRAG
```

**Карта кодовой базы** — [Understand Anything](https://github.com/autorotech-tech/Understand-Anything):

```bash
npm run understand-anything:install   # один раз; затем перезапуск Antigravity
```

В чате Antigravity:

```
/understand src/bookmarksBro agent-api extensions/bookmarks-bro --language en
/understand-dashboard
```

Граф сохраняется в `.understand-anything/knowledge-graph.json` (в `.gitignore`).

**Phase 1 открытые задачи:** см. `docs/bookmarks-bro/ANTIGRAVITY-KEEPT-BRIEF.md` — AUTH-SETUP, taxonomy, EN UI, search filters.

**Staging:** `https://swoop.autoro.tech/bookmarks-bro`, BB Supabase: `…/bb-supabase`.

**Память:** Obsidian — заметки `Keep It For Me — Antigravity Handoff`, `Bookmarks Bro Progress`.


- **Семантически:** формулируйте задачу обычным языком — агент подхватывает skill по `description` в `SKILL.md`.
- **Явно:** можно сослаться на сценарий, например: «следуй workflow из `antigravity-workflows` для SaaS MVP».
- **Каталог `/learn`:** опционально — `git clone https://github.com/agentskill-sh/ags.git ~/.gemini/antigravity/skills/learn`, затем в чате команды вида `/learn …`.

## OpenRouter policy

- Для OpenRouter в любом конфиге использовать только полный ID модели: `<provider>/<model>`.
- Не использовать короткие имена (`claude-3.7-sonnet`, `gpt-4o-mini`, `gemini-2.5-pro`) без провайдера.
- В Swoop админке ключ задаётся в `Admin -> Settings -> OpenRouter`.
- Рекомендуемые модели:
  - default: `anthropic/claude-3.7-sonnet`
  - fallback: `openai/gpt-4o-mini`

### Cursor + OpenRouter

- При добавлении модели в Cursor вводить exact model ID вручную и подтверждать Enter.
- После изменения API key/model в Cursor: перезапуск Cursor + новый чат.

## Стек проекта (кратко)

Vite, React 18, TypeScript, Tailwind, Supabase client — см. `package.json`. Не коммитить секреты.

## MCP vs Skills

- **Skills** — методология (как и когда).
- **MCP** — доступ к внешним системам; настраивается в IDE отдельно от skills.

