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
- Чекбоксы: прозрачность выбора; generate/relevance всегда сливают отмеченные (или все) в **unified compact profile**
- При ingest в content/summary пишется structured profile (`skills`, `roles`, `tools`, `experience`, `education`, `links` с title+описанием)
- Дедуп: тот же URL / content_hash / близкий текст -> merge (бейдж «слит»)
- Ссылки: title + 1–3 предложения (лёгкий fetch, async, не блокирует ingest)
- Список sources: компактные строки (не таблица)
- Generate: LLM получает vacancy + **один** compact profile (~3–6k chars), не тела PDF; при timeout - retry с ещё более сжатым профилем; JSON-ошибки без HTTP 502
- После добавления: зелёный баннер сверху, блок **ingest** со счётчиком, подсветка новых sources, timestamp последнего ingest

## Релевантность

`POST /api/v1/job-responder/relevance` и кнопка «Оценка релевантности» в panel:

- score 0–100 по **тому же** unified compact profile (tools / skills / role / format / experience)
- **Semantic grid** (`jr_semantic_grid`): synonym clusters + evidence из RAG (ROAS/GMV/PPC…) без LLM
- Matching: exact → synonym → fuzzy/token; «Не хватает» только если нет семантического покрытия
- rationale + matched / missing / `semanticMatches` в side panel

## v0.6.1

- Semantic relevance: `agent-api/job_responder_semantic.py` + cache grid on merge
- UI: подсказки «Совпало (семантика): b2c маркетинг <- growth marketing, ROAS»

## LLM (generate)

Порядок провайдеров: **openmodel → Gemini flash → GLM** (быстрые первыми). OpenRouter не используется.
Ключи: Swoop Admin -> Settings (openmodel / Gemini / GLM).
Модель Gemini: `gemini-3.5-flash` (старая `gemini-2.0-flash` на проде давала 404 и сжигала бюджет).

Первый запрос уже с **агрессивным** unified profile (≤2800 символов), vacancy ≤1600, cover template ≤1200.
Бюджет wall-clock ~34с; при timeout - сразу mini-retry (1600/600), в ошибке указаны провайдеры.

Промпт: `VACANCY` + `RESUME CONTEXT` = unified profile + optional cover template.

## Google Forms + таблицы Q&A

1. Откройте форму `https://docs.google.com/forms/.../viewform` (или страницу с таблицей Вопрос|Ответ).
2. Side panel -> **Обновить с страницы** - вопросы попадут в блок **«Вопросы формы»**.
3. **Ответы на вопросы** (`mode: qa`) - LLM вернёт `{ answers: [{question, answer}] }`.
4. Копируйте ответ по строке или **Копировать все**.

Парсер: `FB_PUBLIC_LOAD_DATA_` + DOM (`.Qr7Oae`, `role=listitem`, legacy freebird) + HTML `table` heuristics.

## Сопроводительное (шаблон)

- Поле **«Моё сопроводительное (шаблон)»** + кнопка **Взять из RAG**
- Автоподстановка из Resume RAG, если storage пуст и найден source с "сопроводительн" / cover letter
- Хранится в `chrome.storage.local` (`jrCoverTemplate`)
- При генерации отклика передаётся как `coverTemplate` / `baseLetter`
- Если шаблон не пустой - LLM **адаптирует** его под вакансию (голос автора), а не пишет с нуля
- Формат HH: `-`, `->`, ASCII `"`

## Sources list (v0.5.6+)

Строка: checkbox | title | meta | delete. Чекбоксы не должны раздуваться на 100% ширины (`input[type=checkbox] { width: auto }`).
Отклик по умолчанию идёт через unified compact profile (много sources OK).

## v0.5.8

- **Gemini File Search RAG** (opt-in): store per workspace, sync после ingest, generate через `fileSearch` tool
- Side panel: статус Gemini RAG, кнопка «Синхронизировать Gemini RAG»
- API: `GET/POST .../gemini-rag/status|sync`; generate поля `usedGeminiRag`, `geminiRagCitations`
- Flag: `JOB_RESPONDER_GEMINI_RAG=1` на agent-api (после smoke)

