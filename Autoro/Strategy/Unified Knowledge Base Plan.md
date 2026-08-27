---
title: Unified Knowledge Base Plan
date: 2026-05-01
status: active
owner: Autoro
tags: [ai, architecture, n8n, marketing, knowledge-base]
---

# Цель

Построить единую базу знаний пользователя, которая автоматически собирает и синхронизирует **закладки, заметки, ссылки и сообщения** со всех устройств и каналов (браузеры, мессенджеры, соцсети), чтобы пользователь мог быстро находить и переиспользовать знания через AI-поиск.

Связанные контексты: [[Bookmarks Bro]], [[n8n]], [[Obsidian]], [[Telegram Assistant]].

## Product Vision

- Единый «входящий поток знаний» (Knowledge Inbox) из всех источников.
- Нормализация и обогащение контента (AI summary, теги, категории, источник, важность).
- Единый индекс для поиска и рекомендаций.
- Доступ с любого устройства (desktop/mobile/browser).

## Каналы сбора (Target Sources)

- Браузерные закладки: Chrome / Edge / Firefox / Brave.
- Сообщения и ссылки из Telegram (forward/share в бота).
- Соцсети (первый этап: ссылки и посты через share/webhook-интеграции).
- Ручной захват: «Send to Knowledge Base» (URL + заметка).

## Принципы архитектуры

- Single Source of Truth: metadata + state в централизованной БД.
- Event-driven ingestion через [[n8n]] workflows.
- Идемпотентность по `content_hash`/`canonical_url`.
- Четкая стадийность: `captured -> enriched -> indexed -> searchable`.
- Наблюдаемость: метрики ingest/enrich/index/search.

## Изоляция клиента (tenant / workspace)

Единая база знаний **на каждого клиента** — технически один **числовой `workspace_id`** в Postgres (`knowledge_items`, векторы, закладки) и **отдельная ветка папок в Obsidian на VPS**.

- **Бэкенд (`agent-api`):** путь заметки для Obsidian строится как  
  `{KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT}/Knowledge Inbox/{date}/{content_hash}.md`  
  где в шаблоне по умолчанию `KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT=Autoro KB/ws-{workspace_id}` (плейсхолдер `{workspace_id}`). При переданном `notePath` в capture путь **всегда нормализуется под корень workspace**, чтобы не смешивать vault разных клиентов. В YAML frontmatter добавляется `workspace_id`.
- **Расширение:** передаёт свой `workspaceId` в sync/search/capture (уже в контракте API).
- **n8n:** в payload capture уже есть `workspaceId` (из `KNOWLEDGE_WORKSPACE_ID` или будущей маршрутизации). При падении API fallback-путь в Obsidian использует `KNOWLEDGE_OBSIDIAN_VAULT_ROOT` или то же соглашение `Autoro KB/ws-<id>`.

## Telegram: один webhook vs per-tenant — что делать сейчас

| Подход | Суть | Плюсы | Минусы |
|--------|------|--------|--------|
| **A. Один URL + маршрутизация в workflow** | Telegram шлёт апдейты на **один** `…/webhook/telegram-knowledge-ingest`. Секрет общий (`TELEGRAM_WEBHOOK_SECRET`). После `Prepare Input` узел (Code/IF) определяет `workspaceId`: по **`chat_id`** из маппинг-таблицы (Postgres/Redis/static data), по **токену в тексте** («/start abc»), по **отдельным ботам** фактически тот же паттерн но разные workflow. | Один SSL, один домен, простая эксплуатация. | Нужна **таблица соответствий** `telegram_chat_id ↔ workspace_id` и админка или онбординг «подключить чат». |
| **B. Per-tenant webhook path или secret** | Разные URL (`…/ingest-ws-42`) или разные `secret token` в BotFather на бота/клиента. | Жёсткая изоляция на границе. | N ботов или N workflow, сложнее деплой и ротация секретов. |
| **C. Отдельный бот на клиента** | Клиентский Telegram app + свой токен Bot API. | Максимальное разделение. | Операционные затраты, много токенов. |

