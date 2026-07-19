# Keept — единая база знаний (Unified KB)

**Обновлено:** 2026-07-17  
**Продукт:** Keep It For Me (Keept) · бывший Browser Bro / Bookmarks Bro  
**Инфра:** self-hosted (как изначально) — **не Google Cloud**

---

## Решение по платформе

| | Выбор |
|---|--------|
| **Runtime** | VPS `46.250.228.229` + Docker |
| **Auth / DB** | BB Supabase (`/bb-supabase` → `auth.keept.me`) |
| **API** | `agent-api` (uvicorn) на том же хосте |
| **Frontend** | Vite SPA: staging `swoop.autoro.tech/bookmarks-bro`, prod `app.keept.me` |
| **Knowledge sync** | Obsidian MCP / vault bridge (local + optional remote path) |
| **Агенты** | ADK local (`keep-it-for-me`) + agent-api; playground/evals **без** GCP deploy |

**Явно out of scope:** Cloud Run, Vertex Agent Engine, GCP-only hosting, обязательный `GOOGLE_CLOUD_PROJECT` для продукта.

Kaggle/ADK playground и unit-тесты остаются локальными. Eval grade через GCP — опционально для курса, **не** требование прод-архитектуры.

---

## Что такое «общая БЗ»

Keept — не «только закладки», а **единое хранилище знаний** пользователя (workspace) с разными **типами записей** и тематическими **категориями/тегами**.

Один поиск / один RAG / один Obsidian-sync контур — поверх всех типов.

```
  Capture (extension / web / telegram / note)
           │
           ▼
  Security → [HITL | auto] → Enrich → Embedding
           │
           ▼
  Unified KB (bookmarks_bro / knowledge items)
           │
     ┌─────┴─────┬──────────┬─────────┐
     ▼           ▼          ▼         ▼
  Library    Search     Ideas UI   Obsidian
  by kind    hybrid     /plans     vault notes
```

---

## Два измерения классификации

### 1. Kind (тип записи) — главная «общая БЗ»

Пользовательские сущности, которые живут в одной БЗ:

| Kind | RU | Источник / смысл | UI (цель) |
|------|----|------------------|-----------|
| `bookmark` | Закладка | Chrome/extension sync, URL capture | Library → Bookmarks |
| `note` | Заметка | Ручной ввод, markdown | Notes |
| `idea` | Идея | AI-recommend, ручной захват | Ideas |
| `plan` | План | Структурированный план / roadmap item | Plans |
| `development` | Разработка | Технические сниппеты, RFC, PR-заметки | Developments |
| `task` | Задача | Reminder / create_task actions | Tasks / Reminders |
| `article` | Статья | Длинный контент / Jina scrape | Library |
| `prompt` | Промпт | Переиспользуемые LLM prompts | Prompts |
| `contact` | Контакт | Smart contacts (Babylon Fish context) | Contacts |
| `link` | Ссылка | Лёгкий URL без полного enrich | Quick links |

**Правило:** kind = *что это за объект*; хранится в одном workspace и ищется единым `/search`.

### 2. Category / tags (тема)

Тематика из `schemas/categories.json` (topic layer):

`general`, `ai-ml`, `dev-tools`, `marketing`, `business`, `design`, …

Теги нормализуются (`normalize_tags` / aliases). Topic ≠ kind: у «идеи про marketing» `kind=idea`, `category=marketing`.

---

## Целевой UX (единая БЗ)

1. **Inbox / Capture** — любой вход → статус `searchable` | `pending_moderation`
2. **Library** — фильтры: `kind`, `category`, tags, date
3. **Unified Search** — keyword + pgvector, фильтр по kind
4. **Ideas & Plans** — вкладки поверх тех же items (`kind in idea|plan`)
5. **Developments** — `kind=development` (+ теги `dev-tools`)
6. **Admin moderation** — HITL до попадания в searchable KB
7. **Obsidian** — note path по kind/category (например `Ideas/`, `Plans/`, `Dev/`)

