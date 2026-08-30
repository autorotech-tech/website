# Site playbook: hh.uz

## Search (UI)

Стартовый URL:

https://hh.uz/search/vacancy?employment_form=PROJECT&work_format=REMOTE&hhtmFromLabel=tab_remote&hhtmFrom=main

## API

- Base: `https://api.hh.ru` (единый API-контур HH)
- Area Uzbekistan: **97**
- Headers: `HH-User-Agent`, `Authorization: Bearer <app|user token>`
- Анонимный `GET /vacancies` может вернуть `403` без app token

## Host field

В CRM `host=uz`, URL вакансии обычно `https://hh.uz/vacancy/<id>`.

## Known issues

- Параметры `employment_form` / `work_format` должны совпадать со справочником `vacancy_search_employment_form` / dictionaries.
- При расхождении UI↔API использовать Apify fallback с `search_url` из filters.

## Anti-bot

Предпочитать API. Browser login на hh.uz - только documented gap + тестовый аккаунт.
