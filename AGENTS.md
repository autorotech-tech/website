# AGENTS.md — Autoro.tech / website

Универсальные правила для агентов (Cursor, Antigravity, Claude Code и др.). Детали по Apify: см. `[.agents/AGENTS.md](.agents/AGENTS.md)`.

## Стек и границы проекта


| Область                | Выбор                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Сборка                 | Vite 5, TypeScript                                                   |
| UI                     | React 18, React Router 6, Tailwind CSS 3                             |
| Данные / auth          | `@supabase/supabase-js` (клиент), без секретов в репозитории         |
| Контент                | `react-markdown`, `remark-gfm`                                       |
| Язык ответов в задачах | По запросу пользователя — русский; код и комментарии — как в проекте |


**Ограничения:** минимальные правки по задаче; не менять несвязанные файлы; ключи и токены только через env / секреты CI; не отключать проверки без причины.

**Проверки после изменений:** при затрагивании фронта — `npm run build` (и при необходимости `npm run dev` для ручной проверки).

## Baseline и Modern Web Guidance (Chrome)

**Baseline target:** Baseline Widely available (по умолчанию для [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance)).

Для HTML/CSS и клиентского JS агент **сначала** применяет skill **`modern-web-guidance`** (`.agents/skills/modern-web-guidance/`): `search` → `retrieve` по id через `npx modern-web-guidance@latest` (см. `SKILL.md`). Установка/обновление: `npm run modern-web-guidance:install`.

## OpenRouter: ключи и модель (обязательно)

- Ключи OpenRouter задаются в админке Swoop: `Admin -> Settings -> OpenRouter`.
- Для OpenRouter модель всегда указывается в полном формате: `<provider>/<model>`.
- Нельзя использовать короткие имена моделей без префикса провайдера (например, `claude-3.7-sonnet`).

Примеры корректных моделей:

- `anthropic/claude-3.7-sonnet`
- `anthropic/claude-3.5-sonnet`
- `openai/gpt-4o-mini`
- `google/gemini-2.5-pro`

Рекомендуемый baseline:

- default model: `anthropic/claude-3.7-sonnet`
- fallback model: `openai/gpt-4o-mini`

## LMArena Bridge (LM Arena через OpenAI API)

