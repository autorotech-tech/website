# Jobhunter (HH uz / kz / ru)

Гибридный пайплайн откликов и прямого outreach к заказчикам.

| Слой | Решение |
|------|---------|
| Оркестрация | n8n workflow `jobhunter_hh` |
| Поиск | `api.hh.ru` (+ app token) → Apify fallback |
| Отклик HH | `POST /negotiations` (user OAuth), human gate |
| Enrich / сайт компании | `scripts/jobhunter` + опционально Scrapling |
| CRM | Google Sheets (`vacancies` / `profile` / `filters`) |
| Конфиг / память | Obsidian `Projects/Jobhunter/` |

## Быстрый старт

1. Создать Google Spreadsheet по шаблонам в [`sheets-templates/`](sheets-templates/).
2. Зарегистрировать приложение на [dev.hh.ru](https://dev.hh.ru) - см. [`oauth-setup.md`](oauth-setup.md). Использовать **тестовый** аккаунт hh.uz.
3. Скопировать [`n8n/workflows/jobhunter.env.example`](../../n8n/workflows/jobhunter.env.example) → секреты n8n / `.env`.
4. Импортировать [`n8n/workflows/jobhunter_hh.json`](../../n8n/workflows/jobhunter_hh.json).
5. Dry-run: `auto_apply=false`, `daily_cap=5`, только ingest.

```bash
# Локальный ingest (нужен HH_APP_TOKEN)
cd /path/to/website
python3 scripts/jobhunter/cli.py ingest --host uz --dry-run

# Офлайн проверка без API (фикстуры)
python3 scripts/jobhunter/run_fixture_pipeline.py
python3 scripts/jobhunter/test_hh_client.py
```

## Документы

- [`architecture.md`](architecture.md) - поток данных и статусы
- [`api-coverage.md`](api-coverage.md) - что закрывает HH API по 7 хостам и что ещё нужно
- [`sheets-schema.md`](sheets-schema.md) - колонки CRM
- [`oauth-setup.md`](oauth-setup.md) - OAuth app + applicant
- [`safety.md`](safety.md) - антибан, лимиты, human gate
- [`go-live-checklist.md`](go-live-checklist.md) - переход с теста на активный аккаунт
- [`sites/hh-uz.md`](sites/hh-uz.md) · [`hh-kz.md`](sites/hh-kz.md) · [`hh-ru.md`](sites/hh-ru.md)

## Цель продукта

Выход на работодателей/заказчиков **напрямую** (email/сайт), минуя ИИ-рекрутеров и агентства. Отклик через HH - вторичный канал при `hh_only`.
