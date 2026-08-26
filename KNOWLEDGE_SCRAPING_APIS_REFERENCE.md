# База знаний: Scraping APIs for Developers

**Источник:** [scraping-apis-for-devs](https://github.com/cporter202/scraping-apis-for-devs)  
**Статистика:** 2,622 API, 17 категорий (актуально на 2025-12-09).

Использовать этот документ для подбора инструментов под задачу: определить категорию → открыть репозиторий/категорию → выбрать конкретный API.

---

## Таблица соответствия «Задача → Категория → Инструменты»

| Задача | Категория | Примеры инструментов / что искать |
|--------|-----------|-----------------------------------|
| Органическая выдача, SERP, SEO-данные | **SEO Tools** (159) | Google Search API, Bing, DuckDuckGo, SERP, ключевые слова |
| Карты, отзывы, локации, Google Maps | **SEO Tools** / **Other** | Google Maps (отзывы, бизнесы), локальный поиск |
| Рекламные объявления (Google, соцсети) | **SEO Tools** / **Social Media** | Ad Library, рекламные объявления, таргетинг |
| Мониторинг цен, ассортимент, конкуренты | **Ecommerce** (147) | Amazon, eBay, Walmart, Target, AliExpress, ценовые скраперы |
| Посты, комментарии, тренды в соцсетях | **Social Media** (73) | Instagram, TikTok, Twitter/X, YouTube, Reddit, Facebook |
| Фонды, крипта, компании, недвижимость | **Real Estate** (130), **Other** | Stock market, крипто, Glassdoor, Zillow, Redfin |
| Парсинг с помощью ИИ, HTML → JSON | **AI** (173), **Open Source** (216) | ScrapeGraphAI, Firecrawl, Jina Reader, AI Web Scraper |
| Погода, авиабилеты, трекинг рейсов | **Travel** (139) | Flight tracking, погода, бронирования |
| Вакансии, рекрутинг | **Jobs** (167) | LinkedIn Jobs, Indeed, Adzuna, доски вакансий |
| Новости, медиа | **News** (198) | Новостные агрегаторы, RSS, статьи |
| Лиды, контакты, email, B2B | **Lead Generation** (80) | Контакты компаний, обогащение лидов, Apollo-альтернативы |
| Автоматизация сценариев, воркфлоу | **Automation** (218) | Планировщики, триггеры, связка сервисов |
| Интеграции (n8n, Zapier, API) | **Integrations** (191) | Webhooks, готовые интеграции |
| Агенты и ИИ-сценарии | **Agents** (250) | Агенты для соцсетей, контента, аналитики |
| MCP-серверы для ИИ | **MCP Servers** (28) | Контекст для LLM, инструменты по протоколу MCP |
| Разработка и девелоперские задачи | **Developer Tools** (172) | GitHub, документация, код-ревью |
| Видео (транскрипты, метаданные) | **Videos** (148) | YouTube Transcript, метаданные видео |
| Всё остальное | **Other** (133) | Государственные реестры, нишевые источники |

---

## Категории (кратко)

1. **Agents** (250) — ИИ-агенты: соцсети, контент, лиды, аналитика, автоматизация задач.
2. **AI** (173) — Поиск, изображения, транскрипты, генерация контента, LLM-интеграции.
3. **Automation** (218) — Автоматизация воркфлоу, планирование, связка сервисов.
4. **Developer Tools** (172) — Инструменты для разработчиков: репозитории, документация, тесты.
5. **Ecommerce** (147) — Маркетплейсы, цены, отзывы, товары (Amazon, eBay, Walmart и др.).
6. **Integrations** (191) — Интеграции с n8n, Zapier, API, webhooks.
7. **Jobs** (167) — Вакансии: LinkedIn, Indeed, Adzuna, специализированные доски.
8. **Lead Generation** (80) — Лиды, контакты, email, обогащение данных (в т.ч. альтернативы Apollo).
9. **MCP Servers** (28) — MCP-серверы для ИИ и агентов.
10. **News** (198) — Новости, RSS, медиа, агрегация статей.
11. **Open Source** (216) — Open-source скраперы и парсеры (в т.ч. на базе ИИ).
12. **Other** (133) — Погода, реестры, нишевые источники.
13. **Real Estate** (130) — Недвижимость: Zillow, Redfin, объявления, агентства.
14. **SEO Tools** (159) — Поиск, SERP, ключевые слова, карты, реклама (Google, Bing, DuckDuckGo).
15. **Social Media** (73) — Instagram, TikTok, Twitter/X, YouTube, Reddit, Facebook.
16. **Travel** (139) — Авиабилеты, отели, бронирования, трекинг рейсов.
17. **Videos** (148) — Видео: транскрипты, метаданные, платформы.

---

## Как искать инструмент по задаче

1. **Определи тип задачи** (поиск, e-commerce, соцсети, лиды, вакансии, недвижимость, ИИ-парсинг и т.д.).
2. **Найди категорию** в таблице выше или в списке категорий.
3. **Открой репозиторий:** https://github.com/cporter202/scraping-apis-for-devs  
   В README есть Table of Contents со ссылками на папки по категориям (например `./seo-tools-apis-159/`, `./ecommerce-apis-147/`).
4. **В папке категории** — список API с названиями и описаниями; выбери подходящий по описанию и ссылке.

**Плюсы подхода:** не поднимать Selenium/Playwright там, где есть готовый API; многие API решают капчи и прокси; удобно встраивать в продакшн и n8n.

---

## Ключевые слова для поиска по задачам

- **Поиск / SEO:** Google Search, Bing, DuckDuckGo, SERP, keyword, organic, maps.
- **E-commerce:** Amazon, eBay, Walmart, price monitoring, product scraper, reviews.
- **Соцсети:** Instagram, TikTok, Twitter, X, YouTube, Reddit, Facebook, comments, posts.
- **Лиды / B2B:** lead, contact, email, Apollo, ZoomInfo, enrichment.
- **Вакансии:** job, LinkedIn, Indeed, vacancy, career.
- **Недвижимость:** real estate, Zillow, Redfin, property, listing.
- **ИИ-парсинг:** Firecrawl, Jina, ScrapeGraphAI, LLM, markdown, HTML to JSON.
- **Погода / рейсы:** weather, flight, travel, booking.

Файл можно дополнять примерами конкретных API по мере использования.
