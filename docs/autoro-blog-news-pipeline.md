# Пайплайн новостей блога Autoro.tech

Оркестрация как на pquoc.com (`источники -> scrape -> LLM-рерайт -> Inbox -> Approve`), публикация в существующий блог autoro.tech. Fastify SPA и static HTML pquoc **не** копируются.

## Поток

```
RSS / listing / reddit JSON
  -> npm run blog-news:ingest
  -> Swoop scrape (/api/v1/scrape) + relevance (AI marketing)
  -> content/blog-news/{slug}.json  (status: pending)
  -> Inbox (Rewrite) -> 7 langs (en, ru, es, it, fr, vi, kz)
  -> Approve -> blog_posts + blog_post_translations
  -> https://autoro.tech/{locale}/blog/{slug}
```

Cron на VPS запускает **только ingest**. Публикация только вручную (Approve). `BLOG_NEWS_REQUIRE_APPROVAL=1`.

## Скрипты

Из корня website:

```bash
npm run blog-news:ingest      # сбор, без рерайта и без publish
npm run blog-news:rewrite     # pending -> ready (7 langs)
npm run blog-news:pipeline    # ingest; добавьте --rewrite только вручную
npm run blog-news:test
```

Env (не `PQUOC_LLM_*`):

| Имя | Назначение |
|---|---|
| `SWOOP_API_BASE` | `https://swoop.autoro.tech` |
| `SWOOP_API_KEY` | ops/user ключ Autoro-API |
| `BLOG_NEWS_REQUIRE_APPROVAL` | `1` |
| `BLOG_NEWS_INGEST_LIMIT` | cap за прогон (дефолт 8) |
| `BLOG_NEWS_RELEVANCE_MIN_SCORE` | порог (дефолт 0.55) |
| `AUTORO_BLOG_REWRITE_MODEL` | `openrouter/anthropic/claude-3.7-sonnet` |
| `AUTORO_BLOG_REWRITE_FALLBACK_MODEL` | `glm/glm-4-flash` |
| `BLOG_NEWS_ROOT` | корень website, если cwd другой |
| `BLOG_NEWS_APIFY_TOKEN` | опциональный fallback scrape |

Ключи Gemini в `blog_settings` пайплайн **не** читает.

## Данные

| Путь | Роль |
|---|---|
| `config/blog-news-sources.json` | seed RSS/listing |
| `data/blog-news-sources.json` | runtime CRUD из админки |
| `data/blog-news-settings.json` | prompt, model, caps |
| `data/blog-news-ingest-state.json` | seen URLs |
| `content/blog-news/{slug}.json` | черновики `draft\|pending\|ready\|rejected` |

Категории: `ai_marketing`, `automation`, `models`, `business_cases`, `implementation`, `ai_news`, `meta_ads`, `google_ads`, `reddit_social`, `insights`, `crypto`, `manuals`, `digital_marketing`.

Crypto: только крупные сюжеты со связью к ads/biz/regulation. Travel, celebrity, memecoin pumps отсекаются.

## Админка

Swoop `/admin/blog`: вкладки **Posts | Inbox | Sources | Pipeline settings**.

API (nginx `/api/blog/` -> Next `/api/`):

- `GET/POST /api/admin/pipeline/items`
- `GET/PUT/DELETE /api/admin/pipeline/items/:slug`
- `POST /api/admin/pipeline/items/:slug/rewrite|approve|reject`
- `POST /api/admin/pipeline/items/bulk`
- `GET/POST /api/admin/pipeline/sources`
- `PUT/DELETE /api/admin/pipeline/sources/:id`
- `GET/PUT /api/admin/pipeline/settings`
- `POST /api/admin/pipeline/ingest`

Auth: Bearer Supabase JWT, email из `BLOG_ADMIN_EMAILS` (дефолт `autoro.tech@gmail.com`).

Approve пишет `status: published`, 7 переводов, `source=pipeline`, `source_url` / `pipeline_slug` если колонки есть. SQL: `scripts/sql/blog_posts_pipeline.sql`.

## Cron (VPS)

```cron
# 06:15 and 18:15 UTC, ingest only
15 6,18 * * * cd /home/vladx/projects/autoro.tech/website && set -a && . .env && set +a && BLOG_NEWS_REQUIRE_APPROVAL=1 npm run blog-news:ingest >> /var/log/blog-news-ingest.log 2>&1
```

Не ставить `blog-news:pipeline --rewrite` в cron.

## Публичный блог

`blog-autoro/app/[locale]/blog/page.tsx` - список published.  
`blog-autoro/app/[locale]/blog/[slug]/page.tsx` - пост.  
`blog-autoro/app/sitemap.ts` - 7 langs + hreflang.

Если на VPS уже крутится старый Next (`/home/vladx/autoro-blog`), скопируйте туда `app/api/admin/pipeline/**`, `lib/pipeline-root.ts`, `lib/posts.ts` (approve), страницы `[locale]/blog` и смонтируйте `content/`, `data/`, `scripts/blog-news`.

## Проверки

1. `npm run blog-news:test`
2. `npm run blog-news:ingest -- --limit 2` -> Inbox pending
3. Rewrite в Inbox -> 7 langs, факты только из источника
4. Approve -> `/en/blog/{slug}` и `/ru/blog/{slug}`
5. `npm run build` (Swoop UI)

## Вне v1

Telegram/Threads, n8n webhook, комментарии, отдельный Fastify admin-api.
