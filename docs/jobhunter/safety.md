# Safety: антибан и human gate

## Принципы

1. Официальный API предпочтительнее браузера.
2. Тестовый аккаунт до go-live.
3. `auto_apply=FALSE` и `auto_email=FALSE` по умолчанию.
4. Стоп при признаках блокировки.

## Лимиты (старт)

| Параметр | Значение |
|----------|----------|
| daily_cap | 5 |
| pause between applies | 45-120s random |
| max pages per ingest | 5 |
| enrich concurrency | 1 |
| company site requests | max 3 pages / company |

## Триггеры паузы (`pause_on_block`)

- HTTP 429
- HTTP 403 с negotiation/account hints
- тело ответа содержит captcha / "подозрительн" / blocked
- 3 ошибки подряд на apply

Действие: выставить в `filters` runtime flag (или n8n static data) `pipeline_paused=true`, строки со статусом `error` + `error_code=blocked|rate_limit|captcha`.

## Фильтр ИИ-рекрутеров / агентств

Skip если:

- `employer.type` ∈ agency (или из `filters.agency_employer_types`)
- exclude_keywords в title/snippet/description
- нет сайта и нет контактов + явные маркеры "отклик только через бота" / screening

## Human gate

1. Пайплайн пишет `cover_letter` / `email_body`, статус `awaiting_approve`.
2. В Sheets колонка `approve`: вручную `YES` или `NO`.
3. n8n ветка Apply читает только `approve=YES` и `auto_apply`/`auto_email` согласно каналу.
4. После успеха: `applied_hh` / `emailed` + `applied_at`.

## Browser / GoLogin

Не использовать для массового HH login. Допустим только:

- documented API gap (вложение файла)
- enrich чужого корпоративного сайта при жёстком anti-bot

Зафиксировать кейс в `sites/*.md` перед включением в прод.
