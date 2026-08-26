# Site playbook: hh.ru

## API

- Base: `https://api.hh.ru`
- Area Russia (all): **113**; Moscow **1**; SPb **2**
- CRM `host=ru`

## Filters

Отдельная строка `filters` с нужным `area_id` и `search_url` на hh.ru.

## Notes

- Самый жёсткий anti-abuse; держать низкий daily_cap.
- Apify actors ориентированы на hh.ru - удобный fallback для search URL.
- Подключать последним после uz/kz.
