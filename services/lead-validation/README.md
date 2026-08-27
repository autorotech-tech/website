# Lead Validation Microservice

HTTP-микросервис валидации лидов для n8n / Swoop / лендинговых форм.

| Слой | Решение |
|------|---------|
| Runtime | Node.js 20+ |
| HTTP | Express |
| Схема входа | Zod |
| Телефон | `libphonenumber-js` (E.164) |
| Email | синтаксис + disposable blocklist + опциональный MX |

## Назначение и границы

**Валидируем:**
- обязательные поля (`email` обязателен)
- синтаксис email и список disposable-доменов
- опциональный MX-lookup (`CHECK_MX=true`)
- телефон (если передан) с нормализацией в E.164
- агрегированный `status` + `score`

**Не делаем в v1:**
- платное enrichment (Hunter, ZeroBounce, Apollo и т.п.) - Phase 2
- API-key auth - Phase 1.1
- batch endpoint - Phase 1.1
- persist в Postgres/Supabase
- прод-деплой в `deploy/lead-validation/` (локальный Docker для vibe-демо уже есть)

Справочник внешних API для Phase 2: [`KNOWLEDGE_SCRAPING_APIS_REFERENCE.md`](../../KNOWLEDGE_SCRAPING_APIS_REFERENCE.md) (категория Lead Generation).

## Vibe demo (turnkey)

Одна команда для локального демо (API + smoke curl; UI из `demo/` когда появится `index.html`):

```bash
cd services/lead-validation
chmod +x scripts/demo.sh
./scripts/demo.sh
```

Или через Docker:

```bash
cd services/lead-validation
docker compose up --build
```

Подробный handoff: **[VIBE.md](VIBE.md)** · UI: [`demo/`](demo/) · скрипт: [`scripts/demo.sh`](scripts/demo.sh) · compose: [`docker-compose.yml`](docker-compose.yml)

## Быстрый старт

```bash
cd services/lead-validation
cp .env.example .env
npm install
npm run dev
```

Health:

```bash
curl -s http://127.0.0.1:3105/health
```

Validate:

```bash
curl -s -X POST http://127.0.0.1:3105/v1/leads/validate \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@company.com","phone":"+12025550123","name":"Jane Doe","company":"Acme","source":"landing"}'
```

Тесты:

```bash
npm test
```

## API

### `GET /health`

```json
{ "ok": true, "service": "lead-validation", "version": "0.1.0" }
```

### `POST /v1/leads/validate`

Request:

```json
{
  "email": "user@company.com",
  "phone": "+12025550123",
  "name": "Jane Doe",
  "company": "Acme",
  "source": "landing"
}
```

Response:

```json
{
  "ok": true,
  "status": "valid",
  "score": 0.92,
  "checks": {
    "email": { "valid": true, "reasons": [] },
    "phone": { "valid": true, "e164": "+12025550123", "reasons": [] },
    "required": { "valid": true, "missing": [] }
  }
}
```

`status`: `valid` | `risky` | `invalid`

| HTTP | Когда |
|------|--------|
| 200 | Валидация завершена (в т.ч. `invalid` / `risky`) |
| 400 | Тело запроса не JSON / не проходит Zod-схему |
| 500 | Внутренняя ошибка |

## Правила скоринга

- База: `1.0`
- Нет / битый email → `invalid`, score режется сильно
- Disposable-домен → `risky` (штраф)
- MX отсутствует (при `CHECK_MX=true`) → `risky`
- Невалидный phone (если поле передано) → `invalid`
- Phone не передан → без штрафа (опциональное поле)

Итог:
- любые hard-fail → `invalid`
- иначе при штрафах → `risky`
- иначе → `valid`

## Env

| Переменная | Default | Описание |
|------------|---------|----------|
| `PORT` | `3105` | HTTP-порт |
| `CHECK_MX` | `false` | DNS MX lookup для email-домена |
| `DEFAULT_PHONE_REGION` | `US` | Регион по умолчанию для `libphonenumber-js` |

См. [`.env.example`](.env.example).

## Фазы

1. **MVP (сейчас):** Express API, email/phone/required, score, тесты
2. **Phase 1.1:** API key, batch `POST /v1/leads/validate/batch`
3. **Phase 2:** опциональные enrichment-провайдеры из Lead Generation справочника
4. **Deploy:** прод в `deploy/lead-validation/`; локальный vibe — [`docker-compose.yml`](docker-compose.yml) + [`VIBE.md`](VIBE.md)

## Связь с n8n / Swoop

Типовой поток: форма или webhook → n8n → `POST /v1/leads/validate` → ветка по `status` (`valid` в CRM, `risky` в review, `invalid` discard / retry).

Swoop может вызывать тот же endpoint из automation-потоков без UI.