- Ключи и base URL: Swoop `Admin -> Settings` → **LMArena Bridge** (`lmarena_keys`, `lmarena_base_url`, `lmarena_default_model`).
- Upstream: [LMArenaBridge](https://github.com/CloudWaddie/LMArenaBridge); деплой: `deploy/lmarena-bridge/README.md`.
- В agent-api провайдер routing: `lmarena`; в `POST /v1/chat/completions` модель: `lmarena/<slug-на-bridge>` (не путать с OpenRouter `provider/model`).
- Env fallback для base: `BOOKMARKS_LMARENA_API_BASE` (например `http://lmarenabridge:8000/api/v1`).

## Какие skills применять при типовых задачах

Глобальная коллекция skills лежит в `~/.cursor/skills/skills/` (репозиторий superpowers + установленные вручную). Для **Antigravity** их нужно «подключить» симлинками в `~/.gemini/antigravity/skills/` — один раз выполните в корне репозитория:

```bash
bash scripts/link-antigravity-skills.sh
npm run marketing-skills:install   # ericosiu/ai-marketing-skills → ~/.cursor/skills/skills/ai-mkt-*
npm run bughunter-skills:install   # Claude-BugHunter → ~/.cursor/skills/skills/cbh-*
npm run supergoal-skills:install   # autorotech-tech/supergoal → ~/.cursor/skills/skills/supergoal
npm run ai-engineering-coach:install  # autorotech-tech/AI-Engineering-Coach → VSIX + skill
```


| Задача                                      | Skills (имена папок)                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| Keept / Antigravity handoff                 | `docs/bookmarks-bro/ANTIGRAVITY-HANDOFF.md`; `npm run keept:sync-authrag`         |
| Карта кодовой базы Keept                      | `/understand`, `/understand-dashboard` (после `npm run understand-anything:install`) |
| UI/лендинг, визуальная иерархия             | `modern-web-guidance`, `frontend-design`, `refero-cursor-warm-ivory`; [`DESIGN.md`](DESIGN.md) |
| Новый/рефакторинг UI-компонентов            | `modern-web-guidance`, `frontend-design`, `frontend-dev-guidelines`, `refero-cursor-warm-ivory` + `DESIGN.md` |
| A11y, dialog/popover, формы, CWV (LCP/INP)  | `modern-web-guidance` (обязательно search + retrieve перед кодом) |
| E2E браузер, стабильные тесты               | `playwright-skill`, при необходимости `playwright-skill-lackeyjb`                 |
| Многофазный сценарий (план → сборка → тест) | `antigravity-workflows`                                                           |
| Автономный end-to-end build (план → фазы → аудит) | `supergoal` (после `npm run supergoal-skills:install`); slash `/supergoal`      |
| Коучинг agentic workflow, anti-patterns, prompt quality | `ai-engineering-coach` (после `npm run ai-engineering-coach:install`); slash `/ai-engineering-coach`; дашборд — Command Palette → AI Engineer Coach |
| Документы, Markdown, презентации            | `doc-coauthoring`, `revealjs-skill`                                               |
| SEO, структура контента                     | `seo-content-writer`, `seo-structure-architect`; маркетинг-опсы: `ai-mkt-seo-ops`, `ai-mkt-content-ops` |
| Growth / A/B, scorecard, pacing             | `ai-mkt-growth-engine` (после `npm run marketing-skills:install`)                 |
| Outbound, ICP, sequences                    | `ai-mkt-outbound-engine`, `ai-mkt-sales-pipeline`                                 |
| CRO, лендинги, конверсия                    | `ai-mkt-conversion-ops`, `ai-mkt-autoresearch`                                    |
| Каталог всех marketing skills               | `ai-mkt-catalog` — [ericosiu/ai-marketing-skills](https://github.com/ericosiu/ai-marketing-skills) |
| Отладка багов, 502, CI, root cause          | `systematic-debugging`, `cbh-debug-playbook` (проект)                               |
| Security triage / bug bounty workflow       | `cbh-triage-validation`, `cbh-bb-methodology`; slash `/triage`, `/validate`       |
| OWASP-класс (XSS, SQLi, IDOR, SSRF, auth)   | `cbh-hunt-*` — [Claude-BugHunter](https://github.com/elementalsouls/Claude-BugHunter) |
| Каталог BugHunter skills                    | `cbh-catalog` (после `npm run bughunter-skills:install`)                          |
| Копирайтинг                                 | `writing-guru`, `copywriting`                                                     |
| Подключение MCP-серверов                    | `mcp-builder`                                                                     |
| Разработка скиллов                          | `skill-creator`                                                                   |
| Apify Actors, скрапинг                      | см. `.agents/AGENTS.md` — `apify-actor-development`, `apify-actorization`, и т.д. |


Агент выбирает skill по полю `description` в `SKILL.md`; при узкой задаче можно явно указать имя папки.

## Приоритет источников

1. Правила в этом файле и в `.cursor/rules/`.
2. Workspace skills: `.agents/skills/` и `.cursor/skills/` — переопределяют глобальные с тем же именем.
3. Глобальные skills Antigravity: `~/.gemini/antigravity/skills/`.

## Связанные файлы

- `DESIGN.md` — Cursor design system из [awesome-design-md](https://github.com/VoltAgent/awesome-design-md); обновление: `npm run design:sync-cursor`.
- [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) — skill `modern-web-guidance`; обновление: `npm run modern-web-guidance:install`.
- `.cursor/CURSOR-HANDBOOK.md` — справка по Skills / Rules / MCP и как открыть её в отдельной колонке; инвентарь: `npm run cursor:inventory` → `.cursor/CURSOR-INVENTORY.generated.md`.
- `GEMINI.md` — краткие настройки для Google Antigravity.
- `scripts/link-antigravity-skills.sh` — симлинки Cursor skills → Antigravity.
- **Keep It For Me (keept.me):** handoff для Antigravity — `docs/bookmarks-bro/ANTIGRAVITY-HANDOFF.md`; синк в AuthRAG — `npm run keept:sync-authrag:apply`; карта кода — `npm run understand-anything:install` → `/understand src/bookmarksBro agent-api extensions/bookmarks-bro`.

