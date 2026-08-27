---
title: Autoro blog news pipeline
tags: [ai, architecture, marketing, n8n]
created: 2026-08-27
---

# Autoro blog news pipeline

Пайплайн наполнения блога autoro.tech: RSS/listing -> Swoop scrape -> relevance (AI marketing / ads / automation) -> LLM rewrite на 7 языков -> Inbox -> Approve в `blog_posts`.

Не клонировали Fastify SPA pquoc. Скрипты: `scripts/blog-news/`. Админка: Swoop `/admin/blog` вкладки Inbox / Sources / Pipeline settings.

Ключи только `SWOOP_API_KEY`. Cron - ingest-only.

Связанные заметки: [[Autoro-API]]

Документы в репо: `docs/autoro-blog-news-pipeline.md`, `docs/prompts/autoro-blog-rewrite-system.md`, `docs/blog-news-sources-catalog.md`.
