# VIBE.md — Lead Validation turnkey demo

Handoff для vibe-кодеров: микросервис + UI + validate loop за одну команду.

## Что доказывает этот демо

Turnkey петля **"форма / curl → validate → status + score"** без CRM, без платных enrichment API и без деплоя в прод:

| Слой | Что есть |
|------|----------|
| API | Express на `:3105` — `GET /health`, `POST /v1/leads/validate` |
| UI | Статика в `demo/` (когда появится `index.html`) — отдаётся тем же процессом |
| Скрипт | `scripts/demo.sh` — поднять API, smoke curl, подсказать URL |
| Docker | `docker compose up --build` — тот же порт, env из `.env.example` |

**Не в скоупе v1:** API key, batch, Postgres, Hunter/ZeroBounce/Apollo.

---

## Старт за 60 секунд

### Вариант A — npm (самый быстрый)

```bash
cd services/lead-validation
cp -n .env.example .env
npm install
chmod +x scripts/demo.sh
./scripts/demo.sh
```

Открой:

- Health: http://127.0.0.1:3105/health
- UI (если есть `demo/index.html`): http://127.0.0.1:3105/
- Validate: `POST http://127.0.0.1:3105/v1/leads/validate`

### Вариант B — Docker

```bash
cd services/lead-validation
docker compose up --build
```

Те же URL. Env берётся из `.env.example` (переопредели `CHECK_MX` / `DEFAULT_PHONE_REGION` через shell env или правкой файла).

### Smoke одной строкой

```bash
curl -s -X POST http://127.0.0.1:3105/v1/leads/validate \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@company.com","phone":"+12025550123","name":"Jane Doe","company":"Acme","source":"landing"}'
```

Ожидай JSON с `ok`, `status` (`valid` | `risky` | `invalid`), `score`, `checks`.

---

## Архитектура (one-pager)

```text
┌─────────────────┐     POST /v1/leads/validate      ┌──────────────────────────┐
│  demo/ (static) │ ───────────────────────────────► │  Express API :3105       │
│  or curl / n8n  │                                   │  ├ email (syntax+disp+MX) │
└─────────────────┘ ◄──────── status+score ───────── │  ├ phone → E.164          │
                                                      │  └ required (email)       │
                                                      └──────────────────────────┘
```

- **Вход:** JSON `{ email, phone?, name?, company?, source? }`
- **Выход:** агрегированный `status` + `score` + детальные `checks`
- **UI:** если лежит `demo/index.html`, API раздаёт его с `/` (helmet CSP ослаблен только в этом режиме)
- **n8n / Swoop:** тот же endpoint — ветка по `status`

Файлы:

| Путь | Роль |
|------|------|
| `src/` | API |
| `demo/` | UI (frontend agent) |
| `scripts/demo.sh` | one-command local |
| `docker-compose.yml` + `Dockerfile` | one-command container |
| `README.md` | спека API |
| `VIBE.md` | этот handoff |

---

## Что крутить дальше

### Phase 1.1 — защита и batch

- API key (header `X-Api-Key` / `Authorization`)
- `POST /v1/leads/validate/batch`
- Ужесточить helmet CSP после того, как UI перестанет нуждаться в inline scripts

### Phase 2 — enrichment

Опциональные провайдеры из справочника Lead Generation:

→ [`KNOWLEDGE_SCRAPING_APIS_REFERENCE.md`](../../KNOWLEDGE_SCRAPING_APIS_REFERENCE.md)

Идеи: Hunter / ZeroBounce / Apollo-альтернативы — только как плагины за флагом env, не ломая бесплатный MVP-путь.

### Deploy

Прод-контур планируется в `deploy/lead-validation/` после стабильного MVP. Текущие `Dockerfile` / compose — **только local vibe**, без multi-replica / secrets manager.

---

## Troubleshooting

| Симптом | Что сделать |
|---------|-------------|
| `demo.sh`: port busy | Уже живой API — скрипт переиспользует `/health`; либо освободи `:3105` |
| UI 404 | Нет `demo/index.html` — положи файл и перезапусти процесс |
| Docker build | Нужен Docker Desktop / engine; из каталога сервиса: `docker compose up --build` |
| MX медленный / flaky | Оставь `CHECK_MX=false` для демо; `true` только если нужен DNS |

Тесты: `npm test` в `services/lead-validation`.
