# SEO/GEO-аудит категорий Askona и Lamoda

**Методика.** On-page аудит + выдача по 17 ключам (ВЧ/СЧ/НЧ) в **Google, Bing, DuckDuckGo, Yandex** и AI-слое. Ключи Tavily/Brave — из Swoop `service_settings` (VPS). **Wordstat:** [wordstat.yandex.com](https://wordstat.yandex.com/) требует авторизации → дополнительно Yandex Suggest (Москва, lr=213) + опубликованные срезы Wordstat ([openbusiness.ru](https://www.openbusiness.ru/biz/business/magazin-matrasov/), 2021). **Ограничение:** HTML-парсинг Google/Yandex/Bing с VPS дал 0 результатов (anti-bot); DuckDuckGo JSON слаб для RU e-com. Фактическая классическая выдача — **Brave Search API** (RU, `country=RU`); AI-выдача — **Tavily** (`include_answer`). LLM через Swoop agent-api/OpenRouter: таймаут/402/429 — см. §5.

Целевые URL:
1. `https://www.askona.ru/matrasy/deshevye-matrasy/`
2. `https://www.lamoda.ru/c/411/clothes-sportivnyebryuki/`

---

## 1. SEO-аудит (кратко)

### Askona — «Дешевые матрасы»
200, self-canonical, H1 «Дешевые матрасы», `CollectionPage`/`BreadcrumbList`. **Проблемы:** переспам Title, дубль Description, мед. риск в тексте, каннибализация с `/nedorogie-matrasy/` и `/matrasy-ekonom-klassa/`, нет `ItemList`.

### Lamoda — «Женские спортивные штаны»
200 после challenge, INDEX/FOLLOW. **Проблемы:** «штаны спортивные» vs спрос «спортивные брюки», мало guide/FAQ, `QAPage` вместо `BreadcrumbList`+`ItemList`, WAF-риск для ботов.

---

## 2. Рекомендации «было > стало»

| Страница | Было | Стало | Почему |
|---|---|---|---|
| Askona | Title с повторами | `Дешевые матрасы от производителя — купить с доставкой \| Askona` | CTR + читаемость |
| Askona | Description с дублем | `Недорогие матрасы Askona: жёсткость, размеры, фильтры, доставка.` | Сниппет |
| Askona | Мед. обещания | Guide «Как выбрать недорогой матрас» без лечебных claims | YMYL + GEO-цитаты |
| Askona | 3 URL на один кластер | Одна каноническая URL или 301 + разведение интентов | Подтверждено SERP: `nedorogie`/`ekonom` перехватывают спрос |
| Lamoda | «штаны спортивные» в H1/Title | H1/Title «спортивные брюки», «штаны» — синоним в тексте | Wordstat/Suggest: оба кластера живут, но «брюки» естественнее |
| Lamoda | Только листинг | Guide 70–100 слов + FAQ со ссылками на подкатегории | SEO + LLM |
| Lamoda | `QAPage` | `BreadcrumbList` + `ItemList`, убрать нерелевантный `QAPage` | Schema |
| Обе | — | **ChatGPT Ads** (§6) как доп. канал охвата, не замена SEO/GEO | Платный блок отдельно от органики |

---

## 3. Семантика: Wordstat, ВЧ/СЧ/НЧ и выдача

**Как читать Wordstat** ([гайд Яндекса](https://direct.yandex.ru/base/articles/wordstat-statistika-klyuchevyh-slov)): базовая частота (WS) — все формы и доп. слова; для SEO/Директа смотреть также `"фразовую"` и `"!точную"` частоту в [wordstat.yandex.com](https://wordstat.yandex.com/) (регион **Москва** для e-com).

**Ориентиры Wordstat по кластеру матрасов** (источник: Wordstat через [openbusiness.ru](https://www.openbusiness.ru/biz/business/magazin-matrasov/), 27.05.2021 — актуализировать в Wordstat):
- «матрас купить» + *недорого/дешевый/акция* — **342 895** показов/мес (макс. price-intent в категории)
- «матрас купить» + *ортопедический* — 61 005
- «160×200» в связке «матрас купить» — 71 683

**Yandex Suggest (Москва, 22.07.2026)** — прокси спроса:
- *Askona:* «дешёвые матрасы 160х200», «…интернет магазин», «матрасы купить недорого», «недорогие матрасы в москве»
- *Lamoda:* «…купить», «…на wildberries/ozon», «спортивные штаны женские для фитнеса», «ламода спортивные штаны женские»

### Таблица ключей, частотный класс и видимость в выдаче

| Ключ | Класс | Wordstat / спрос | Brave (Bing-класс) | Tavily (AI-search) | Целевая URL |
|---|---|---|---|---|---|
| дешевые матрасы | **ВЧ** | кластер price-intent ~300k+ (2021); проверить WS в Wordstat | нет Askona в топ-8 | нет Askona; конкуренты son.ru, ormatek | **нет** |
| недорогие матрасы | **ВЧ** | см. кластер выше | нет | нет Askona | **нет** |
| матрасы купить | **ВЧ** | широкий транзакционный | Askona #7 (`/matrasy/`) | Askona в ответе; URL `/matrasy/` | **нет** (бренд) |
| дешевые матрасы askona | **СЧ** | бренд+категория | Askona #1 (`nedorogie`) | Askona #1 `nedorogie` | **нет** |
| недорогие матрасы аскона | **СЧ** | бренд+категория | Askona #1 (`nedorogie`) | Askona #1 `nedorogie` | **нет** |
| дешевые матрасы от производителя | **СЧ** | long-tail price | **целевая #2** | Askona #4 (другие URL) | **да (#2 Brave)** |
| матрас эконом класса askona | **НЧ** | узкий бренд | Askona #1 (`ekonom-klassa`) | — | **нет** |
| дешевый матрас 160x200 купить | **НЧ** | размер+price (71k+ в кластере «160×200», 2021) | Askona #2 (не target) | — | **нет** |
| женские спортивные брюки | **ВЧ** | проверить WS; Suggest: WB/Ozon конкуренция | **целевая #5** | **целевая в топ-5 URL** | **да** |
| спортивные штаны женские | **ВЧ** | Suggest: «купить», «для фитнеса», WB | **целевая #3** | **целевая #2 URL** | **да** |
| спортивные брюки купить | **ВЧ** | транзакционный | Lamoda #8 (общая) | Lamoda в выдаче слабо | частично |
| женские спортивные штаны lamoda | **СЧ** | бренд+категория | **целевая #1** | **целевая #1 URL** | **да** |
| спортивные брюки женские купить интернет магазин | **СЧ** | длинный коммерческий | **целевая #5** | Lamoda в ответе | **да** |
| джоггеры женские купить | **НЧ** | подкатегория | Lamoda #4 (другие URL) | — | нет (соседние URL) |
| спортивные штаны для фитнеса женские | **НЧ** | сценарий | Lamoda #3 | — | частично |
| утепленные спортивные брюки женские | **НЧ** | сезон | Lamoda #4 | — | частично |

**Google / Yandex / Bing / DuckDuckGo (прямой снимок):** с VPS не получен (блокировки). **Brave** — ближайший автоматизируемый прокси Bing-класса для RU; **Tavily** — прокси AI-search (Perplexity/ChatGPT Search-class). Для Google/Yandex рекомендуется ручная проверка в GSC / Yandex Webmaster + Wordstat по тем же ключам.

---

## 4. AI / GEO: ChatGPT, Gemini, Tavily и др.

### Tavily (AI-search с `include_answer`, ключ Swoop)

| Запрос | Askona / target | Lamoda / target |
|---|---|---|
| дешевые / недорогие матрасы | бренд **нет**; target **нет** | — |
| матрасы купить | **Askona да**, URL `/matrasy/` (не target) | — |
| женские спортивные брюки / штаны | — | **Lamoda + `/c/411/` да** |
| женские спортивные штаны lamoda | — | **Lamoda + target да** |

**Вывод:** Lamoda target **уже цитируется** в AI-search слое. Askona — на уровне бренда/соседних категорий; **`deshevye-matrasy` в AI-ответах не закреплён** → приоритет: канонизация + guide + Bing/IndexNow.

### Swoop LLM — провайдеры (22.07.2026)

Промпты: Askona (недорогие матрасы + target URL) / Lamoda (спортивные брюки + `/c/411/`).

| Провайдер (Swoop keys) | agent-api `:8900` | Direct API | Askona + target | Lamoda + target | Статус |
|---|---|---|---|---|---|
| **GLM** (4 кл.) | timeout (>45–120 с) | **OK ~12 с** | **да / да** | **да / да** | рабочий |
| **Gemini** (6 AIza) | timeout (pool 13 ключей) | 429 all keys | — | — | rate limit |
| **Groq** (2) | timeout | 403 | — | — | ключ/регион |
| **OpenRouter** (1) | timeout | 402 | — | — | нет баланса |
| **OR Qwen** (1) | timeout | 404 model | — | — | неверная модель |
| **OpenModel** | n/a | n/a | — | — | нет в `_LLM_ROUTING_PROVIDERS` |

**Единственный успешный прогон:** GLM direct (`glm-4-flash`, ключ #1). Цитирует **Askona + `deshevye-matrasy`** и **Lamoda + `/c/411/`** с URL.

**Почему agent-api timeout:** в логах `gemini_pool` перебирает **13 ключей** (в `gemini_keys` только 6 AIza, остальное подмешивается из `api_key_groups` — gsk_/sk- → 400 Invalid API key). Цепочка `fast` начинается с OpenModel/GLM/Gemini/Groq/OR → минуты на фолбэки. **Фикс:** очистить `api_key_groups` от чужих ключей в gemini_pool; для SEO-прогонов вызывать `model: "glm/glm-4-flash"`; пополнить OpenRouter / снять Gemini 429.

**Wordstat CSV:** `docs/seo-geo-wordstat-keywords.csv` — 17 ключей (tier, page, region=213) для загрузки в [Wordstat](https://wordstat.yandex.com/) / парсер Keys.so.

### Обязательный GEO-стек
1. **Bing Webmaster Tools** + **IndexNow** — база для ChatGPT Search.
2. Robots/WAF: `Bingbot`, `Googlebot`, `OAI-SearchBot`, `PerplexityBot` (IP-allowlist).
3. Lamoda: доказать 200/HTML для ботов без challenge.
4. Контент «answer-first» + «потому что» + schema по видимым блокам; Reddit/обзоры — усиление цитирования (кейс [EssayGrader / Trailblazer](https://trailblazermktg.com/case-studies/essay-grader)).

---

## 5. ChatGPT Ads — рекомендация

**Да, как отдельный paid-канал.** Официально: [ads.openai.com](https://ads.openai.com) — Ads Manager, объявления **помечены** и **отделены от ответов модели** ([Help Center](https://help.openai.com/en/articles/20001047-ads-in-chatgpt)). Подходит для e-com/shopping feeds в пилотных GEO.

**Для Askona/Lamoda:**
- Проверить доступ аккаунта, гео биллинга, категорию оффера.
- Лендинг должен открываться для `OAI-AdsBot` без CAPTCHA.
- KPI ads (CPA/ROAS) **не смешивать** с organic GEO (цитаты/рефералы `utm_source=chatgpt.com`).
- Ads **не заменяют** Bing+IndexNow и контент для органических AI-цитат.

---

## 6. Итог и KPI 60–90 дней

| | Askona `deshevye-matrasy` | Lamoda `/c/411/` |
|---|---|---|
| Классическая выдача (Brave/Bing-класс) | Target редко; бренд по СЧ; каннибализация | Target **стабильно топ-5**, часто **#1–#3** |
| AI-search (Tavily) | Слабо; бренд на «матрасы купить» | **Target цитируется** |
| Swoop LLM (GLM direct) | **Target цитируется** | **Target цитируется** |
| Wordstat-приоритет | ВЧ «дешевые/недорогие матрасы» + СЧ бренд; CSV → Wordstat | ВЧ «женские спортивные брюки/штаны» + СЧ «lamoda» |

**KPI:** non-brand GSC + Bing Webmaster; позиции по таблице §3; доля AI-цитат (ручной baseline); для ads — отдельный CPA; рефералы с AI-источников.

*Проверка: 22.07.2026. Источники SERP: Brave/Tavily API (Swoop keys). Wordstat: suggest + openbusiness.ru (2021) + методика [wordstat.yandex.com](https://wordstat.yandex.com/).*
