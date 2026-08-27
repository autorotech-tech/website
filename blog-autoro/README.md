# blog-autoro

Next.js публичный блог + admin API для Swoop (`/api/blog` -> `/api/*`).

Пайплайн новостей живёт в родительском репо:

- скрипты `../scripts/blog-news`
- черновики `../content/blog-news`
- env `BLOG_NEWS_ROOT` (дефолт: родитель website)

```bash
cd blog-autoro
npm install
BLOG_NEWS_ROOT=.. npm run dev   # :3002
```

На VPS, если блог уже в `/home/vladx/autoro-blog`, скопируйте `app/api/admin/pipeline`, `app/[locale]/blog`, `lib/pipeline-root.ts`, `lib/posts.ts` и смонтируйте website `scripts/blog-news`, `content`, `data`, `config`.
