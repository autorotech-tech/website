# Справка Cursor — Skills, Rules, MCP

Документ для **отдельного окна редактора**: откройте его рядом с кодом или в новой группе вкладок. Актуальные **имена skills/rules** и список MCP генерируются в [`CURSOR-INVENTORY.generated.md`](CURSOR-INVENTORY.generated.md).

---

## Как открыть «в отдельном окне»

1. **Две колонки в одном окне (рекомендуется)**  
   - `Cmd+\` (macOS) / `Ctrl+\` (Windows) — разделить редактор.  
   - `Cmd+P` → введите `CURSOR-HANDBOOK.md` → откройте в правой группе.  
   - По желанию: правый клик по вкладке → **Split Right**.

2. **Markdown Preview рядом**  
   - Откройте этот файл → командная палитра (`Cmd+Shift+P`) → **Markdown: Open Preview to the Side**.

3. **Настоящее отдельное окно IDE**  
   - **File → New Window**, в новом окне **File → Open** и выберите только этот файл или весь репозиторий.

> Встроенной отдельной «панели справки» со всеми skills в Cursor нет: используйте этот handbook + сгенерированный инвентарь.

---

## Skills (агентские навыки)

**Где лежат**

| Область | Путь |
|--------|------|
| Проект | `.cursor/skills/<имя>/SKILL.md`, `.agents/skills/<имя>/SKILL.md` |
| Глобально | `~/.cursor/skills/`, `~/.cursor/skills/skills/`, `~/.agents/skills/` |
| Совместимость | `.claude/skills/`, `.codex/skills/` (см. [документацию](https://docs.cursor.com/context/skills)) |

**Как применить**

- В **Agent**-чате: **`/`** → поиск по имени skill (например `/refero-cursor-warm-ivory`).  
- Или **`@`** и выбор skill как контекста.  
- Или явный текст: «используй skill `имя-скилла`».

**Авто vs только по команде**

- По умолчанию агент подключает skill, если задача релевантна полю `description` в YAML.  
- Если в `SKILL.md` указано `disable-model-invocation: true`, skill попадает в контекст **только** при явном `/имя` или @.

**Обновить список skills в справке**

```bash
cd /path/to/website
npm run cursor:inventory
```

Откройте после этого [`CURSOR-INVENTORY.generated.md`](CURSOR-INVENTORY.generated.md).

### Modern Web Guidance (Chrome)

- Документация: https://developer.chrome.com/docs/modern-web-guidance  
- Skill: **`/modern-web-guidance`** → `.agents/skills/modern-web-guidance/` (симлинк в `.cursor/skills/`)  
- Перед вёрсткой/фронтом: `npx -y modern-web-guidance@latest search "…"` → `retrieve "<id>"` (версия в `SKILL.md`)  
- Переустановка: `npm run modern-web-guidance:install`  
- Правило: `.cursor/rules/modern-web-guidance.mdc`

---

## Rules (правила)

**Где:** `.cursor/rules/*.md` или `.mdc`.

**Frontmatter (`.mdc`):**

- `alwaysApply: true` — правило почти всегда в контексте.  
- `alwaysApply: false` + `description` — **Apply intelligently** по смыслу задачи.  
- `globs: "**/*.tsx"` — при работе с подходящими файлами.

**Документация:** [Cursor — Rules](https://docs.cursor.com/context/rules).  
Кратко по проекту: [rules/README.md](rules/README.md).

Имена файлов и режимы — в [CURSOR-INVENTORY.generated.md](CURSOR-INVENTORY.generated.md).

### OpenModel (DeepSeek V4 Flash free)

- Справка: [OPENMODEL.md](OPENMODEL.md)
- Установка ключа локально: `npm run openmodel:setup`
- В Cursor: **Settings → Models → Anthropic** → API key `om-…`, base URL `https://api.openmodel.ai`, модель `deepseek-v4-flash`
- Акция: [OpenModel event](https://docs.openmodel.ai/en/docs/event)

---

## MCP (Model Context Protocol)

**Настройка:** Cursor → **Settings → MCP** (или JSON `~/.cursor/mcp.json` на macOS/Linux).

**Справка:** [Cursor — MCP](https://docs.cursor.com/context/mcp).

Скрипт инвентаризации выводит **только имена серверов** из `mcp.json`, без секретов. Ключи и токены не коммитьте.

### SafeDep (защита от вредоносных зависимостей в агенте)

1. Завести ключ и tenant в [SafeDep Cloud — API Keys](https://app.safedep.io/settings/api-keys).
2. В корне репозитория в `.env` (не коммитится):  
   `SAFEDEP_CLOUD_TENANT_DOMAIN`, `SAFEDEP_CLOUD_API_KEY`  
   Шаблон: `.env.example`.
3. Выполнить: `npm run safedep:mcp:configure` — слияние блока `safedep` в `~/.cursor/mcp.json` из `.env`.
4. Перезапустить Cursor, проверить **Settings → MCP Servers**.
5. Проверка по [доке SafeDep MCP — Testing](https://docs.safedep.io/apps/mcp/overview#testing): попросить агента установить npm-пакет `safedep-test-pkg` — ожидается отказ и предупреждение.

Подробнее: [Model Context Protocol Server (SafeDep)](https://docs.safedep.io/apps/mcp/overview).

### SafeDep на CI (GitHub)

В репозитории включён workflow `.github/workflows/safedep-vet.yml`: [vet-action@v1](https://github.com/safedep/vet-action) в **cloud mode** (malware analysis). Локальный `.env` в CI не попадает — задайте [secrets репозитория](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions):

- `SAFEDEP_CLOUD_API_KEY`
- `SAFEDEP_CLOUD_TENANT_DOMAIN`

Имена совпадают с [Quickstart](https://docs.safedep.io/cloud/quickstart/). Политика: `.github/vet/policy.yml` (при необходимости смягчите правила или добавьте [exceptions](https://docs.safedep.io/advanced/exceptions)).

**CLI `vet`** (локально): `brew install safedep/tap/vet` и `vet cloud quickstart`, либо [Quickstart](https://docs.safedep.io/cloud/quickstart/). Переменные `SAFEDEP_CLOUD_*` в корневом `.env` используются скриптом **`npm run safedep:mcp:configure`** только для **MCP в Cursor**.

---

## Полезные команды Cursor

| Действие | Как |
|----------|-----|
| Создать skill из чата | `/create-skill` в Agent |
| Миграция rules/commands → skills | `/migrate-to-skills` (Cursor 2.4+) |
| Команды чата | [Docs — Commands](https://docs.cursor.com/agent/chat/commands) |

---

## Задачи в VS Code / Cursor

В репозитории: **Terminal → Run Task…** → **Cursor: regenerate inventory** — пересобрать `CURSOR-INVENTORY.generated.md`.

---

## Ссылки

- [Agent Skills](https://docs.cursor.com/context/skills)  
- [Rules](https://docs.cursor.com/context/rules)  
- [MCP](https://docs.cursor.com/context/mcp)
