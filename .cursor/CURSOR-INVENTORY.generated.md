<!-- Автогенерация: node scripts/generate-cursor-inventory.mjs -->
**Обновлено:** 2026-05-25T10:41:29.571Z

## Skills (этот репозиторий)

### `apify-actor-development`
- **Папка:** `apify-actor-development`
- **Файл:** [`.agents/skills/apify-actor-development/SKILL.md`](.agents/skills/apify-actor-development/SKILL.md)
- **Описание:** Develop, debug, and deploy Apify Actors - serverless cloud programs for web scraping, automation, and data processing. Use when creating new Actors, modifying existing ones, or troubleshooting Actor code.
- **Автовызов агентом:** да (по релевантности)
- **Команда в чате Agent:** `/apify-actor-development` или текстом «используй skill apify-actor-development»

### `apify-actorization`
- **Папка:** `apify-actorization`
- **Файл:** [`.agents/skills/apify-actorization/SKILL.md`](.agents/skills/apify-actorization/SKILL.md)
- **Описание:** Convert existing projects into Apify Actors - serverless cloud programs. Actorize JavaScript/TypeScript (SDK with Actor.init/exit), Python (async context manager), or any language (CLI wrapper). Use when migrating code to Apify, wrapping CLI tools as Actors, or adding Actor SDK to existing projects.
- **Автовызов агентом:** да (по релевантности)
- **Команда в чате Agent:** `/apify-actorization` или текстом «используй skill apify-actorization»

### `apify-generate-output-schema`
- **Папка:** `apify-generate-output-schema`
- **Файл:** [`.agents/skills/apify-generate-output-schema/SKILL.md`](.agents/skills/apify-generate-output-schema/SKILL.md)
- **Описание:** Generate output schemas (dataset_schema.json, output_schema.json, key_value_store_schema.json) for an Apify Actor by analyzing its source code. Use when creating or updating Actor output schemas.
- **Автовызов агентом:** да (по релевантности)
- **Команда в чате Agent:** `/apify-generate-output-schema` или текстом «используй skill apify-generate-output-schema»

### `apify-ultimate-scraper`
- **Папка:** `apify-ultimate-scraper`
- **Файл:** [`.agents/skills/apify-ultimate-scraper/SKILL.md`](.agents/skills/apify-ultimate-scraper/SKILL.md)
- **Описание:** Universal AI-powered web scraper for any platform. Scrape data from Instagram, Facebook, TikTok, YouTube, Google Maps, Google Search, Google Trends, Booking.com, and TripAdvisor. Use for lead generation, brand monitoring, competitor analysis, influencer discovery, trend research, content analytics, audience analysis, or any data extraction task.
- **Автовызов агентом:** да (по релевантности)
- **Команда в чате Agent:** `/apify-ultimate-scraper` или текстом «используй skill apify-ultimate-scraper»

### `cbh-debug-playbook`
- **Папка:** `cbh-debug-playbook`
- **Файл:** [`.cursor/skills/cbh-debug-playbook/SKILL.md`](.cursor/skills/cbh-debug-playbook/SKILL.md)
- **Описание:** Autoro.tech debug router — systematic-debugging first, then cbh-triage-validation for security findings, cbh-hunt-* by bug class. Use for 502, blog Next.js, nginx-proxy, Vite build failures, and authorized security checks.
- **Автовызов агентом:** да (по релевантности)
- **Команда в чате Agent:** `/cbh-debug-playbook` или текстом «используй skill cbh-debug-playbook»

### `modern-web-guidance`
- **Папка:** `modern-web-guidance`
- **Файл:** [`.agents/skills/modern-web-guidance/SKILL.md`](.agents/skills/modern-web-guidance/SKILL.md)
- **Описание:** | Search tool for modern web development best practices. MANDATORY: Execute FIRST for all HTML/CSS and clientside JS tasks. Do NOT skip — web APIs evolve rapidly and training weights contain obsolete patterns. Trigger immediately for: - UI/Layout: Modals, dialogs, popovers, Glassmorphism/backdrop-filters, anchor positioning, container queries, `:has()`, `:user-valid`. - Scroll/Motion: View Transitions, Scroll-driven animations, scroll parallax/reveals. - Performance: CWV (LCP, INP), content-visibility, Fetch Priority, image optimization. - System/APIs: Local filesystem access, WebUSB, WebSockets sync, WebAssembly widgets. - Frameworks: Adapting layout/styles in React, Vue, Angular. - General Frontend: Forms, autofill, advanced inputs, custom scrollbars, modern component states, etc. DO NOT trigger for: - Backend: Database SQL, ORMs, Express API routes. - Pipelines: CI/CD deployment, Docker, Actions. - Generic: Local scripts (Python/Go tools), ESLint, Git.
- **Автовызов агентом:** да (по релевантности)
- **Команда в чате Agent:** `/modern-web-guidance` или текстом «используй skill modern-web-guidance»

