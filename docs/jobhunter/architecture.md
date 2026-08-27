# Jobhunter architecture

```text
Obsidian profile/filters ──┐
Google Sheets profile/filters ──┤
                                ▼
                         n8n Schedule / Manual
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
           HH API search   Apify fallback   Read CRM rows
                │               │               │
                └───────┬───────┘               │
                        ▼                       │
                 Dedup → vacancies sheet ◄──────┘
                        │
                        ▼
              Enrich (employer site, emails)
                        │
                        ▼
         Score + route: direct | hh_only | agency_skip
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    Draft email    Cover letter   (browser only if API gap)
          │             │
          └──────┬──────┘
                 ▼
           awaiting_approve  (human gate)
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  emailed   applied_hh    skipped/error
```

## Статусы строки `vacancies`

| status | смысл |
|--------|--------|
| `new` | только ingest |
| `enriched` | контакты/сайт разобраны |
| `offer_ready` | есть cover_letter / email draft |
| `awaiting_approve` | ждёт ручного OK |
| `applied_hh` | успешный `POST /negotiations` |
| `emailed` | письмо отправлено (после approve) |
| `skipped` | agency / low score / exclude |
| `error` | см. `error_code` |

## Коды ошибок (`error_code`)

`ok` · `rate_limit` · `captcha` · `blocked` · `already_applied` · `no_contact` · `agency_skip` · `api_forbidden` · `apify_failed` · `llm_failed`

## Маршруты

| route | условие | действие |
|-------|---------|----------|
| `direct` | есть email или явный preferred_contact | черновик письма + опционально HH |
| `hh_only` | нет прямого контакта, не agency | только HH apply после approve |
| `agency_skip` | agency / ИИ-скрининг / exclude keywords | `skipped` |

## Скрипты

| CLI | назначение |
|-----|------------|
| `cli.py ingest` | поиск + нормализация + дедуп JSON |
| `cli.py enrich` | классификация + извлечение email с сайта |
| `cli.py offer` | A/B cover letters + HH formatting |
| `cli.py apply` | dry-run / real `POST /negotiations` |
| `cli.py pipeline` | ingest → enrich → offer (без send) |

Вызов из n8n: Execute Command или HTTP Request на локальный helper; либо Code node с тем же JS-портом логики (Python - source of truth).
