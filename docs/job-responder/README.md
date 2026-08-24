# Job Responder - any-page отклики

Chrome MV3 extension: персонализированные отклики с Resume RAG.

## Установка

1. Chrome -> `chrome://extensions` -> Load unpacked
2. Папка: `extensions/job-responder/`
3. После обновления кода: **Reload** на карточке расширения

## Тестовый режим (сейчас по умолчанию)

- Без login: JWT не нужен
- Extension: `jrTestMode=true` (default), `jrWorkspaceId=1`
- Backend: `JOB_RESPONDER_TEST_MODE=1` (default), `JOB_RESPONDER_TEST_WORKSPACE_ID=1`
- Выключить: env `JOB_RESPONDER_TEST_MODE=0` + storage `jrTestMode=false`

### Если список sources пустой после загрузки CV

1. В side panel проверьте поле **workspaceId** (default `1`).
2. Нажмите **Сохранить**, затем **Обновить sources**.
3. Upload пишет в тот же `workspaceId`, что показан в статусе (`Resume RAG ws=…`).
4. На VPS/API должен быть тот же test workspace: `JOB_RESPONDER_TEST_WORKSPACE_ID` (обычно `1`).

## Sources (как NotebookLM)

- CV files (можно несколько) -> `kind=job_resume`
- Portfolio files / скриншоты (png/jpg/webp, multiple) -> `kind=job_experience`, category `screenshot` при vision OCR
- Текст для RAG (textarea) -> `POST .../resume/text-capture`, category `notes`
- URL links -> fetch + index (`category=link`)
- Ссылки из текста файлов/OCR/Drive/paste -> автоизвлечение http(s) **после** ответа ingest (не блокирует Cloudflare 524)
- Кнопка **Удалить** у каждого source
- Google Drive folder -> Connect через `chrome.identity` + import (см. [drive.md](./drive.md); нужен OAuth client ID в manifest)
- Чекбоксы: генерация только по выбранным источникам
- При ingest в content/summary пишется structured profile (`skills`, `roles`, `tools`, `experience`, `education`, `links` с title+описанием)
- Дедуп: тот же URL / content_hash / близкий текст -> merge (бейдж «слит»)
- Ссылки: title + 1–3 предложения (лёгкий fetch, async, не блокирует ingest)
- Список sources: компактные строки (не таблица)
- Generate: лимит 6 источников, JSON-ошибки без HTTP 502 (Cloudflare иначе подменяет HTML)
- После добавления: зелёный баннер сверху, блок **ingest** со счётчиком, подсветка новых sources, timestamp последнего ingest

## Сопроводительное (шаблон)

## Сопроводительное (шаблон)

- Поле **«Моё сопроводительное (шаблон)»** в side panel
- Хранится в `chrome.storage.local` (`jrCoverTemplate`)
- При генерации отклика передаётся как `coverTemplate` / `baseLetter`
- Если шаблон не пустой - LLM **адаптирует** его под вакансию (голос автора), а не пишет с нуля
- Формат HH: `-`, `->`, ASCII `"`

## Парсинг вакансии

`content/page-extract.js` на любой http(s) странице:

- HH: спец. селекторы
- Job boards: remote.co, getmatch.ru, finder.work, relocate.me, cryptojobslist.com, web3.career, workingnomads.com, aijobs.net, simplyhired.com, jobgether.com, flexjobs.com, powertofly.com, crossover.com, justremote.co, foorilla.com, instahyre.com
- Structured fields: title, salary, experience, employmentType, schedule, workingHours, workFormat, keySkills, seniority, location

## Релевантность

`POST /api/v1/job-responder/relevance` и кнопка «Оценка релевантности» в panel:

- score 0–100
- короткие rationale bullets (навыки / формат / роли)

## API

| Method | Path |
|--------|------|
| GET | `/api/v1/job-responder/resume/status` |
| GET | `/api/v1/job-responder/resume/sources` |
| POST | `/api/v1/job-responder/resume/capture` |
| POST | `/api/v1/job-responder/resume/text-capture` |
| POST | `/api/v1/job-responder/resume/file-capture` |
| DELETE | `/api/v1/job-responder/resume/sources/{id}?workspaceId=` |
| POST | `/api/v1/job-responder/resume/sources/delete` (`knowledgeItemIds` / `titles`) |
| POST | `/api/v1/job-responder/resume/link-capture` |
| POST | `/api/v1/job-responder/resume/drive-import` |
| POST | `/api/v1/job-responder/relevance` |
| POST | `/api/v1/job-responder/generate` (`coverTemplate` / `baseLetter` optional) |

## Redeploy API

После правок `agent-api/job_responder.py` / `main.py`:

```bash
npm run deploy:job-responder-api
# или: bash scripts/deploy-job-responder-api.sh
```

Копирует `job_responder.py` + `main.py` в контейнер `autoro-agent-api` и делает restart. Публичный префикс: `https://swoop.autoro.tech/api/v1/job-responder/...`

Локально: перезапуск process с `JOB_RESPONDER_TEST_MODE=1`.

Если в side panel **Not Found** / API 404 - маршруты ещё не на проде; после деплоя: Chrome -> `chrome://extensions` -> **Reload** у Job Responder.

## Фаза 2

См. [phase2-autofill.md](./phase2-autofill.md)
