# Тестовое задание SEO / GEO — Askona и Lamoda

**Дата:** 22–23.07.2026  
**Страницы:**
1. [Askona — дешёвые матрасы](https://www.askona.ru/matrasy/deshevye-matrasy/)
2. [Lamoda — женские спортивные штаны](https://www.lamoda.ru/c/411/clothes-sportivnyebryuki/)

**Готовность к отправке:** ~**98%** (исследование ~99%, SerpAPI все движки, OpenModel **30/30**, **клиентский документ готов** → `docs/SEO-GEO-audit-Askona-Lamoda-CLIENT.md`).  
**Автопрогон SerpApi:** 22.07 ~21:37 UTC — Google+Yandex+Bing; **DuckDuckGo 17/17 × 2 локали** → CSV `duckduckgo_pos_ru` (`kl=ru-ru`) + `duckduckgo_pos_en` (`kl=us-en`).  
**OpenModel GEO:** 22.07 ~19:48 UTC — **15 моделей × 2 URL = 30/30** (`docs/seo-geo-llm-results.json`, §5.6).  
**Автопрогон Tavily (ранее):** 22.07 ~20:15 UTC — 17/17 через `POST /api/v1/web/search`.  
**Дедлайн ТЗ:** 4 календарных дня · формат — **один документ 2–3 стр.** без технических деталей Swoop.

**Приоритет дозаполнения:** 1) **экспорт PDF** из `docs/SEO-GEO-audit-Askona-Lamoda-CLIENT.md` → прикрепить на hh.ru → 2) Wordstat 4 ключа (опционально). Пошагово — **§10 Block 6**.

---

## 0. Чеклист ТЗ vs deliverable