### `refero-cursor-warm-ivory`
- **Папка:** `refero-cursor-warm-ivory`
- **Файл:** [`.cursor/skills/refero-cursor-warm-ivory/SKILL.md`](.cursor/skills/refero-cursor-warm-ivory/SKILL.md)
- **Описание:** Применяет официальный Stitch-style DESIGN.md для бренда Cursor из репозитория VoltAgent awesome-design-md: warm-cream canvas (#f7f7f4), ink (#26251e), Cursor Orange (#f54e00) для primary CTA, CursorGothic + JetBrains Mono на коде, hairlines без drop shadows, timeline-пастели только для таймлайна агента. Использовать при лендингах, UI, Tailwind/CSS, когда пользователь просит Cursor marketing look, awesome-design-md, DESIGN.md в корне или этот skill.
- **Автовызов агентом:** да (по релевантности)
- **Команда в чате Agent:** `/refero-cursor-warm-ivory` или текстом «используй skill refero-cursor-warm-ivory»

## Rules (этот репозиторий)

| Файл | Когда | Режим |
|------|--------|--------|
| `check-task-solutions.mdc` | При появлении задачи на парсинг, интеграцию API, скрапинг, мониторинг цен, SEO, соцсети, лиды, вакансии или выбор готового решения — сначала проверить базу решений и справочники проекта. | intelligent / по описанию |
| `claude-bughunter-debug.mdc` | Отладка багов, 502, CI, security-регрессии — systematic-debugging + Claude-BugHunter (cbh-*). Читать cbh-debug-playbook и при security — cbh-triage-validation. | intelligent / по описанию |
| `modern-web-guidance.mdc` | - Chrome Modern Web Guidance — современные HTML/CSS/клиентский JS, a11y, perf, dialog/popover, Baseline. Обязательно skill modern-web-guidance + search/retrieve CLI. | globs: `- "**/src/**/*.tsx"
  - "**/src/**/*.ts"
  - "**/src/**/*.cs…` |
| `obsidian-memory-protocol.mdc` | Long-Term Memory Protocol — use Obsidian MCP tools (search_vault, read_note, update_note, append_to_note) to maintain context across sessions and document progress. | alwaysApply |
| `refero-warm-ivory-design.mdc` | - DESIGN.md Cursor из VoltAgent awesome-design-md — cream canvas, Cursor Orange, CursorGothic + JetBrains Mono, hairlines без теней. | globs: `- "**/src/**/*.tsx"
  - "**/src/**/*.css"
  - "**/index.html…` |
| `shadcn-ui-design.mdc` | Использовать shadcn/ui для UI-компонентов в blog-autoro и autoro.tech. | globs: `["**/blog-autoro/**", "**/website/**"]…` |

## Skills (глобально на машине)

**Корень:** `/Users/vlad_x/.cursor/skills/skills` — **всего:** 862 skills

*В чате Agent список удобнее искать через `/` (slash). Ниже — первые 35 по алфавиту.*

- `3d-web-experience`
- `ab-test-setup`
- `accessibility-compliance-accessibility-audit`
- `active-directory-attacks`
- `activecampaign-automation`
- `address-github-comments`
- `agent-evaluation`
- `agent-framework-azure-ai-py`
- `agent-manager-skill`
- `agent-memory-mcp`
- `agent-memory-systems`
- `agent-orchestration-improve-agent`
- `agent-orchestration-multi-agent-optimize`
- `agent-tool-builder`
- `agents-v2-py`
- `ai-agents-architect`
- `ai-engineer`
- `ai-mkt-catalog`
- `ai-product`
- `ai-website-cloner`
- `ai-wrapper-product`
- `airflow-dag-patterns`
- `airtable-automation`
- `algolia-search`
- `algorithmic-art`
- `amplitude-automation`
- `analytics-tracking`
- `angular`
- `angular-best-practices`
- `angular-migration`
- `angular-state-management`
- `angular-ui-patterns`
- `anti-reversing-techniques`
- `antigravity-workflows`
- `api-design-principles`

_… и ещё 827. Полный список: терминал `ls "/Users/vlad_x/.cursor/skills/skills"` или поиск в Cursor по папке._

## MCP (глобальный конфиг)

**Файл:** `/Users/vlad_x/.cursor/mcp.json`

**Серверы:** `DBHub`, `Hugging Face`, `Playwright`, `Tavily`, `browsermcp`, `context7`, `filesystem`, `gologin-mcp`, `google-ads-remote-token`, `meta-ads-remote`, `meta-ads-remote-token`, `n8n-mcp`, `next-devtools`, `obsidian-vault`, `promptx`, `puppeteer`, `safedep`, `working-mcp-docker`

