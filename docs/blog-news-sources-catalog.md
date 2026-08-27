# Каталог источников blog-news

Seed: [`config/blog-news-sources.json`](../config/blog-news-sources.json). Runtime CRUD пишет `data/blog-news-sources.json`.

| ID | Тип | Категория | Заметка |
|---|---|---|---|
| openai-news | rss | models | OpenAI News |
| anthropic-listing | listing | models | `/news/` links |
| google-ai-blog | rss | models | blog.google AI |
| huggingface-blog | rss | models | |
| verge-ai | rss | ai_news | |
| google-ads-developers | rss | google_ads | |
| google-ads-api-notes | listing | manuals | first-party changelog |
| meta-newsroom | rss | meta_ads | |
| meta-business | listing | meta_ads | |
| meta-marketing-api-changelog | listing | manuals | Graph API changelog |
| sej | rss | digital_marketing | Search Engine Journal |
| sel | rss | digital_marketing | Search Engine Land |
| martech | rss | ai_marketing | |
| hubspot-marketing | rss | digital_marketing | |
| n8n-blog | rss | automation | |
| reddit-ppc | reddit_json | reddit_social | public `.json`, no login |
| reddit-googleads | reddit_json | google_ads | |
| reddit-marketing | reddit_json | insights | |
| coindesk | rss | crypto | жёсткий relevance |
| theblock | rss | crypto | жёсткий relevance |

Reddit: только публичный listing (`/r/{sub}/.json`). Не login-scrape и не Selenium.

Если RSS 404 - выключите источник в Inbox/Sources и поставьте listing с `linkPattern`.