**Что делать на текущем этапе (MVP multi-клиент):**

1. Оставить **один production webhook** и **один** `TELEGRAM_WEBHOOK_SECRET` (вариант **A**).
2. Вынести конфиг **«какой chat_id в какой workspace»** в предсказуемое хранилище (рекомендуется таблица `telegram_workspace_links` в Postgres + простой admin endpoint или ручная строка в миграции).
3. В n8n после `Prepare Input` добавить узел **«Resolve workspace»** (Code + HTTP к `agent-api` или SQL): `chat_id` → `workspaceId`; подставлять в `knowledge_capture_payload.workspaceId` вместо жёсткого `KNOWLEDGE_WORKSPACE_ID`.
4. Когда появятся требования изоляции «как у финтеха» — добавить **вариант B** для отдельных крупных клиентов без переписывания capture (тот же `/api/v1/knowledge/capture`).

**Вывод:** отдельное «продуктовое решение» нужно **зафиксировать в виде политики маппинга** (A по умолчанию). Код и инфра уже готовы принимать разные `workspaceId` в capture; осталось **не хардкодить workspace в n8n** для прод-мультиарендности и завести таблицу/сервис связи чат↔workspace.

## Формат записи Knowledge Note (Obsidian)

```markdown
---
workspace_id: "1"
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

## Реализация по этапам

### Phase 1 — Browser + Web Research стабилизация (текущий фокус)

- [ ] Закладки: надежный sync + dedupe + фоновые jobs.
- [ ] AI поиск: режимы `Bookmarks` и `Web Research`.
- [ ] Единый UI результатов и экспорт markdown.
- [ ] Метрики качества релевантности (CTR/open rate/save rate).

### Phase 2 — Telegram ingestion

- [ ] Telegram bot: прием forward-сообщений/ссылок.
- [ ] n8n workflow: parse -> enrich -> store -> create Obsidian note.
- [ ] Статусы обработки и retries.

### Phase 3 — Multi-device Knowledge Inbox

- [ ] Mobile share endpoint (iOS/Android shortcuts/web share target).
- [ ] Unified capture API (URL/text/media refs).
- [ ] User timeline активности и синхронизации.

### Phase 4 — Social signals

- [ ] Интеграции соцсетей через безопасные API/webhooks.
- [ ] Нормализация постов/тредов/ссылок в общий формат.
- [ ] Source-specific quality scoring.

## KPI и критерии успеха

- Ingestion success rate >= 98%.
- Median time capture->searchable <= 2 мин.
- Duplicate rate <= 5%.
- Search success (user opens one of top-3 results) >= 60%.
- Weekly retained users базы знаний (WAU retention) рост MoM.

## Риски и контроль

- API limits внешних источников -> key rotation + graceful fallback.
- Privacy/PII -> строгие политики хранения, redact/sanitize.
- Noise in content -> quality filters + confidence threshold.

## Следующие практические шаги

1. Зафиксировать schema `knowledge_item` + статусы pipeline.
2. Подготовить n8n workflow-шаблон `capture -> enrich -> obsidian`.
3. Включить Telegram-first ingestion как приоритетный канал после браузера.
4. Подготовить dashboard метрик ingestion/search quality.

## Update 2026-05-07 (Gemini feature adaptation)

- Added DB-wide idea generation flow in Bookmarks Bro UI (`Generate ideas from full DB`) to synthesize ideas from personal vectors and bookmarks, not only selected rows.
- Added backend endpoint `POST /api/v1/knowledge/export` for on-demand export of Obsidian + vector knowledge with semantic/text mode and markdown output.
- Added Knowledge export controls in UI (`Export semantic` / `Export text mode`) with downloadable markdown package.
- Preserved workspace isolation model through `workspaceId`-scoped queries for idea generation and export.

## Update 2026-05-07 (ZIP export package)

- Added ZIP export package from Knowledge tab with migration-ready artifacts:
  - `knowledge.md`
  - `items.json`
  - `vectors.json`
  - `manifest.json`
- Added UI actions for semantic/text ZIP export to simplify backup and transfer between domains/servers.
