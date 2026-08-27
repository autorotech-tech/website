# Site playbook: hh.kz

## API

- Base: `https://api.hh.ru`
- Area Kazakhstan: **40**
- CRM `host=kz`, URL вида `https://hh.kz/vacancy/<id>`

## Filters

Те же `employment_form` / `work_format`, что для uz; отдельная строка в листе `filters` с `host=kz`, `area_id=40`.

## Notes

- OAuth приложение одно на контур HH; resume_id отдельный в `hh_resume_id_kz`.
- Подключать после стабильного dry-run на hh.uz.