Существующий UI уже частично закрывает Ideas / Notes / Reminders / Knowledge — дальше свести к **одному типу item + kind**, а не разрозненным silos.

---

## Данные (ориентир модели)

Без mass-rename таблиц в Phase 1. Логически:

```text
workspace
  └── knowledge_item | bookmark_row
        kind: bookmark | note | idea | plan | development | …
        category: ai-ml | marketing | …
        tags: jsonb
        title, summary, raw_text, url?
        embedding, status, source
```

Миграция: где сейчас Ideas/Reminders в `workspace_ui_state` — постепенно промоутить в first-class items с `kind`, UI-state оставить для draft/WIP.

---

## Приоритет реализации (self-hosted)

| # | Работа | Зачем | Статус |
|---|--------|--------|--------|
| 1 | `kinds` в schema + `normalize_kind()` | Единая БЗ | ✅ 2026-07-15 |
| 2 | Enrich bookmarks → embedding + promote KB/Obsidian | Extension sync end-to-end | ✅ |
| 3 | Library/Search facets по `kind` | UX «общая БЗ» | ✅ (UI filter) |
| 4 | Capture/Telegram/manual note → выставляют kind | Полные каналы входа | 🟡 text + **files** |
| 5 | Obsidian path mapping по kind | `Bookmarks/` Ideas/ Plans/ | ✅ для browser_bookmark |
| 6 | Contacts + Babylon Fish | Concierge поверх БЗ | backlog |
| 7 | Cloudflare `keept.me` | Prod домен (ops) | operator |

### Extension package

- Unpackable: `extensions/bookmarks-bro/` (manifest `0.3.2`, build `0.1.2-testing`)
- Zip: `extensions/bookmarks-bro-0.3.2.zip`
- Sync flow: sync/start → worker (fetch) → enrich (vector + `promote_enriched_bookmark_to_knowledge` → Obsidian `…/Bookmarks/YYYY-MM-DD/*.md`)

Не блокирует продукт: GCP grade, Cloud Run, Vertex.

---

## Phase K — обогащение БЗ файлами (2026-07-17)

Пользователь загружает файлы с данными и указывает **какую БЗ (workspace)** и **kind** обогатить. Pipeline: extract text → security → `knowledge_items` + `knowledge_vectors` → Obsidian.

### Каналы

| Канал | Как выбрать БЗ | API / UX |
|-------|----------------|----------|
| **Web** | dropdown workspace в Knowledge Base | `POST /api/v1/knowledge/files/enrich` (multipart) |
| **Telegram** | чат привязан к workspace (`telegram_workspace_links`) | `POST /api/v1/telegram/webhook` — document/photo/audio/voice |

### Подсказки kind/category (caption)

В подписи к файлу (Telegram) или поле hints (web):

```text
#kb #development #dev-tools RFC auth refactor
```

Парсер: `kb_file_ingest.parse_file_ingest_hints` — `#kind`, `#category`, первая строка → title.

### Поддерживаемые типы файлов

- Текст: `.txt`, `.md`, `.csv`, `.json`, `.html`
- PDF: best-effort без pypdf (fallback extract)
- Изображения: vision OCR (Hermes / Swoop keys)
- Аудио/голос: Whisper (OpenAI key в Swoop)

Лимит: 12 MiB (`MAX_FILE_BYTES`).

### Модуль

- `agent-api/kb_file_ingest.py` — extract + hints
- `agent-api/main.py` — `ingest_knowledge_from_file`, endpoint, Telegram file branch

---

## Связанные документы

- [KEEPT-DEVELOPMENT-STATUS.md](./KEEPT-DEVELOPMENT-STATUS.md)
- [ANTIGRAVITY-AGENT-MODE-KEEPT-ME.md](./ANTIGRAVITY-AGENT-MODE-KEEPT-ME.md)
- [CLOUDFLARE-KEEPT-DNS.md](./CLOUDFLARE-KEEPT-DNS.md)
- [schemas/categories.json](../../schemas/categories.json) — topic categories (расширить kinds отдельно)
