# HH API coverage vs Jobhunter tasks

Источник: [OpenAPI / ReDoc](https://api.hh.ru/openapi/redoc), [спецификация](https://api.hh.ru/openapi/specification/public), [hhru/api](https://github.com/hhru/api).

## Вердикт

**Единый `https://api.hh.ru` закрывает поиск и отклик на всех ваших хостах**, но **не закрывает цель "выйти на заказчика напрямую"** (сайт/HR email/рассылка вне HH). Нужны внешние слои: CRM, enrich, LLM-офферы, human gate, email.

## Ваши сайты = официальный enum `host`

В OpenAPI параметр `host` принимает:

| host | Страна (area id) | UI |
|------|------------------|-----|
| `hh.ru` | Россия `113` | hh.ru |
| `rabota.by` | Беларусь `16` | rabota.by |
| `hh1.az` | Азербайджан `9` | hh1.az |
| `hh.uz` | Узбекистан `97` | hh.uz |
| `hh.kz` | Казахстан `40` | hh.kz |
| `headhunter.ge` | Грузия `28` | headhunter.ge |
| `headhunter.kg` | Кыргызстан `48` | headhunter.kg |

Все запросы идут на `api.hh.ru` + `?host=...` (+ `locale`).  
Важно: **`host` не режет выдачу только регионом** - для географии нужен `area`.

Регистрация приложения: [dev.hh.ru](https://dev.hh.ru) (для kz также витрина [dev.hh.kz](https://dev.hh.kz/)).

## Что умеет API для соискателя (наш кейс)

| Задача Jobhunter | API | Как |
|------------------|-----|-----|
| Поиск вакансий по фильтрам | Да | `GET /vacancies` (`text`, `area`, `employment_form`, `work_format`, …) |
| Карточка вакансии / employer | Да | `GET /vacancies/{id}`, `GET /employers/{id}` |
| Справочники / регионы | Да | `GET /dictionaries`, `GET /areas`, `GET /areas/countries` |
| Список своих резюме | Да (user OAuth) | `GET /resumes/mine` (и связанные resume methods) |
| Отклик + сопроводительный текст | Да (user OAuth) | `POST /negotiations` / apply-to-vacancy: `vacancy_id` + `resume_id` + `message` |
| Статус откликов / переписка | Да (user OAuth) | `GET /negotiations`, messages endpoints |
| Подходящие резюме к вакансии | Да (user) | `suitable_resumes_url` в карточке при auth |
| Избранные вакансии | Да (user) | favorite vacancies |
| Сайт компании (если указан) | Частично | `employer.site_url` / поля employer - не всегда |
| Прямые контакты HR | Частично / редко | только если работодатель открыл контакты; `preferred_contact*` - про предпочтения соискателя/типы, не "достать email компании" |
| Приложить произвольный PDF к отклику | Скорее нет / UI | отклик привязывает **resume_id** на HH; отдельный multipart-файл в публичной OpenAPI для applicant apply не описан |
| Парсинг корпоративного сайта / HR email | Нет | вне API |
| Email/WhatsApp напрямую заказчику | Нет | Gmail/SMTP + CRM |
| Google Sheets / A/B офферы / human gate | Нет | n8n + Sheets + LLM |
| Обход ИИ-рекрутеров / агентств | Нет как метод | эвристики у нас (`agency_skip`, exclude keywords, prefer direct contacts) |

Замечания из спецификации поиска:

- без токена после первого `GET /vacancies` часто требуют капчу → нужен **app token** (и/или user token);
- глубина пагинации ограничена (~2000 результатов);
- выдача зависит от типа авторизации.

## Закрывает ли API задачи полностью?

| Блок | Закрыто API? |
|------|----------------|
| Multi-host ingest (все 7 сайтов) | Да (`host` + `area`) |
| Фильтры PROJECT/REMOTE и т.п. | Да (справочники + query) |
| Отклик на HH с текстом | Да |
| Вложение файла помимо resume на HH | Нет / сомнительно → fallback UI или ссылка на PDF в тексте |
| CRM, approve, лимиты, антибан-процесс | Нет → n8n/Sheets |
| Прямой outreach (цель продукта) | Нет → enrich сайта + email |
| Оптимизация офферов под JD | Нет → LLM + шаблоны |

**Итог: API = хороший фундамент для HH-канала (~60-70% пайплайна). Цель "напрямую к заказчику" API не решает.**

## Что ещё интегрировать

1. **OAuth**
   - App token: поиск без капчи.
   - User token (тестовый аккаунт на каждом нужном host / единый контур HH): apply + resumes.
2. **n8n + Google Sheets** - очередь, approve, caps (уже в каркасе Jobhunter).
3. **Enrich** - сайт компании → HR emails (Scrapling/HTTP; не HH login).
4. **LLM** - cover letter / email A/B + HH formatting + no-ai-slop.
5. **Email** - Gmail/SMTP после human gate (`auto_email=false`).
6. **Apify fallback** - только если search URL/UI расходится с API или 403/captcha storm.
7. **Browser/GoLogin** - только documented gap (вложение файла / капча login), не основной apply.
8. **Obsidian** - профиль, playbooks по host.

## Рекомендуемая матрица каналов

```text
HH API (host=*)     -> search + apply + negotiation status
Employer.site_url   -> enrich emails
Sheets + human gate -> CRM / A/B offers
Email SMTP          -> direct to customer (primary goal)
Apify / browser     -> fallback only
```

## Практический минимум для старта на 7 хостах

В `filters` - 7 строк (`host` + `area_id` + search params).  
В клиенте всегда передавать `host` и `HH-User-Agent`.  
Сначала dry-run ingest на всех host; apply - только test user + `approve=YES`.
