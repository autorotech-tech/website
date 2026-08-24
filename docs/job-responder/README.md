# Job Responder - HH отклики (browser extension)

Chrome MV3 extension для персонализированных откликов на **hh.ru / hh.kz / hh.uz**.

## Архитектура

- **Auth:** Keept `/api/v1/bookmarks/auth/*` + `workspace_id`
- **Resume RAG:** отдельный slice в `knowledge_items` (`source=job_responder`, `kind=job_resume|job_experience|job_skills`)
- **Generate:** `POST /api/v1/job-responder/generate` (JWT only, не service key)

## API

| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/v1/job-responder/resume/status?workspaceId=` | Статус Resume RAG |
| POST | `/api/v1/job-responder/resume/capture` | Ingest резюме/опыта |
| POST | `/api/v1/job-responder/resume/search` | Semantic search только Resume RAG |
| POST | `/api/v1/job-responder/generate` | Cover letter / answers |

## Установка extension (dev)

1. Chrome -> Extensions -> Load unpacked -> `extensions/job-responder/`
2. Login (email/password Keept)
3. Загрузите резюме в side panel
4. Откройте вакансию на hh.ru/kz/uz -> side panel -> «Отклик»

## Локальный API

```bash
cd agent-api && uvicorn main:app --port 8900
```

В extension `jrApiBase` можно задать через storage: `http://127.0.0.1:8900`

## Фаза 2

См. [phase2-autofill.md](./phase2-autofill.md) - autofill вопросов и insert в чат HH (confirm gate).
