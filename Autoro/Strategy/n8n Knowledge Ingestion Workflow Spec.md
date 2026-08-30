---
title: n8n Knowledge Ingestion Workflow Spec
date: 2026-05-01
status: draft
tags: [n8n, obsidian, telegram, ingestion, testing]
---

# Scope

Спецификация workflow для загрузки знаний из Telegram/URL в единую базу:

`capture -> normalize -> enrich -> dedupe -> store -> obsidian -> metrics`

## 1) Triggers (Capture)

- Telegram Webhook (message/forward/link)
- HTTP Webhook для mobile share / browser share

Обязательные поля события:

- `source` (`telegram`, `web_share`, `bookmark_extension`)
- `text` (raw text/message)
- `url` (optional)
- `sender` / `device_id` (optional)
- `captured_at` (ISO timestamp)

## 2) Normalize

Code node (idempotent transform):

- trim/cleanup текста
- canonicalize URL
- вычислить `content_hash = sha256(source + canonical_url + normalized_text)`
- сформировать `knowledge_item` payload

## 3) Enrich

- Extract content (если есть URL)
- AI summary (2-4 предложения)
- AI tags/category
- quality score (0..1)

Fallback:

- при сбое summary -> сохранять raw-версию со `status=to_process`

## 4) Dedupe

Проверка в БД по:

- `content_hash`
- `canonical_url` (+ recent window)

Политика:

- duplicate -> update `last_seen_at`, increment `seen_count`
- new -> insert record and continue

## 5) Store (DB)

Таблица `knowledge_item` (минимум):

- `id`, `source`, `original_sender`, `canonical_url`
- `title`, `normalized_text`, `ai_summary`
- `tags` (jsonb), `category`
- `content_hash`, `status`
- `captured_at`, `ingested_at`, `indexed_at`

## 6) Obsidian write

Запись через Obsidian Local REST API:

- create/update note by stable path:
  - `Knowledge Inbox/YYYY-MM-DD/<content_hash>.md`
- если note существует -> update/append policy

Template:

```markdown
---
source: "Telegram"
original_sender: "@username"
url: "https://example.com"
tags: [ai, automation, dev]
date: 2026-05-01
status: "to_process"
content_hash: "..."
ingested_at: "2026-05-01T12:00:00Z"
---
# [Заголовок страницы]

### Краткий контекст (AI Generated):
...

### Оригинальное сообщение:
...
```

## 7) Index/Search update

- post-write hook: mark `status=indexed` when search index updated
- optional queue for embedding/indexing

## 8) Metrics & alerts

Метрики:

- `ingest_success_rate`
- `dedupe_ratio`
- `time_to_searchable_sec`
- `obsidian_write_errors`

Алерты:

- >5% ошибок записи за 15 мин
- backlog > threshold

## 9) Test plan (MVP)

### Functional

- Telegram forward c URL -> note created
- Telegram text-only -> note created without URL
- duplicate message -> no duplicate note
- invalid URL -> raw note with `status=to_process`

### Reliability

- retry on transient HTTP errors
- idempotent re-run same event

### Data quality

- frontmatter always valid
- tags/category non-empty for enriched items

## 10) Definition of Done

- End-to-end ingestion из Telegram работает стабильно
- Obsidian note создается/обновляется по шаблону
- Dedupe подтвержден тестами
- Метрики ingestion видны в dashboard
