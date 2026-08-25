# Job Responder: Gemini RAG / NotebookLM options (2026-08)

**Verdict: hybrid — compact profile default; Gemini File Search implemented (opt-in via `JOB_RESPONDER_GEMINI_RAG=1`). Skip NotebookLM (enterprise + unofficial).**

**Status (2026-08-25): IMPLEMENTED**

| Компонент | Статус |
|-----------|--------|
| `agent-api/job_responder_gemini_rag.py` | store per workspace, sync, generate with `fileSearch` tool |
| Postgres `job_responder_gemini_stores` | workspace_id -> store_name, doc_count, last_sync_at |
| Dedupe | tags `gemini_rag_doc:` / `gemini_rag_hash:` на `knowledge_items` |
| Endpoints | `GET .../gemini-rag/status`, `POST .../gemini-rag/sync` |
| Generate | auto when flag + store ready; fallback compact profile |
| Extension v0.5.8 | статус Gemini RAG, кнопка sync, `useGeminiRag` при generate |
| Smoke | `scripts/deploy-job-responder-api.sh` step 4c (если flag=1 на VPS) |

Timeouts JR сейчас в основном от latency провайдеров (openmodel/Gemini/GLM) и CF wall-clock, не от «плохого RAG». Compact profile уже решает token bloat. File Search даёт лучший grounding по PDF, но **не** заменяет фикс таймаутов и **не** работает «бесплатно» через consumer NotebookLM.

Ключи: Swoop Admin → Settings → `gemini_keys` (тот же пул, что chat/embeddings). OpenRouter не используем.


**Practical MVP with Swoop Gemini keys:** only **Gemini File Search** (same `gemini_keys`). Not Enterprise NotebookLM (needs GCP licenses + Bearer). Not `notebooklm-py` (cookies / ToS / fragility).

---

## 1. Feasibility: что реально есть в 2026

### A. Gemini File API + prompt с file URI

- Upload через Files API → `fileUri` в `generateContent`.
- Сырые файлы **живут ~48 часов**, потом удаляются.
- Подходит для one-shot «закинуть PDF в контекст», **не** для постоянного корпуса CV/portfolio на workspace.

