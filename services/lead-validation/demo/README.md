# Lead Validation — Demo UI

Статическая одностраничная демо-форма для vibe-coder showcase микросервиса `lead-validation`.

## Что внутри

| Файл | Назначение |
|------|------------|
| `index.html` | Разметка: hero + форма + result panel |
| `styles.css` | Тёмная ink/teal атмосфера, motion |
| `app.js` | Health-check + `POST /v1/leads/validate` |

UI вызывает API на `http://127.0.0.1:3105` (CORS уже включён в сервисе).

## Предпосылка: API на 3105

В другом терминале:

```bash
cd services/lead-validation
cp -n .env.example .env
npm install
npm run dev
```

Проверка:

```bash
curl -s http://127.0.0.1:3105/health
```

Ожидается JSON с `"ok": true`.

## Открыть демо

Из этой папки (`demo/`):

```bash
cd services/lead-validation/demo
npx --yes serve -l 5179 .
```

Открой в браузере: [http://127.0.0.1:5179](http://127.0.0.1:5179)

Альтернативы:

```bash
# Python
python3 -m http.server 5179

# Node без serve
npx --yes http-server -p 5179 -c-1 .
```

Не открывай `index.html` через `file://` — часть браузеров режет `fetch` к localhost.

## Как пользоваться

1. Статус API в шапке: online / offline.
2. **Fill sample** подставляет валидный пример из README сервиса.
3. **Validate lead** шлёт JSON на `POST /v1/leads/validate`.
4. Справа: `status` (`valid` | `risky` | `invalid`), score %, checks, raw JSON.

Если API выключен — баннер + сообщение в result panel.

## Для агента деплоя / Docker

Статику можно отдавать так:

- volume / copy каталога `demo/` в nginx / `serve`
- или Express static mount рядом с API, например:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/demo', express.static(path.join(__dirname, '../demo')));
```

Тогда UI: `http://127.0.0.1:3105/demo/` (если mount добавлен в сервис — это задача Docker/scripts workstream).

Endpoint в `app.js` по умолчанию остаётся `http://127.0.0.1:3105` — при same-origin mount можно позже сменить на относительный `/v1/leads/validate`.