## v0.5.7

- Generate latency: openmodel→Gemini→GLM, compact ≤2800 first, `gemini-3.5-flash`
- Google Forms + table Q&A в side panel («Вопросы формы»)

## Парсинг вакансии

`content/page-extract.js` на любой http(s) странице:

- HH: спец. селекторы
- **Google Forms**: `docs.google.com/forms/.../viewform` (FB_PUBLIC_LOAD_DATA_ + DOM)
- **Таблицы** вопрос/ответ на любых страницах
- Job boards: remote.co, getmatch.ru, finder.work, relocate.me, cryptojobslist.com, web3.career, workingnomads.com, aijobs.net, simplyhired.com, jobgether.com, flexjobs.com, powertofly.com, crossover.com, justremote.co, foorilla.com, instahyre.com
- Structured fields: title, salary, experience, employmentType, schedule, workingHours, workFormat, keySkills, seniority, location
- Questions: `[{id, text, type, options[]}]` (Forms / table / HH)

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
| POST | `/api/v1/job-responder/generate` (`mode`: `cover_letter` \| `qa` \| `question_answers`; `questions` optional; `coverTemplate` / `baseLetter` optional; `useGeminiRag` optional) |
| GET | `/api/v1/job-responder/gemini-rag/status?workspaceId=` |
| POST | `/api/v1/job-responder/gemini-rag/sync` (`workspaceId`, `poll`) |

## Gemini RAG (File Search)

1. На VPS: `JOB_RESPONDER_GEMINI_RAG=1` + redeploy (`npm run deploy:job-responder-api`).
2. Ключи: Swoop Admin -> Settings -> `gemini_keys`.
3. Extension **Reload** (v0.5.8+).
4. Загрузите sources -> **Синхронизировать Gemini RAG** (или дождитесь background sync после ingest).
5. **Отклик** / **Ответы на вопросы** - при `ready=true` prompt содержит только vacancy + template; факты из store.

Подробнее: [gemini-rag.md](./gemini-rag.md).

## Автomation groundwork (MVP scaffold)

Следующий шаг (не в v0.5.8): HH auto-fill + отправка сгенерированного письма и вложений в чат Cursor/расширения.

- Placeholder endpoint (future): `POST /api/v1/job-responder/outbound/prepare` - `{ letterText, attachmentSourceIds[] }` -> bundle для чата
- Extension: кнопка «Подготовить для чата» (копия письма + список file sources)
- См. [phase2-autofill.md](./phase2-autofill.md)

## Redeploy API

После правок `agent-api/job_responder.py` / `main.py`:

```bash
npm run deploy:job-responder-api
# или: bash scripts/deploy-job-responder-api.sh
```

Копирует `job_responder.py` + `job_responder_gemini_rag.py` + `main.py` в контейнер `autoro-agent-api` и делает restart. Публичный префикс: `https://swoop.autoro.tech/api/v1/job-responder/...`

Локально: перезапуск process с `JOB_RESPONDER_TEST_MODE=1`.

Если в side panel **Not Found** / API 404 - маршруты ещё не на проде; после деплоя: Chrome -> `chrome://extensions` -> **Reload** у Job Responder.

## Gemini RAG / NotebookLM

Реализовано: Gemini File Search на `gemini_keys` (см. [gemini-rag.md](./gemini-rag.md)).

**Кратко:** default = compact profile; opt-in = Gemini File Search при `JOB_RESPONDER_GEMINI_RAG=1`. NotebookLM Enterprise и `notebooklm-py` - не для JR.

## Маршрутизация моделей / token economy

Tier-схема (Tier 0 без LLM → ultra-cheap → flash generate → quality), task routing, caps и roadmap: [model-routing.md](./model-routing.md).

## Фаза 2

См. [phase2-autofill.md](./phase2-autofill.md)