Docs: [Files API](https://ai.google.dev/gemini-api/docs/files).

### B. Gemini File Search (managed RAG stores) — **рекомендуемый аналог NotebookLM**

Официальный developer RAG в Gemini API (`google.genai` / REST `v1beta`):

1. `fileSearchStores.create` — persistent store (embeddings хранятся до ручного delete; ≠ 48h Files API).
2. `uploadToFileSearchStore` / `importFile` — chunk + embed + index.
3. Query: tool `file_search` в `generateContent` **или** Interactions API.

Ключевые факты (официальные docs):

| Тема | Факт |
|------|------|
| Persistence | Store indefinite; raw File API objects expire 48h |
| Billing | Storage free; query-time embeddings free; **pay** indexing embeddings (~$0.15/1M) + retrieved tokens as normal input |
| Limits | File ≤100 MB; project store size by tier (Free 1 GB … Tier3 1 TB); recommend store &lt;20 GB |
| Models | Flash/Pro семейства Gemini 2.5/3.x с поддержкой File Search |
| Incompat | Нельзя одновременно с Google Search grounding / URL Context в одном запросе |

Docs:

- [File Search (Interactions)](https://ai.google.dev/gemini-api/docs/file-search)
- [File Search (generateContent)](https://ai.google.dev/gemini-api/docs/generate-content/file-search)
- [File Search Stores API](https://ai.google.dev/api/file-search/file-search-stores)
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing#file-search)
- Blog multimodal: [File Search multimodal](https://blog.google/innovation-and-ai/technology/developers-tools/expanded-gemini-api-file-search-multimodal-rag/)

**Это и есть «upload docs once → ask like NotebookLM» через публичный Gemini API key.**

### C. NotebookLM / Gemini Notebook — три разных мира

| Вариант | Официальность | Auth | Подходит JR? |
|---------|---------------|------|--------------|
| **Consumer Gemini Notebook** (бывш. NotebookLM UI) | Product UI only | Google login | Нет публичного API |
| **Unofficial wrappers** (`notebooklm-py`, clipper blogs) | Community reverse-engineer | Browser cookies / session | **Нет для прод** |
| **Gemini Notebook Enterprise** (GCP Discovery Engine) | Official Cloud API | OAuth / `gcloud` bearer + project + **licenses** | Overkill; не Swoop `gemini_keys` |

---

## 2. Official Enterprise vs unofficial wrappers

### Official: Gemini Notebook Enterprise API

Источник (user-provided): [Create and manage notebooks (API)](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks)

- Endpoint pattern: `https://{ENDPOINT_LOCATION}-discoveryengine.googleapis.com/v1alpha/projects/{PROJECT_NUMBER}/locations/{LOCATION}/notebooks`
- Методы: `notebooks.create` / `get` / `listRecentlyViewed` / `batchDelete` / `share`; sources — отдельные API (`batchCreate`, `uploadFile`)
- Перед началом: **setup Gemini Notebook Enterprise** + **получить licenses** (это не free AI Studio)
- Auth: `Authorization: Bearer $(gcloud auth print-access-token)` — **не** AI Studio / Swoop `gemini_keys`
- UI notebooks: `https://notebooklm.cloud.google.com/...` (Google identity) или `https://notebooklm.cloud.google/...` (third-party IdP)
- Share: IAM role `Cloud NotebookLM User` + `notebooks.share`
- Плюсы: compliance (VPC-SC, CMEK, residency), поддержка Google
- Минусы для JR: seats/лицензии, GCP project, другой auth/billing, v1alpha, **нулевая переиспользуемость текущих Swoop Gemini keys**

### Unofficial: [teng-lin/notebooklm-py](https://github.com/teng-lin/notebooklm-py)

Из README (⚠️ Unofficial Library - Use at Your Own Risk):

- **Unofficial** — undocumented Google APIs; Google может менять internal endpoints без notice
- Not affiliated with Google; APIs may break; rate limits / throttling
- Best for prototypes, research, personal projects — **не** production SaaS
- Auth: **browser session cookies** / CSRF из UI (часто Playwright login) — **не** Gemini API key и не GCP service account
- Риски для JR: ToS automation (серая зона), lockout Google-аккаунта (Gmail/Drive в том же session), cookies на сервере = credential theft surface, хрупкость при каждом UI-RPC change
- Практический вывод: **не** добавлять в `agent-api` Dockerfile / dependencies

### Unofficial overview: [notebookclipper.com/blog/gemini-notebook-api](https://notebookclipper.com/blog/gemini-notebook-api)

Независимый обзор (тот же вывод, что у нас):

- Public **consumer** Gemini Notebook / NotebookLM API **нет**
- Official programmatic path = **Enterprise only** (Cloud + licenses)
- Community: open-source cookie clients + Chrome clipper extensions
- Consumer API «promised» Google, без beta/timeline на момент обзора

**Следствие для JR:** «сделать как NotebookLM» через consumer API — миф; либо Enterprise $, либо File Search на Gemini API keys, либо хрупкий scrape.

### ToS / cost / auth summary

| | File Search (Gemini API) | Notebook Enterprise | notebooklm-py / clippers |
|--|--------------------------|---------------------|---------------------------|
| **Auth** | `gemini_keys` в Swoop | GCP IAM + licenses | Google session cookies |
| **Cost** | Pay-as-you-go embeddings + tokens | Enterprise seats + Cloud | «Free» product tier + account risk |
| **ToS** | Supported product API | Supported enterprise | Undocumented; automation often against ToS |
| **Stability** | Documented REST/SDK | Documented (alpha) | Breaks when UI RPC changes |
| **Privacy** | Data under Gemini API terms | Customer GCP project | Personal Google account / cookies on server |

**Для Job Responder в Swoop: unofficial = skip. Enterprise = skip MVP. File Search = единственный разумный «NotebookLM-like» путь на существующих ключах.**

---

## 3. Fit for Job Responder

Сценарий: upload CV/portfolio PDF once per workspace → cover letter / Forms Q&A с текстом вакансии.

| Подход | Fit |
|--------|-----|
| **Compact profile (сейчас)** | Отлично для latency/CF; facts уже структурированы; хуже «цитата с страницы 7 PDF» |
| **File Search store per workspace** | Отлично для grounding; sync с file-capture; generate через Gemini + `file_search` tool |
| **Files API only** | Плохо (48h TTL) |
| **Enterprise notebook per user** | Технически ок, операционно нет |
| **notebooklm-py** | UX «как NotebookLM», прод-риск неприемлем |

Корневая причина таймаутов (см. Obsidian `Job Responder - generate timeout Forms Q&A`): retired model / медленный GLM / budget ~34s — **не отсутствие File Search**.

---

## 4. Pros / cons vs compact profile

| | Compact profile | Gemini File Search |
|--|-----------------|-------------------|
| **Latency** | Низкая (короткий prompt) | Выше (retrieval + больше input tokens) — может **хуже** для CF 524 |
| **Grounding** | Lossy merge | Semantic chunks + citations |
| **Cost** | Embeddings уже в Postgres RAG; chat tokens малы | Indexing + retrieved tokens каждый generate |
| **Privacy** | Данные в нашем Postgres | Копия в Google File Search store |
| **Dedupe** | Уже есть content_hash / URL merge | Нужен mapping `knowledge_item_id → document name` |
| **CF timeouts** | Уже смягчены caps | Риск увеличить wall time, если не Gemini-only + короткий vacancy |
| **Ops** | Есть | Новый sync/delete path, store IDs |

---

## 5. Recommended architecture (если включать)

```
file-capture / drive / text
        │
        ├─► Postgres Resume RAG (как сейчас) ──► compact profile ──► generate (default)
        │
        └─► [flag] Gemini File Search store (per workspace)
                    │
                    └─► generate_gemini_rag (optional path, Gemini only)
```

### Где хранить IDs

| Что | Где |
|-----|-----|
| `file_search_store_name` (`fileSearchStores/...`) | Postgres: колонка/таблица `job_responder_gemini_stores(workspace_id, store_name, embedding_model, created_at)` — **не** Swoop settings (settings = keys only) |
| Mapping source → Gemini document | `knowledge_items.meta` JSON: `{ "geminiDocumentName": "...", "geminiSyncedAt": "..." }` или отдельная таблица |
| Keys | `service_settings.gemini_keys` (существующий pool) |

### Sync path

1. После успешного `resume/file-capture` (и опционально text/link): если `JOB_RESPONDER_GEMINI_RAG=1` → enqueue/upload bytes в store workspace.
2. Delete source → `documents.delete` в store.
3. Re-sync: idempotent по `content_hash` / document display_name.

### Generate path (flag on)

1. Resolve store for `workspaceId`.
2. Prompt: vacancy + mode + cover template; **tools=[{file_search: {file_search_store_names: [store]}}]**.
3. Model: `gemini-3.5-flash` (или актуальный flash из JR_GEMINI_MODEL) — **только Gemini**, без OpenRouter / без GLM cascade на этом path.
4. Fallback: если store пуст / Gemini fail → **текущий compact path** (не ломать UX).

### Feature flag

```bash
JOB_RESPONDER_GEMINI_RAG=0   # default OFF on agent-api container
JOB_RESPONDER_GEMINI_RAG=1   # enable after deploy + smoke
JOB_RESPONDER_GEMINI_RAG_MODEL=gemini-2.5-flash  # optional override
```

Модуль: `agent-api/job_responder_gemini_rag.py` (REST, без `google-genai` / `notebooklm-py`).

### Enable on VPS (after smoke)

```bash
# in docker-compose or env for autoro-agent-api
JOB_RESPONDER_GEMINI_RAG=1
docker restart autoro-agent-api
```

Side panel: **Синхронизировать Gemini RAG** -> затем generate использует File Search (минимум tokens в prompt: только vacancy + template).

---

## 6. MVP scope

### Сейчас (этот документ): research + design — **достаточно**

Не включать File Search в prod generate, пока:

1. Таймауты стабилизированы на compact path (отдельный трек).
2. Есть smoke: create store → upload 1 PDF → `generateContent` + file_search &lt; ~15s на тестовом ключе.

### MVP v1 (когда готовы) — маленький

1. `job_responder_gemini_rag.py`: `ensure_store`, `upload_bytes`, `query_cover_or_qa` (REST или `google-genai` — сейчас в Docker **нет** `google-genai`; проще raw REST как `_gemini_generate_json`).
2. Env flag off by default.
3. Опциональные endpoints за flag:
   - `POST .../gemini-rag/sync` (workspace)
   - `POST .../gemini-rag/query` (debug)
4. Extension: **без изменений** в MVP (server-side only); позже checkbox «Gemini grounding».
5. Не трогать default `/generate` compact logic кроме `if flag and store: try gemini_rag else compact`.

### Explicitly out of MVP

- notebooklm-py / cookie auth
- NotebookLM Enterprise / Discovery Engine
- Replacing Postgres Resume RAG
- OpenRouter

---

## 7. Code sketch (не wired)

```python
# agent-api/job_responder_gemini_rag.py  (skeleton)
import os
import httpx

ENABLED = os.environ.get("JOB_RESPONDER_GEMINI_RAG", "0").strip() in {"1", "true", "yes"}
API = "https://generativelanguage.googleapis.com/v1beta"

def ensure_store(api_key: str, display_name: str) -> str:
    # POST /fileSearchStores?key=...
    ...

def upload_pdf(api_key: str, store_name: str, path_or_bytes, display_name: str) -> str:
    # uploadToFileSearchStore (resumable) + poll operation
    ...

def generate_with_file_search(
    api_key: str,
    store_name: str,
    model: str,
    prompt: str,
) -> str:
    url = f"{API}/models/{model}:generateContent?key={api_key}"
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "tools": [{
            "fileSearch": {
                "fileSearchStoreNames": [store_name],
            }
        }],
    }
    # POST body → extract text + grounding metadata
    ...
```

Default generate остаётся compact; этот модуль вызывается только при flag + наличии store.

---

## 8. Decision matrix (одна строка)

| Вопрос | Ответ |
|--------|--------|
| Нужен ли NotebookLM UX через API? | Официально — только Enterprise (дорого) или File Search (близкий аналог) |
| Можно ли на Swoop Gemini keys? | **Да — File Search.** Нет — Enterprise / unofficial |
| Стоит ли делать сейчас? | **Hybrid later**: сначала latency; File Search как opt-in grounding |
| Unofficial libs? | **Skip** (ToS, cookies, fragility) |

---

## 9. Next steps (для человека)

1. Не ставить `notebooklm-py` в agent-api.
2. Держать compact path default; добить timeout/Forms отдельно.
3. Когда нужно лучше grounding: spike 1–2 часа — create store + upload CV + timed `generateContent` с `file_search` на ключе из Swoop.
4. Если spike &lt;15s и citations полезны → MVP sync за `JOB_RESPONDER_GEMINI_RAG=1`.
5. Enterprise NotebookLM — только если появится отдельный GCP budget и compliance requirement.

## Sources

**User-provided (interrupt):**

1. [teng-lin/notebooklm-py](https://github.com/teng-lin/notebooklm-py) — unofficial cookie client
2. [Notebook Enterprise API — notebooks](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks) — official GCP
3. [notebookclipper: Gemini Notebook API](https://notebookclipper.com/blog/gemini-notebook-api) — landscape overview

**Official Gemini developer RAG:**

- [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- [File Search (generateContent)](https://ai.google.dev/gemini-api/docs/generate-content/file-search)
- [File Search Stores API](https://ai.google.dev/api/file-search/file-search-stores)
- [Pricing (File Search)](https://ai.google.dev/gemini-api/docs/pricing#file-search)

**Internal:** `docs/job-responder/README.md`, Obsidian Job Responder (compact profile, generate timeout / Forms Q&A)