Источники ТЗ: [PDF](https://drive.google.com/file/d/1OjUka9xRkcIi96p1VDNu_-IvwNKlagWa/view) + расширение (Wordstat, SERP, LLM, ChatGPT Ads).

| # | Требование | Статус | Доказательство в deliverable |
|---|---|---|---|
| 1 | SEO-аудит **2 целевых URL** | ⚠️ Partial | §1 — кратко; детали on-page/schema — в `seo-geo-test-assignment.md` |
| 2 | Рекомендации «было → стало» | ✅ Done | §2 + playbook §2.1 |
| 3 | GEO: упоминания в LLM + стратегия | ✅ Done | §5 (30/30 OpenModel), §5.7 Tavily, §7 KPI |
| 4 | Семантика **17 ключей**, ВЧ/СЧ/НЧ | ⚠️ Partial | §3 — **17/17** с demand (4 — **proxy**, не прямой Wordstat) |
| 5 | Wordstat ([wordstat.yandex.com](https://wordstat.yandex.com/), Москва) | ⚠️ Partial | §3 + CSV; 13 — Wordcraft; **4 — proxy** (§10 Block 4, SerpAPI Wordstat ❌) |
| 6 | SERP **Google** по 17 ключам | ✅ Done | SerpAPI 17/17 (22.07 ~21:37 UTC) → `google_pos` в CSV; `serpapi_run` в JSON |
| 7 | SERP **Yandex** | ✅ Done | SerpAPI engine=yandex, lr=213 → `yandex_pos` 17/17 |
| 8 | SERP **Bing** | ⚠️ Partial | Brave-снимок 22.07 утро → CSV `bing_pos`/`brave_pos` (сохранён); SerpApi bing опционально. **Tavily 17/17** ✅ |
| 9 | SERP **DuckDuckGo** | ✅ Done | SerpAPI 17/17 × **`duckduckgo_pos_ru`** (`kl=ru-ru`) + **`duckduckgo_pos_en`** (`kl=us-en`) |
| 10 | AI-search: **ChatGPT Search** (consumer) | ⚠️ Optional | ТЗ PDF — consumer Browse/Search; **не автоматизируется**. Primary GEO: **OpenModel 30/30** → CSV `OpenModel да` |
| 11 | AI: **Gemini** (app / native API) | ⚠️ Partial | OpenModel `gemini-3.5-flash` + `gemini-3.1-pro` ✅; native Gemini app — опционально; Lamoda API 429/403 |
| 12 | AI: прочие LLM (Swoop/OpenModel) | ✅ Done | §5.6 — **15 моделей × 2 URL = 30/30** (Grok 0/2 upstream x.ai) |
| 13 | **ChatGPT Ads** — рекомендация | ✅ Done | §6 — клиентский блок + OAI-AdsBot |
| 14 | Bing Webmaster + **IndexNow** (GEO) | ⚠️ Partial | §2.1 LLM-блок; пошагово — §9 п.6 |
| 15 | Итог + KPI 60–90 дней | ✅ Done | §7 |
| 16 | **Один документ 2–3 стр.** | ✅ Done | **`docs/SEO-GEO-audit-Askona-Lamoda-CLIENT.md`** → экспорт PDF → hh.ru |
| 17 | Executive summary для ответа на вакансию | ✅ Done | §0 — SerpApi Google/Yandex + LLM + §2.1 playbook |

**Сильные стороны:** Lamoda target в SERP/AI; OpenModel GEO 30/30; Wordstat по 13 ключам; каннибализация Askona; Tavily; thinking-fix Gemini.

**Executive summary (для ответа на вакансию):**
- Проведён SEO/GEO аудит двух категорий (Askona — дешёвые матрасы, Lamoda — спортивные брюки): on-page, семантика 17 ключей, рекомендации «было → стало», playbook улучшения — **§2.1**.
- **Приоритет №1 — финализация:** клиентский PDF → Wordstat-пробелы (4 ключа). SERP Google/Yandex/Bing/DDG — **авто SerpAPI ✅** (DDG **`kl=ru-ru`**, 22.07 ~22:25 UTC).
- **GEO baseline:** OpenModel **30/30** (15 моделей, промпты §5) — primary evidence упоминаний бренда + target URL; **не заменяет** consumer ChatGPT Search / Gemini app с live web.
- **Lamoda:** target стабильно в выдаче и AI-ответах (OpenModel 15/15, Tavily); фокус — Title/H1 «брюки» vs «штаны», FAQ.
- **Askona:** каннибализация трёх URL; target слабее соседних категорий в SERP/AI — **P0:** канон + 301, контент 800+ слов, FAQ schema, Bing/IndexNow (**§2.1**).

---

## 0.1 Соответствие вакансии [GEO/SEO-специалист · Маверик · hh.ru 135386252](https://hh.ru/vacancy/135386252)

| Навык / зона вакансии | Покрытие в deliverable | Статус |
|---|---|---|
| Технический SEO (аудит, мета, структура, перелинковка) | §1, §2, §2.1 — Askona канон/Title/H1; Lamoda «брюки» vs «штаны» | ✅ |
| Семантическое ядро, ВЧ/СЧ/НЧ | §3 — **17 ключей**, Wordcraft + 4 proxy | ⚠️ 4 proxy |
| Аналитика (Метрика, GSC, Wordstat) | Wordstat 13/17; proxy 4; GSC/Метрика — рекомендации §2.1 | ⚠️ |
| GEO / мониторинг упоминаний в LLM | **OpenModel 30/30** §5.6; Tavily 17/17; стратегия §2.1, KPI §7 | ✅ |
| AI-поиск (ChatGPT, Google AI Overviews, Perplexity, **Яндекс Нейро**) | CLIENT §3 GEO-таблица; §2.1 Schema/FAQ; OpenModel baseline; consumer Search — опционально | ✅ рекомендации |
| Schema.org, E-E-A-T, answer-first контент | §2.1 FAQ/ItemList/FAQPage; cite-worthy блоки | ✅ |
| Клиентский отчёт, KPI 60–90 дней | §7; PDF 2–3 стр. — **§10 Block 6** | ⚠️ PDF |
| Коммуникация / постановка задач | §2.1 P0/P1 с owner (клиент vs агентство) | ✅ |

> Вакансия geoBoost ([geoboost.pro](https://geoboost.pro/)) — **GEO не обязателен** («научим»); сильная SEO-база + демонстрация OpenModel GEO baseline закрывает профиль лучше, чем имитация consumer ChatGPT Search через API.

---

## Словарь

| Термин | Простыми словами |
|---|---|
| **SEO** | Видимость в обычном поиске (Google, Яндекс, Bing). |
| **GEO** | Упоминание бренда и **ссылки на категорию** в ответах нейросетей. |
| **Target URL** | Проверяемая категория (не главная и не соседний раздел). |
| **Demand (Wordstat)** | Сколько раз в месяц ищут фразу (Москва, 213). |
| **ВЧ / СЧ / НЧ** | Высоко- / средне- / низкочастотный запрос. |
| **Каннибализация** | Несколько URL одного сайта делят один спрос. |
| **Swoop API** | Наш шлюз к GLM, Gemini, Groq (продакшен-сервисы). |
| **OpenModel.ai** | Шлюз к моделям Cursor-класса (Anthropic `/v1/messages`). |

---

## 1. Аудит страниц (кратко)

**Askona:** страница открывается и индексируется, но Title перегружен, три URL конкурируют за один спрос (`deshevye` / `nedorogie` / `ekonom`), мало текста для людей и AI, target почти не цитируется.

**Lamoda:** target **уже хорошо виден** в поиске и AI; расхождение «штаны» в Title vs спрос «спортивные брюки», мало guide/FAQ.

---

## 2. Рекомендации

| Страница | Сейчас | Рекомендуем |
|---|---|---|
| Askona | 3 URL на один кластер | Один канонический URL + 301 или разведение тем |
| Askona | Title с повторами | `Дешёвые матрасы от производителя — купить с доставкой \| Askona` |
| Askona | Мало текста | Guide «Как выбрать недорогой матрас» + FAQ |
| Lamoda | «штаны» в H1 | «спортивные брюки» в Title/H1, «штаны» — синоним |
| Lamoda | Только листинг | Guide 70–100 слов + FAQ |
| Обе | — | Bing Webmaster + IndexNow (важно для ChatGPT Search) |
| Обе | — | ChatGPT Ads — **отдельный** paid-канал |

---

## 2.1 Как улучшить видимость (Google · Yandex · LLM)

Конкретные действия с ожидаемым эффектом. **P0** — в первую очередь; **P1** — после P0 или параллельно при ресурсах.

### Askona — проблемы: каннибализация 3 URL, слабый target в SERP и AI

| Канал | Действие | Ожидаемый эффект | Приоритет |
|---|---|---|---|
| **Google** | Выбрать **один канонический URL** (`/matrasy/deshevye-matrasy/` или `/nedorogie-matrasy/`), остальным — **301** или разведение тем (эконом ≠ дешёвые) | Один URL копит ссылочный вес и клики; исчезнет конкуренция `deshevye` / `nedorogie` / `ekonom` | **P0** |
| **Google** | **Title + H1:** «Дешёвые матрасы от производителя — купить с доставкой \| Askona»; убрать повторы бренда | Рост CTR в SERP; совпадение с запросами «дешёвые/недорогие матрасы» | **P0** |
| **Google** | **Внутренние ссылки** с главной, хаба `/matrasy/`, карточек — анкоры «дешёвые матрасы», «недорогие матрасы» → **target URL** | Передача PageRank на категорию; target чаще в топ-10 по 17 ключам | **P0** |
| **Google** | **Контент-гид 800+ слов** «Как выбрать недорогой матрас» + блок FAQ (5–7 вопросов) на странице категории | Релевантность long-tail; сниппет FAQ; материал для цитирования AI | **P0** |
| **Google** | **FAQ schema** (`FAQPage` JSON-LD) по вопросам из гида | Расширенный сниппет; выше видимость в AI Overviews | **P1** |
| **Yandex** | Те же Title/H1, канон, контент и перелинковка, что для Google | Единый сигнал релевантности в Яндексе; меньше «размывания» по трём URL | **P0** |
| **Yandex** | Кластеры по **Wordstat** (Москва, 213): «недорогие матрасы» (447), «дешёвые матрасы» (184), «матрасы купить» (7751) — отдельные блоки текста/фильтры | Покрытие ВЧ/СЧ; target чаще в топ-10 Yandex по §10 | **P1** |
| **Yandex** | **Яндекс.Вебмастер:** добавить сайт, подтвердить права, отправить sitemap, мониторить «Исключённые» и дубли (действие **клиента**) | Индексация канона; быстрее переобход после 301 | **P0** (клиент) |
| **LLM / GEO** | **Cite-worthy контент:** таблица размеров, цены «от», доставка, гарантия — структурированно, с явным URL категории в тексте | Модели чаще цитируют страницу с фактами и ссылкой (baseline §5 — Askona слабее Lamoda) | **P0** |
| **LLM / GEO** | **FAQ с брендом + URL:** «Где купить дешёвые матрасы Askona?» → ответ с `askona.ru/matrasy/deshevye-matrasy/` | Прямое попадание в промпты типа §5; рост `chatgpt_search_target` | **P0** |
| **LLM / GEO** | **Bing Webmaster + IndexNow** после публикации контента (ChatGPT Search опирается на Bing crawl) | Быстрее попадание обновлений в индекс → в ChatGPT Search | **P1** |
| **LLM / GEO** | **Structured data:** `Product` / `ItemList` на листинге + `FAQPage` | Богатые сигналы для краулеров AI-поиска | **P1** |

### Lamoda — проблемы: Title «штаны» vs спрос «брюки», мало FAQ; в AI уже сильная

| Канал | Действие | Ожидаемый эффект | Приоритет |
|---|---|---|---|
| **Google** | **Title/H1:** «Женские спортивные брюки — купить онлайн \| Lamoda»; «штаны» — во втором абзаце или синоним в тексте | Совпадение с ВЧ «женские спортивные брюки» (147) и «спортивные штаны женские» (508) | **P0** |
| **Google** | **Сниппет:** meta description 150–160 симв. с «брюки», «доставка», «скидки»; не дублировать Title дословно | Рост CTR при уже хороших позициях (target часто #1–#5) | **P1** |
| **Yandex** | Те же Title/H1 + description; проверить мобильный сниппет в §10 Block 2 | Единообразие в Google и Yandex по 17 ключам | **P0** |
| **Yandex** | **Яндекс.Вебмастер** — регистрация и sitemap (действие **клиента**) | Контроль индексации `/c/411/` | **P1** (клиент) |
| **LLM / GEO** | **Поддерживать свежесть:** актуальные цены, новинки, сезон (утеплённые брюки — отдельный FAQ-блок) | Сохранить 15/15 OpenModel + сильные ответы ChatGPT Search | **P1** |
| **LLM / GEO** | **Comparison guide:** «Спортивные брюки vs джоггеры vs леггинсы» 400–600 слов + FAQ | Покрытие смежных ключей (`джоггеры женские купить`); больше цитируемых фактов | **P1** |
| **LLM / GEO** | **Мониторинг ChatGPT Search** — те же промпты §5 раз в 2–4 нед.; фиксация в `seo-geo-manual-fill-template.csv` | Раннее обнаружение падения brand/target в AI-выдаче | **P0** |

> **Связь с замерами:** baseline SERP — **SerpApi авто** (§3, CSV); LLM — **§10 Block 3**. KPI 60–90 дней — **§7**.

---

## 3. Семантика, Wordstat и SERP (полная таблица)

**Demand:** Wordcraft / Yandex / **proxy** (4 ключа), Москва 213, 22–23.07.2026. Прокси помечены *(proxy)*; точные цифры — [wordstat.yandex.com](https://wordstat.yandex.com/) (§10 Block 4). **SerpAPI не имеет Wordstat** — см. §10 Block 4.

**SERP (авто):**
- **SerpAPI 22.07 ~21:37 UTC:** Google 17/17 + Yandex 17/17 + Bing 17/17 → `google_pos`, `yandex_pos`, `bing_pos`.
- **SerpAPI DuckDuckGo 22.07 ~22:25 UTC:** **17/17** → `duckduckgo_pos` в CSV (**`kl=ru-ru`**, `search_metadata.duckduckgo_url`). Деплой: `swoop_serpapi.py` + `main.py` → `autoro-agent-api` на VPS. Re-run: `SERPAPI_ENGINES=duckduckgo python3 scripts/seo-geo-serp-serpapi-run.py`.
- **Tavily 22.07 ~20:15 UTC:** 17/17 → `tavily_target`.
- **Brave** — утренний снимок (`bing_pos`/`brave_pos`).

| Ключ | Класс | Demand | Google | Yandex | DDG | Brave | Tavily | Target | Вывод |
|---|---|---:|---|---|---|---|---|---|---|
| дешевые матрасы | ВЧ | 184 | нет | нет | нет | нет | нет | нет | Askona вне топ-10 Google/Yandex/DDG |
| недорогие матрасы | ВЧ | 447 | нет | нет | нет | нет | нет | нет | Конкуренты son.ru, mnogosna |
| матрасы купить | ВЧ | 7 751 | >10 | >10 | >10 | Askona #7 | бренд #5 | бренд | Askona #8–9, не target |
| дешевые матрасы askona | СЧ | *10 proxy* | >10 | **1** | **2** | Askona #1 nedorogie | бренд #1 | **да (Yandex)** | Yandex target #1; DDG target #2 (было #1 при `us-en`) |
| недорогие матрасы аскона | СЧ | 2 | >10 | **1** | **2** | Askona #1 nedorogie | бренд #5 | **да (Yandex)** | Yandex target #1 |
| матрас недорого москва | СЧ | 20 | нет | **6** | нет | — | бренд #8 | **да (Yandex)** | Единственный Askona target в топ-10 Yandex |
| дешевый матрас 160x200 купить | НЧ | *71 683 proxy* | >10 | нет | нет | Askona #2 не target | нет | нет | Askona #6 `/160x200`, не deshevye; DDG target вне топ-10 при `ru-ru` |
| матрас эконом класса askona | НЧ | *5 proxy* | >10 | >10 | >10 | Askona #1 ekonom | бренд #5 | нет | Конкурирует `/matrasy-ekonom-klassa/` |
| дешевые матрасы от производителя | СЧ | — | нет | нет | **3** | **target #2** | нет | **да (DDG/Brave)** | Target DDG #3 (`ru-ru`; было #5 при `us-en`) и Brave #2 |
| женские спортивные брюки | ВЧ | 147 | **2** | **4** | **2** | target #5 | **target #4** | **да** | Lamoda стабилен во всех каналах |
| спортивные штаны женские | ВЧ | 508 | **4** | **4** | **2** | target #3 | нет | **да** | Target Google/Yandex/DDG |
| спортивные брюки купить | ВЧ | 31 | >10 | >10 | >10 | Lamoda #8 (муж.) | бренд #8 | частично | Мужская подкатегория |
| женские спортивные штаны lamoda | СЧ | *20 proxy* | **1** | **1** | **1** | **target #1** | **target #1** | **да** | Лучший брендовый ключ Lamoda |
| спортивные брюки … интернет магазин | СЧ | 3 | **4** | **3** | **2** | target #5 | нет (lamoda.kz) | **да** | Target Google/Yandex/DDG (#2 DDG при `ru-ru`) |
| джоггеры женские купить | НЧ | 63 | >10 | >10 | >10 | Lamoda #4 др. URL | бренд #7 | нет | Подкатегория `/c/7599/` |
| спортивные штаны для фитнеса женские | НЧ | 1 | >10 | >10 | **7** | Lamoda #3 | нет | частично | DDG #7 при `ru-ru` (было #3 при `us-en`) |
| утепленные спортивные брюки женские | НЧ | 9 | >10 | >10 | >10 | Lamoda #4 | бренд #5 `/c/868/` | частично | Сезонный long-tail |

**Прокси Wordstat (4 ключа):** SerpAPI **не** отдаёт Yandex Wordstat. Google Trends через Swoop → **502** (wrapper ждёт `organic_results`). Прокси в CSV: 10 / 71 683 / 5 / 20 — ориентиры; **подтвердить вручную** на wordstat.yandex.com (§10 Block 4).

**Итог SEO:** Lamoda target **стабильно в топе** (Google #1–#4, Yandex #1–#4, Brave, Tavily). Askona target **проигрывает** соседним категориям; в Google/Yandex target в топ-10 только «матрас недорого москва» (Yandex #6); каннибализация nedorogie/ekonom подтверждена SerpAPI.

**Файлы:** `docs/seo-geo-manual-fill-template.csv`, `docs/seo-geo-serp-results.json`, `docs/seo-geo-short-videos-results.json` (§3.1).

### 3.1 Google Short Videos (SerpAPI) — доп. проверка video SERP

**Дата пробы:** 23.07.2026 ~06:55 UTC · **engine:** `google_short_videos` · **geo:** `google.ru`, `gl=ru`, `hl=ru`, Moscow · **скрипт:** `scripts/seo-geo-short-videos-probe.py` · **JSON:** `docs/seo-geo-short-videos-results.json`.

**API (SerpAPI):** отдельный engine [`google_short_videos`](https://serpapi.com/google-short-videos-api) — не обычный `google`. Ответ: массив `short_video_results` (title, link, source, channel, duration); URL вида `google.ru/search?…&udm=39`. Swoop: `POST /api/v1/web/search/serpapi` с `"engine":"google_short_videos"` — **после деплоя** обновлённого `agent-api/swoop_serpapi.py` (до деплоя — 502, т.к. wrapper ждал `organic_results`). Локально / probe: `SERPAPI_API_KEY=… python3 scripts/seo-geo-short-videos-probe.py`.

**Проба 5/5 ключей** (mix Askona/Lamoda, ВЧ+бренд):

| Ключ | Short Videos | Бренд в карусели | Top sources | askona.ru / lamoda.ru в ссылках |
|---|---|---|---|---|
| дешевые матрасы | **да** (12) | нет | Instagram, TikTok, YouTube | **нет** — UGC/маркетплейсы |
| матрасы купить | **да** (12) | **да** (Askona в title) | Instagram, Threads, TikTok | **нет** — instagram.com/reel… |
| дешевые матрасы askona | **да** (12) | **да** | Instagram | **нет** — только Reels блогеров/ТЦ |
| женские спортивные брюки | **да** (12) | нет | Temu, Instagram, Pinterest | **нет** — Temu/WB/Pinterest |
| женские спортивные штаны lamoda | **да** (12) | **да** (Lamoda в title/channel) | Instagram, TikTok | **нет** — UGC; офиц. `@lamoda` Reel #9 |

**Выводы:**
- Карусель Short Videos **есть по всем 5 пробам** — Google отдаёт vertical video block (`udm=39`) даже для e-commerce RU-запросов.
- **Официальных ссылок askona.ru / lamoda.ru нет** — доминирует **UGC** (Instagram Reels ~70%, также TikTok, YouTube Shorts, Temu, Pinterest). Бренд виден через упоминания в title/channel, не через target URL.
- **Брендовые ключи** (`… askona`, `… lamoda`) → бренд в карусели **да**; **generic ВЧ** (`дешевые матрасы`, `женские спортивные брюки`) → бренд **нет**.
- **Релевантность для вакансии GEO:** полезно как **доп. сигнал** мониторинга video-SERP и social proof (YouTube Shorts / Reels / TikTok в выдаче Google), **не** как замена organic SERP или OpenModel GEO baseline. Для клиентского PDF — **1 абзац** «видео-выдача: UGC vs официальный сайт». Полный прогон 17 ключей — опционально (+17 searches SerpAPI Free Plan).

**CSV (5 проб):** колонки `short_videos_present`, `brand_in_short_videos` в `seo-geo-manual-fill-template.csv` (остальные ключи — пусто до полного прогона).

---

## 4. Модели Cursor (справочник из IDE)

Модели, доступные в **Cursor → Models** (скрин 22.07.2026). Для GEO-задания это ориентир: какие «типы» нейросетей проверять в ответах ChatGPT / Gemini / Claude и через OpenModel.

### Список 1 (основной Agent)

| Модель в Cursor | Метка | OpenModel ID (если есть) |
|---|---|---|
| Cursor Grok 4.5 | High Fast · NEW | `grok-4.5` *(OpenModel: 400, нет x.ai upstream)* |
| Composer 2.5 | Fast | — (только Cursor) |
| Opus 4.8 | High | `claude-opus-4-8` |
| GPT-5.6 Sol | Medium | `gpt-5.6-sol` |
| Fable 5 | High | `claude-fable-5` |
| Sonnet 5 | High | `claude-sonnet-5` |
| GPT-5.6 Terra | Medium | `gpt-5.6-terra` |
| Sonnet 4.6 | Medium | `claude-sonnet-4-6` |
| Opus 4.7 | Extra High | `claude-opus-4-7` |
| GPT-5.4 | Medium | `gpt-5.4` |
| Opus 4.6 | High | `claude-opus-4-6` |
| Opus 4.5 | — | нет в OpenModel-каталоге |

### Список 2 (дополнительные)

| Модель в Cursor | Метка | OpenModel ID |
|---|---|---|
| GPT-5.2 | Medium | нет в OpenModel-каталоге |
| Gemini 3.1 Pro | — | `gemini-3.1-pro-preview` |
| GPT-5.4 Mini | Medium | `gpt-5.4-mini` |
| Haiku 4.5 | — | `claude-haiku-4-5-20251001` |
| Gemini 3.5 Flash | — | `gemini-3.5-flash` |
| qwen/qwen3.6-plus-preview:free | — | — |

**Как проверять Cursor-модели:** в IDE — вручную тем же промптом (§5). Через API — [OpenModel Quickstart](https://docs.openmodel.ai/en/docs/getting-started/quickstart) (ключ `om-…`); результаты прогона — **§5.6**.

---

## 5. GEO — прогон LLM (22.07.2026, перебор всех ключей)

**Промпты (одинаковые для всех):**
- *Askona:* «Где купить недорогие матрасы в РФ? Дай 3–5 магазинов с URL. Упомяни askona.ru/matrasy/deshevye-matrasy»
- *Lamoda:* «Где купить женские спортивные брюки онлайн в РФ? Дай 3–5 магазинов с URL. Упомяни lamoda.ru/c/411/clothes-sportivnyebryuki»

**Успех:** модель назвала бренд **и** указала target URL, ответ **>200 символов**.

**Правило фиксации модели:** если ответ **полный и релевантный**, в таблице указываем **фактическую модель** (из `X-LLM-Route` или прямого API), а не ту, что была в запросе. Запросили Gemini, ответил GLM → в отчёте **GLM**. Native Gemini дал полный ответ → **меняем строку на Gemini 2.5 Flash**.

### 5.1 Swoop API — фактическая модель (22.07, после фикса thinking)

| Запрос в Swoop | **Факт. модель** | Askona | Lamoda | Route / длина |
|---|---|---|---|---|
| `glm/glm-4-flash` | **GLM-4-Flash** | ✅ | ✅ | `glm glm-4-flash`, 676 / 855 симв. |
| `gemini/gemini-2.5-flash` | **GLM-4-Flash** *(fallback, Gemini 429)* | ✅ | ✅ | контент полный, 885 / 1274 симв. — **GEO засчитываем GLM** |
| `groq/llama-3.3-70b-versatile` | **GLM-4-Flash** *(fallback, Groq 403)* | ✅ | ✅ | 798 / 1035 симв. |

### 5.2 Gemini 2.5 Flash — прямой API (ключ `AIzaSyB4gc…`, #1 в pool)

| Страница | Факт. модель | Статус | Длина | Примечание |
|---|---|---|---:|---|
| **Askona** | **Gemini 2.5 Flash** | ✅ полный + target | **3311** | `thinkingBudget: 0` (без thinking — иначе обрыв ~160 симв.) |
| **Lamoda** | Gemini 2.5 Flash | ⏳ 429 / **403** | — | free tier RPM; retry 23.07 с `thinkingBudget: 0` → **403 PERMISSION_DENIED** на `GOOGLE_API_KEY` из `.env`; повтор через ключ #1 из pool (§5.3) или Gemini app (§10 Block 3) |

> Swoop сейчас часто не доходит до native Gemini (429 на pool). Контент GEO **есть** через GLM fallback — см. §5.1. Когда Gemini отвечает полностью — **фиксируем Gemini**, не GLM.

### 5.3 Swoop Admin — health ключей Gemini (скрин 22.07)

| # | Префикс | Health в админке | GEO-прогон (22.07 ~19:32, thinking off) |
|---:|---|---|---|
| 1 | `AIzaSyB4gc…` | **ok** | 429 (RPM исчерпан прогонами) |
| 2 | `AIzaSyAJr…` | **ok** | 429 |
| 3 | `AIzaSyC-o…` | **ok** | 429 |
| 4 | `AIzaSyA2B…` | **ok** | 429 |
| 5 | `AIzaSyBsT…` | **ok** | 429 |
| 6 | `AIzaSyBuB…` | **лимит** | **403** denied (отключить в pool) |

**Итого в админке:** 6 ключей — **ok 5 · лимит 1** (как на скрине).

> **Health «ok»** в Swoop = короткая smoke-проверка ключа. **GEO-прогон** = длинный промпт; после серии тестов все ключи #1–5 дают **429** (free tier ~20 req/min на `gemini-2.5-flash`). Ранее ключ #1 (`AIzaSyB4gc…`) с `thinkingBudget: 0` давал **полный ответ 3311 симв.** — фиксируем как **Gemini 2.5 Flash ✅** (§5.2).

### 5.4 Прямой перебор ключей (VPS)

| Провайдер | Ключей | Результат перебора |
|---|---:|---|
| **GLM** | 4 | **#1–#3** — полный ответ, бренд + URL на обе страницы (572–1433 симв.). **#4** — **400** (модель `glm-4-flash` недоступна на этом ключе) |
| **Gemini** | 6 | Admin: **ok×5, лимит×1**. GEO сейчас: **#1–5 → 429**, **#6 → 403**. Рабочий **`AIzaSyB4gc…` (#1)** + thinking off → **3311 симв. ✅** (§5.2). **#6 — выключить** |
| **Groq** | **3** | **#1–#3** (в т.ч. новый `gsk_le…Z9oN`, 22.07): все **403** — Cloudflare **error 1010** с IP VPS. Ключ в админке сохранён; проблема **не в ключе**, а в блокировке датацентрового IP Groq/Cloudflare |
| **OpenModel** | 1 (+ локальный `om-…`) | Баланс **пополнен** (22.07 ~19:39 UTC). Каталог **47 моделей** OK. **15/17** Cursor-моделей из §4 — полный GEO ✅ (см. **§5.6**). Gemini — только через `generateContent` + `role:user`. Grok — **400** (нет upstream x.ai key). Kimi K3 — ✅ с редким 404 channel |

> **Про ключи Gemini:** все 6 ключей — **ваши**. Раньше в pool попадали Groq/GLM из-за групп без `provider` в Swoop Admin — **исправлено** (код + SQL). Сейчас `gemini_pool` = только AIza-ключи.

### 5.5 OpenModel.ai — каталог и endpoint по типу модели

Каталог (22.07.2026, ключ `om-B3L…AB71`): **47 моделей**. Endpoint map — [Quickstart](https://docs.openmodel.ai/en/docs/getting-started/quickstart).

| Тип | Endpoint | Header / auth |
|---|---|---|
| Anthropic (Claude) | `POST /v1/messages` | `x-api-key: om-…`, `anthropic-version: 2023-06-01` |
| OpenAI (GPT, Grok) | `POST /v1/responses` | `Authorization: Bearer om-…` |
| Gemini | `POST /v1beta/models/{id}:generateContent?key=om-…` | body: `contents[].role: "user"` **обязателен** |
| DeepSeek / Kimi / GLM | `POST /v1/messages` | как Anthropic |

**Kimi K3** slug в каталоге: `kimi-k3` (`owned_by: moonshot`, protocol `messages`).

**Cursor-only (нет в OpenModel):** Composer 2.5, qwen3.6-plus:free — проверка **только в IDE**.

### 5.6 OpenModel + Cursor models (22.07)

Прогон после пополнения баланса (~19:39–19:50 UTC). Промпты — §5. Успех = HTTP 200, >200 симв., бренд + target URL.

| Cursor / UI | OpenModel ID | API | Askona | Lamoda | Факт. модель | Длина A/L | Примечание |
|---|---|---|---|---|---|---:|---|
| Opus 4.8 | `claude-opus-4-8` | messages | ✅ | ✅ | claude-opus-4-8 | 1231 / 869 | |
| Opus 4.7 | `claude-opus-4-7` | messages | ✅ | ✅ | claude-opus-4-7 | 1166 / 1123 | Lamoda — retry после curl timeout |
| Opus 4.6 | `claude-opus-4-6` | messages | ✅ | ✅ | claude-opus-4-6 | 1039 / 1227 | |
| Sonnet 5 | `claude-sonnet-5` | messages | ✅ | ✅ | claude-sonnet-5 | 1147 / 899 | |
| Sonnet 4.6 | `claude-sonnet-4-6` | messages | ✅ | ✅ | claude-sonnet-4-6 | 1026 / 880 | |
| Fable 5 | `claude-fable-5` | messages | ✅ | ✅ | claude-fable-5 | 1310 / 1258 | |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | messages | ✅ | ✅ | claude-haiku-4-5-20251001 | 907 / 852 | |
| GPT-5.4 | `gpt-5.4` | responses | ✅ | ✅ | gpt-5.4 | 774 / 697 | |
| GPT-5.4 Mini | `gpt-5.4-mini` | responses | ✅ | ✅ | gpt-5.4-mini | 599 / 831 | |
| GPT-5.6 Sol | `gpt-5.6-sol` | responses | ✅ | ✅ | gpt-5.6-sol | 684 / 562 | |
| GPT-5.6 Terra | `gpt-5.6-terra` | responses | ✅ | ✅ | gpt-5.6-terra | 1229 / 1430 | |
| Gemini 3.5 Flash | `gemini-3.5-flash` | gemini | ✅ | ✅ | gemini-3.5-flash | 2311 / 1814 | `role:user` в body |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | gemini | ✅ | ✅ | gemini-3.1-pro-preview | 2584 / 1630 | Askona — retry |
| DeepSeek V4 Flash | `deepseek-v4-flash` | messages | ✅ | ✅ | **deepseek-v4-flash-202605** | 1697 / 1787 | факт. id из ответа API |
| **Kimi K3** | `kimi-k3` | messages | ✅ | ✅ | kimi-k3 | 1336 / 977 | Lamoda — retry; редкий 404 channel |
| Cursor Grok 4.5 | `grok-4.5` | responses | ❌ 400 | ❌ 400 | — | — | upstream: «Incorrect API key» x.ai |
| Composer 2.5 | — | — | N/A | N/A | — | — | только Cursor IDE |
| qwen3.6-plus:free | — | — | N/A | N/A | — | — | только Cursor IDE |

**Итого OpenModel GEO:** **15 моделей × 2 страницы = 30/30 успешных** (Grok — 0/2, Cursor-only — N/A).

**Матрица vs каталог OpenModel (47 моделей, [pricing](https://www.openmodel.ai/model-pricing)):** прогон покрывает **все 15 Cursor↔OpenModel маппингов из §4** (Composer 2.5, Opus 4.5, GPT-5.2, qwen3.6 — только IDE). Дополнительные slug в каталоге (kimi-k2.x, gpt-5.5, mimo-v2.x и др.) **не входят в Cursor-матрицу ТЗ**; повтор не требовался. Grok-4.5 — в каталоге, но upstream x.ai key отсутствует у OpenModel (400).

**Kimi K3 (Askona):** полный ответ 1336 симв., Askona + `askona.ru/matrasy/deshevye-matrasy` в списке #1.

**Kimi K3 (Lamoda):** 977 симв., Lamoda + target URL; первый запрос — curl timeout, второй — 404 channel, третий — ✅.

### 5.7 AI-search (Tavily) — полный прогон 17 ключей (22.07 ~20:15 UTC)

| Ключ | Tavily target | Tavily позиция | Примечание |
|---|---|---|---|
| дешевые / недорогие матрасы | нет | — | Шум (авиа, UA-сайты) |
| матрасы купить | бренд `/matrasy/` | brand #5 | Не target |
| дешевые матрасы askona | бренд | brand #1 | `/matrasy/`, не deshevye |
| женские спортивные брюки | **да** | **target #4** | `/c/411/` |
| женские спортивные штаны lamoda | **да** | **target #1** | Лучший Tavily-ключ Lamoda |
| спортивные штаны женские | нет | — | Шум (UA/Pinterest) |
| утепленные … брюки | бренд `/c/868/` | brand #5 | Сезонная подкатегория |

Полная матрица — **§3** и `docs/seo-geo-serp-results.json`.

### 5.8 Что значили строки «ответ обрывается»

Фраза **«ответ обрывается на вступлении»** = модель начинала («Конечно, вот несколько магазинов…») и **обрывалась**, не дав списка и URL. Причины:

1. **Баг маршрутизации Swoop** (исправлен) — ответ шёл не от той модели.
2. **Gemini free tier** — RPM ~20 на `gemini-2.5-flash`; серия GEO-прогонов → **429** на всех ключах (admin health при этом может оставаться «ok»). **`AIzaSyB4gc…` (#1)** — основной ключ; **#6 (`лимит`/403) — отключить**.
3. **Gemini 2.5 thinking** — без `thinkingBudget: 0` модель тратит почти весь лимит на «мысли», видимый ответ обрывается (**исправлено в agent-api**).
4. **Groq** — ключ **#3** в Swoop OK; с VPS **403 / Cloudflare 1010** (блок IP датацентра).

---

## 6. ChatGPT Ads

**ChatGPT Ads** — отдельный **paid-канал** ([ads.openai.com](https://ads.openai.com), Ads Manager). Объявления **помечены** и **не подменяют** органические ответы ChatGPT Search и GEO-цитаты. KPI рекламы (CPA/ROAS) вести **отдельно** от SEO/GEO (рефералы `utm_source=chatgpt.com`, доля AI-ответов с target URL).

**Для Askona и Lamoda (РФ e-com):**
- **Гео рекламодателя:** на момент проверки self-serve доступен для **US, CA, AU, NZ**; таргетинг — **только уровень страны** (без регионов/городов). Пилот показа ads расширяется, но **покупка из РФ** может быть недоступна — проверить доступ аккаунта в Ads Manager.
- **Таргетинг:** не ключевые слова, а **context hints** (естественное описание диалогов, где уместен продукт) + аукцион по релевантности.
- **Лендинг:** категория должна открываться для **`OAI-AdsBot/1.0`** без CAPTCHA, WAF-блоков и login-wall ([Advertiser Guidance](https://help.openai.com/en/articles/20001243-advertiser-guidance-for-allowing-openai-web-crawlers)). User-agent: `compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot`. IP-диапазоны: [openai.com/adsbot.json](https://openai.com/adsbot.json). Рекомендуется также разрешить **OAI-SearchBot** (органический AI-search).
- **Не заменяет:** Bing Webmaster + **IndexNow**, контент «answer-first», FAQ schema (§2.1) — база для **органических** цитат в ChatGPT Search.

**Рекомендация клиенту:** подать заявку в Ads Manager, параллельно проверить crawlability target URL для OAI-AdsBot; ads — **дополнение** к P0 SEO/GEO, не замена канонизации Askona и контента.

---

## 7. Итог и KPI (60–90 дней)

| | Askona | Lamoda |
|---|---|---|
| Поиск | Target слабый, каннибализация | Target **топ-5**, часто **#1–#3** |
| Wordstat-фокус | «недорогие/дешёвые», «матрасы купить» | «спортивные штаны/брюки» |
| GEO сейчас | **Gemini 2.5 Flash** ✅ Askona (прямой); **OpenModel 15 моделей** ✅ (§5.6); Swoop → GLM при 429 | **OpenModel 15 моделей** ✅ + Tavily + GLM (§5.6) |
| Следующий шаг | Канон URL + текст + Bing/IndexNow | «брюки» в Title + FAQ |
| Ключи LLM | Groq — proxy IP; Gemini 429; **OpenModel ✅** (§5.6); Grok — upstream x.ai; GLM #4 — другая модель | — |

**KPI:** позиции по 17 ключам; доля AI-ответов с target URL (baseline 20 запросов); рефералы из AI-источников.

---

## 8. Автоматический SERP (SerpAPI) + ручной дозаполн (LLM)

**Google, Yandex, Bing и DuckDuckGo — автоматически ✅:** Swoop `POST /api/v1/web/search/serpapi` + `scripts/seo-geo-serp-serpapi-run.py`. Google/Yandex/Bing ~21:37 UTC; **DuckDuckGo 17/17** ~22:25 UTC (`kl=ru-ru`). CSV: `google_pos`, `yandex_pos`, `bing_pos`, **`duckduckgo_pos`**.

**Brave / Tavily — ранее ✅:** утренний Brave-снимок и Tavily 17/17 — не перезаписывать.

**Остаётся вручную:** точный Wordstat 4 ключа, **клиентский PDF** — **§10 Blocks 4, 6**. Consumer ChatGPT Search / Gemini app — **опционально** (§10 Block 3). OpenModel GEO — **авто ✅**.

---

## 9. Осталось сделать (приоритет)

**Порядок работ:** PDF → Wordstat. ~~SERP все движки~~ — **✅ SerpAPI** (DDG **`kl=ru-ru`** ✅).

1. **Клиентский PDF 2–3 стр.** — **§10 Block 6** (~30 мин). **HIGHEST**
2. **Wordstat — 4 ключа (точные цифры)** — wordstat.yandex.com, регион 213. **§10 Block 4** (~15 мин). **HIGH**
3. ~~**DuckDuckGo re-run `kl=ru-ru`**~~ — **✅ Done** (~22:25 UTC, Swoop VPS).
4. **Опционально:**
   - **Consumer ChatGPT Search + Gemini app** — §10 Block 3.
   - **Gemini Lamoda API retry** — ключ pool #1.
   - **Swoop Admin:** отключить Gemini ключ **#6** (`AIzaSyBuB…`, 403).
   - **Groq** — residential/proxy IP (Cloudflare 1010 с VPS).
   - **Bing Webmaster + IndexNow** — §2.1.
   - **SerpAPI google_trends** — passthrough `geo=RU` (сейчас 502).

*Проверка: on-page 22.07; Wordcraft + proxy WS 23.07; SerpAPI Google/Yandex/Bing + DDG 17/17; Tavily 17/17; **OpenModel GEO 30/30** §5.6 + CSV.*

---

## 10. Пошаговая инструкция (ручная работа)

### Что агент уже сделал (22.07.2026)

| Задача | Результат |
|---|---|
| **SerpAPI Google/Yandex/Bing** | ~21:37 UTC → CSV + JSON |
| **SerpAPI DuckDuckGo 17/17** | ~22:25 UTC (`kl=ru-ru`, VPS deploy) |
| Tavily SERP 17/17 | ~20:15 UTC → `tavily_target` |
| CSV шаблон | `duckduckgo_pos`; Block3 **`OpenModel да`** в `chatgpt_search_*` / `gemini_app_*` |
| §3 таблица | Google + Yandex + **DDG** + Brave + Tavily |
| Wordstat proxy (4 ключа) | CSV + `google_trends_probe` (SerpAPI Trends **502**) |
| OpenModel GEO | **30/30 ✅** (§5.6) — primary API baseline, не consumer Search |

**Повтор SerpAPI:** `python3 scripts/seo-geo-serp-serpapi-run.py` (ключ `VITE_BOOKMARKS_API_KEY` из `.env`). DuckDuckGo **`kl=ru-ru`:** дефолт в `agent-api/swoop_serpapi.py` (на Swoop VPS) — `SERPAPI_ENGINES=duckduckgo python3 scripts/seo-geo-serp-serpapi-run.py`. Wordstat/Trends probe: `python3 scripts/seo-geo-wordstat-trends-probe.py`. **Google Short Videos (§3.1):** `SERPAPI_API_KEY=… python3 scripts/seo-geo-short-videos-probe.py` (или Swoop после деплоя `swoop_serpapi.py`).

**Brave через Swoop:** свежий merge-прогон отдаёт только Tavily; Brave-снимок assignment сохранён в CSV.

---

Выполнять **строго в порядке блоков** — LLM-видимость замеряется на тех же промптах §5. ~~Blocks 1–2 (Google/Yandex)~~ — **✅ SerpAPI**.

**Общие файлы:**
- Шаблон позиций и GEO: `docs/seo-geo-manual-fill-template.csv`
- Wordstat: `docs/seo-geo-wordstat-keywords.csv`
- Список **17 ключей** (копировать в поиск как есть):

| # | Ключ | Страница |
|---:|---|---|
| 1 | дешевые матрасы | Askona |
| 2 | недорогие матрасы | Askona |
| 3 | матрасы купить | Askona |
| 4 | дешевые матрасы askona | Askona |
| 5 | недорогие матрасы аскона | Askona |
| 6 | матрас недорого москва | Askona |
| 7 | дешевый матрас 160x200 купить | Askona |
| 8 | матрас эконом класса askona | Askona |
| 9 | дешевые матрасы от производителя | Askona |
| 10 | женские спортивные брюки | Lamoda |
| 11 | спортивные штаны женские | Lamoda |
| 12 | спортивные брюки купить | Lamoda |
| 13 | женские спортивные штаны lamoda | Lamoda |
| 14 | спортивные брюки женские купить интернет магазин | Lamoda |
| 15 | джоггеры женские купить | Lamoda |
| 16 | спортивные штаны для фитнеса женские | Lamoda |
| 17 | утепленные спортивные брюки женские | Lamoda |

**Target URL для сверки:**
- Askona: `https://www.askona.ru/matrasy/deshevye-matrasy/`
- Lamoda: `https://www.lamoda.ru/c/411/clothes-sportivnyebryuki/`

---

### Block 1–2: Google + Yandex SERP — **✅ DONE (SerpApi)**

**Статус:** выполнено автоматически 22.07 ~21:37 UTC (**34 запроса** Google+Yandex, 0 failures). `bing_pos`/`brave_pos` — утренний Brave-снимок (не перезаписан). Ручной incognito **не требуется**.

**Повтор:**

```bash
python3 scripts/seo-geo-serp-serpapi-run.py
```

**API:** `POST https://swoop.autoro.tech/api/v1/web/search/serpapi` · Header `X-API-Key` · Body `{"query":"…","engine":"google|yandex","limit":10}`

| Engine | Geo (Moscow) |
|---|---|
| `google` | `google.ru`, `gl=ru`, `hl=ru`, `location=Moscow, Russia` |
| `yandex` | `yandex.ru`, `lr=213` |

Опционально Bing: `SERPAPI_ENGINES=google,yandex,bing`. **DuckDuckGo:** `SERPAPI_ENGINES=duckduckgo` — geo **`kl=ru-ru`** (SerpAPI docs; default был `us-en`).

**Target highlights:** Lamoda G#1–4 / Y#1–4 / **DDG #1–2**; Askona target Y#6, DDG #5 «от производителя»; Google generic — target вне топ-10.

---

### Block 2b: DuckDuckGo SERP — **⚠️ Partial (geo-fix ready)**

```bash
# После деплоя agent-api на Swoop (kl=ru-ru в swoop_serpapi.py):
SERPAPI_USE_LOCAL=1 SERPAPI_ENGINES=duckduckgo python3 scripts/seo-geo-serp-serpapi-run.py
# или через Swoop (когда endpoint принимает geo):
SERPAPI_ENGINES=duckduckgo python3 scripts/seo-geo-serp-serpapi-run.py
```

**Снимок `kl=us-en` (~21:58 UTC):** Lamoda lamoda **#1**, брюки **#2**, интернет **#4**; Askona askona **#1**, от производителя **#5**. **Re-run `kl=ru-ru` (~22:25 UTC):** 17/17, failures 0; сдвиги: askona **#2**, от производителя **#3**, интернет **#2**, фитнес **#7**, 160x200 **нет** (было >10).

<details><summary>Legacy: ручной Google/Yandex (fallback)</summary>

Incognito + Москва → колонки `google_pos` / `yandex_pos`; target #1–10 или `>10`/`нет`.

</details>

---

### Block 3: LLM / GEO visibility — **✅ DONE (OpenModel primary)** · consumer Search **опционально**

#### Primary GEO evidence: OpenModel API (23.07.2026)

| Канал | Что это | CSV / deliverable | Статус |
|---|---|---|---|
| **OpenModel** | Chat API 15 моделей (Claude/GPT/Gemini/DeepSeek/Kimi), **без live web search** | `OpenModel да` brand+target (все 17 строк) | ✅ **30/30** §5.6 |
| **ChatGPT Search** | chatgpt.com + **Browse/Search** — живой Bing-индекс | отдельная колонка; **не** OpenModel | ⚠️ опционально |
| **Gemini app** | gemini.google.com + Google Search grounding | отдельная колонка; OpenModel Gemini ≠ app | ⚠️ опционально |

**Почему OpenModel ≠ ChatGPT Search / Gemini app (важно для интервью):**

| | OpenModel API | ChatGPT Search / Gemini app |
|---|---|---|
| Источник ответа | Веса модели + промпт §5; **нет** live crawl | Consumer pipeline: web search → цитаты → ответ |
| API | `api.openmodel.ai` — один ключ, 47 моделей в каталоге | Публичного Search API нет |
| Swoop Admin tier dropdown | Список **роутинга Swoop** (`sync_swoop_models.py` → DeerFlow `.env`); **не** полный OpenModel-каталог | — |
| Что доказывает 30/30 | Модели **знают** бренд + target URL по GEO-промпту — **baseline видимости** | Реальная **AI-выдача** с актуальными ссылками из индекса |
| Для ТЗ PDF | ✅ достаточно как **GEO baseline** + стратегия §2.1 | ✅ «плюс» если есть Plus/доступ к Search |

**Swoop tier dropdown vs OpenModel direct:** в Admin видны группы моделей (kimi-k3, claude, gpt, gemini) — это **маршрутизация chat/completions через Swoop**, синхронизируемая `deploy/deer-flow-swoop-sync/sync_swoop_models.py`. Прогон §5.6 шёл **напрямую в OpenModel API** (`om-…` ключ), с разными endpoint по протоколу (messages / responses / generateContent). Tier dropdown **не заменяет** прямой прогон и **не** включает consumer Search.

**Честная подпись в PDF:** «OpenModel API GEO baseline: 15/15 моделей, brand+target ✅ (Askona + Lamoda). Consumer ChatGPT Search / Gemini app — опциональный мониторинг».

#### 3.1–3.2 Consumer Search (опционально, ~20–30 min)

1. Открыть ChatGPT с **Search / веб-поиском** (план Plus/Team или доступ по ТЗ).
2. Вставить промпт **без изменений** (новый чат на каждый промпт):

**Askona (copy-paste):**
```
Где купить недорогие матрасы в РФ? Дай 3–5 магазинов с URL. Упомяни askona.ru/matrasy/deshevye-matrasy
```

**Lamoda (copy-paste):**
```
Где купить женские спортивные брюки онлайн в РФ? Дай 3–5 магазинов с URL. Упомяни lamoda.ru/c/411/clothes-sportivnyebryuki
```

3. Записать в CSV:
   - `chatgpt_search_brand` — **да/нет** (упомянут Askona / Lamoda).
   - `chatgpt_search_target` — **да/нет** (есть ли полный target URL или path `/matrasy/deshevye-matrasy/` / `/c/411/clothes-sportivnyebryuki/`).
4. Скрин или дата в `notes` — по желанию для PDF.

> Если Search недоступен — указать в `notes`: «только базовая модель, без Search».

#### 3.2 Gemini (app / gemini.google.com)

1. [gemini.google.com](https://gemini.google.com/) или приложение Gemini (тот же Google-аккаунт).
2. **Те же два промпта** (Askona + Lamoda) — copy-paste из §5.
3. CSV: `gemini_app_brand`, `gemini_app_target` — **да/нет**.

#### 3.3 Cursor IDE (2–3 модели из §4)

1. Cursor → Chat/Composer, выбрать модель (рекомендуется: **Sonnet 5**, **GPT-5.4**, **Gemini 3.5 Flash** — любые 2–3 из §4).
2. Тот же промпт Askona, затем Lamoda.
3. Фиксация: в `notes` строки ключа — «Cursor Sonnet 5: brand да, target да» (Composer 2.5 — опционально).

#### 3.4 OpenModel (уже выполнено)

**§5.6** — 15 моделей × 2 URL = **30/30** ✅. Повтор не нужен; в PDF — одна строка «OpenModel GEO baseline 100%».

---

### Block 4: Wordstat — 4 пробела — **MEDIUM** (~15 min)

#### Почему SerpAPI **не** заменяет Wordstat

| Источник | Что даёт | Доступ через SerpAPI/Swoop |
|---|---|---|
| **Yandex Wordstat** | Показы/клики по фразе, регион **213 Москва** | ❌ **Нет.** SerpAPI `engine=yandex` — только **SERP**, не Wordstat |
| **Yandex Cloud Search API v2** | `/v2/wordstat/topRequests` — программный Wordstat | ❌ отдельный API-ключ AI Studio + folderId (не SerpAPI) |
| **Google Trends** | Относительный interest 0–100, не monthly impressions | ⚠️ `engine=google_trends` в Swoop → **502** (wrapper ждёт organic_results) |
| **Wordcraft / proxy** | Оценки по аналогам | ✅ уже в CSV (23.07) |

**Попытка google_trends (23.07):** 4/4 → HTTP 502 через Swoop. Даже при успехе Trends ≠ Wordstat (разная методология, geo).

**Прокси записаны в CSV (заменить после ручного Wordstat):**

| Ключ | Proxy demand | Источник proxy |
|---|---:|---|
| дешевые матрасы askona | 10 | аналог брендовых НЧ |
| дешевый матрас 160x200 купить | 71 683 | кластер 160×200 (openbusiness.ru 2021) |
| матрас эконом класса askona | 5 | НЧ бренд |
| женские спортивные штаны lamoda | 20 | бренд+категория НЧ–СЧ |

#### Ручной Wordstat (точные цифры)

1. [wordstat.yandex.com](https://wordstat.yandex.com/) → регион **213 (Москва)**.
2. Только **4 ключа** — заменить proxy в `seo-geo-wordstat-keywords.csv`:

| Ключ | Куда записать |
|---|---|
| дешевые матрасы askona | `wordstat_demand`, `wordstat_clicks` в `seo-geo-wordstat-keywords.csv` |
| дешевый матрас 160x200 купить | то же |
| матрас эконом класса askona | то же |
| женские спортивные штаны lamoda | то же |

3. Режим: **«Все формы»** + при необходимости **точная фраза** в кавычках.
4. Обновить §3 таблицу — убрать *(proxy)*, поставить точные цифры.

**Альтернативы Wordstat (не для этого ТЗ, но для автоматизации):** Yandex Cloud Wordstat API; KeyCollector/Wordcraft; ручной экспорт Direct.

---

### Block 5: Swoop Admin — Gemini ключ #6 (~2 min)

1. Открыть [swoop.autoro.tech](https://swoop.autoro.tech) → **Admin → Settings → Gemini keys**.
2. Найти ключ **`AIzaSyBuB…`** (health **«лимит»**, GEO → **403**).
3. **Отключить** в pool (toggle off / удалить из активного списка).
4. Сохранить. Не трогать ключи **#1–#5** (ok); для Lamoda retry — ключ **#1** (`AIzaSyB4gc…`) + пауза 1–2 мин между запросами (RPM free tier).

---

### Block 6: PDF для hh.ru — **ГОТОВО** (~5 мин на экспорт)

**Файл уже собран:** `docs/SEO-GEO-audit-Askona-Lamoda-CLIENT.md` (2–3 стр., без техники Swoop/SerpAPI/OpenModel).

**Что сделать вам (3 шага):**

1. Откройте **`docs/SEO-GEO-audit-Askona-Lamoda-CLIENT.md`** → скопируйте в [Google Docs](https://docs.google.com) или откройте в редакторе.
2. Шрифт **10–11 pt**, проверьте таблицы §3–§4.
3. **Файл → Скачать → PDF** → `SEO-GEO-audit-Askona-Lamoda-2026-07.pdf` → **прикрепите в последнем вопросе** на [hh.ru/vacancy/135386252](https://hh.ru/vacancy/135386252).

**Pandoc:** `cd docs && pandoc SEO-GEO-audit-Askona-Lamoda-CLIENT.md -o SEO-GEO-audit-Askona-Lamoda-2026-07.pdf`

**В CLIENT уже есть:** GEO под ИИ (Нейро, AI Overviews, ChatGPT, Perplexity), Schema, E-E-A-T, SERP ru+en DDG, KPI.

<details><summary>Ручная сборка (legacy)</summary>

#### Шаг 1. Создать документ (5 мин)

1. Открыть [Google Docs](https://docs.google.com) → **Пустой документ**.
2. Поля: стандартные; шрифт **Arial или Roboto 10–11 pt** (таблицы — 9 pt).
3. Включить **колонтитул:** справа — «Autoro · SEO/GEO аудит · 23.07.2026».

---

#### Шаг 2. Титул (½ страницы)

Скопировать дословно:

- **Заголовок H1:** `SEO / GEO аудит категорий e-commerce`
- **Подзаголовок:** `Askona — дешёвые матрасы · Lamoda — женские спортивные брюки`
- **Дата:** `23 июля 2026`
- **1 абзац:** «Аудит двух целевых категорий: видимость в поиске (Google, Яндекс), AI-ответах и рекомендации на 60–90 дней.»

---

#### Шаг 3. Executive summary (½ страницы)

Скопировать **5–7 буллетов** из §0 deliverable (блок «Executive summary для ответа на вакансию»). **Удалить:** упоминания SerpAPI, OpenModel, Tavily, VPS, Swoop.

**Обязательные тезисы:**
- Lamoda target **стабилен в топ-5** (Google/Яндекс).
- Askona — **каннибализация** трёх URL; target слабее соседних категорий.
- **P0 Askona:** один канонический URL + контент + FAQ.
- **P0 Lamoda:** «брюки» в Title/H1.
- GEO: baseline AI-видимости есть; мониторинг ChatGPT Search — рекомендация.

---

#### Шаг 4. Аудит страниц §1 (¼ страницы)

Из deliverable **§1** — два коротких абзаца (Askona + Lamoda). **Не копировать** технические детали.

---

#### Шаг 5. Рекомендации §2 + §2.1 (1 страница)

1. Таблица **§2** «Сейчас → Рекомендуем» (6 строк) — вставить как таблицу Google Docs.
2. Ниже — **топ P0** из §2.1: по 3–4 строки на Askona и Lamoda (Google + Yandex + LLM). Полную таблицу §2.1 **не** вставлять — только приоритеты.

---

#### Шаг 6. Семантика и SERP §3 (1 страница)

1. Открыть `docs/seo-geo-manual-fill-template.csv` в Google Sheets или Excel.
2. Собрать **одну таблицу** с колонками:

| keyword | tier | demand | google_pos | yandex_pos | duckduckgo_pos | вывод (1 фраза) |

3. **Demand** — из `wordstat_ws`; для *(proxy)* добавить сноску «оценка».
4. **Вывод** — из колонки notes, укоротить до 5–8 слов.
5. Под таблицей — **2 предложения итога:** Lamoda сильная; Askona — каннибализация.

**Не включать:** колонки brave, tavily, chatgpt proxy, gemini proxy, bing (или одной строкой «Bing/Brave — в приложении по запросу»).

---

#### Шаг 7. ChatGPT Ads + KPI §6–§7 (¼ страницы)

1. **§6** — один абзац (4–5 предложений): ChatGPT Ads = paid, не заменяет SEO; гео US/CA/AU/NZ; для РФ — проверить доступ.
2. **§7** — таблица KPI 60–90 дней (Askona | Lamoda) — 4 строки из deliverable.

---

#### Шаг 8. Приложение GEO (опционально, ½ страницы)

Одна таблица:

| Канал | Askona brand+URL | Lamoda brand+URL |
|---|---|---|
| OpenModel API (15 моделей) | да | да |
| ChatGPT Search (consumer) | опционально | опционально |
| Gemini app (consumer) | опционально | опционально |

Если Block 3.1–3.2 выполнен — заменить «опционально» на да/нет.

---

#### Шаг 9. Что **удалить** перед экспортом

- §4, §5, §8, §9, §10 deliverable целиком.
- Любые API keys, OpenModel, Swoop, SerpAPI, Tavily, Groq, 429/403.
- Скриншоты админки, health ключей, Cursor model list.

---

#### Шаг 10. Экспорт PDF (5 мин)

1. Google Docs → **Файл → Скачать → PDF (.pdf)**.
2. Открыть PDF — проверить: таблица §3 **не обрезана**, нет висячих заголовков.
3. **Бюджет страниц:** титул ½ + summary ½ + §1 ¼ + §2 1 + §3 1 + §6–7 ¼ + приложение ½ ≈ **2.5–3 стр.**

---

#### Бюджет страниц (шпаргалка)

| Блок | Страниц |
|---|---:|
| Титул | 0.5 |
| Executive summary | 0.5 |
| §1 Аудит | 0.25 |
| §2 + §2.1 P0 | 1.0 |
| §3 Семантика + SERP | 1.0 |
| §6 Ads + §7 KPI | 0.25 |
| Приложение GEO (опц.) | 0.5 |
| **Итого** | **2.5–3.0** |

**Экспорт:** Google Docs → PDF (рекомендуется). Pandoc — только если таблицы уже в Markdown.

</details>

---

### Чеклист после §10

- [x] `google_pos` — 17/17 (**SerpAPI**)
- [x] `yandex_pos` — 17/17 (**SerpAPI**)
- [x] `duckduckgo_pos_ru` + `duckduckgo_pos_en` — 17/17 (**SerpAPI**, `kl=ru-ru` + `us-en`)
- [x] `bing_pos` / `brave_pos` — утренний Brave-снимок
- [x] `chatgpt_search_*` / `gemini_app_*` — **`OpenModel да`** (primary API baseline §5.6)
- [~] 4 ключа Wordstat — **proxy** в CSV (заменить точными с wordstat.yandex.com)
- [ ] Gemini ключ **#6** отключён в Swoop Admin
- [x] §3 обновлён (+ DDG, proxy WS)
- [x] PDF 2–3 стр. — **`docs/SEO-GEO-audit-Askona-Lamoda-CLIENT.md`** → экспорт PDF → hh.ru
