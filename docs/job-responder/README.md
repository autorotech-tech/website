# Job Responder - any-page отклики

Chrome MV3 extension: персонализированные отклики с Resume RAG.

## Установка

1. Chrome -> `chrome://extensions` -> Load unpacked
2. Папка: `extensions/job-responder/`
3. После обновления кода: **Reload** на карточке расширения

## Тестовый режим (сейчас по умолчанию)

- Без login: JWT не нужен
- Extension: `jrTestMode=true` (default), `jrWorkspaceId=1`
- Backend: `JOB_RESPONDER_TEST_MODE=1` (default)
- Выключить: env `JOB_RESPONDER_TEST_MODE=0` + storage `jrTestMode=false`

## Sources (как NotebookLM)

- CV file -> `kind=job_resume`
- Portfolio files -> `kind=job_experience`
- URL links -> fetch + index
- Чекбоксы: генерация только по выбранным источникам

## Парсинг вакансии

`content/page-extract.js` на любой http(s) странице:
- HH: спец. селекторы
- Остальное: h1 / article / main / largest text block

## API

| Method | Path |
|--------|------|
| GET | `/api/v1/job-responder/resume/status` |
| GET | `/api/v1/job-responder/resume/sources` |
| POST | `/api/v1/job-responder/resume/capture` |
| POST | `/api/v1/job-responder/resume/file-capture` |
| POST | `/api/v1/job-responder/resume/link-capture` |
| POST | `/api/v1/job-responder/generate` |

## Фаза 2

См. [phase2-autofill.md](./phase2-autofill.md)
