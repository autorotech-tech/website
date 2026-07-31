# Keept Extension E2E (Playwright)

Автотесты расширения **Keep It For Me** (`bookmarks-bro`) против staging API.

## Предусловия

- Node 20+
- Chromium (Playwright): `npm run bookmarks-bro:e2e:install`
- Учётные данные BB Supabase test user (не коммитить):

```bash
export KEEPT_E2E_EMAIL='you@example.com'
export KEEPT_E2E_PASSWORD='...'
export AGENT_API_BASE='https://swoop.autoro.tech'   # optional, default staging
```

Можно положить `KEEPT_E2E_EMAIL` / `KEEPT_E2E_PASSWORD` в корневой `.env` (gitignored).

## Запуск

```bash
npm run bookmarks-bro:e2e:install
npm run bookmarks-bro:e2e
```

Только UI login:

```bash
npm run bookmarks-bro:e2e:ui-login
```

## Что тестируется

| Spec | Сценарий |
|------|----------|
| `01-extension-load` | Загрузка MV3, popup `#syncBtn` |
| `02-auth-ui-login` | `login.html` email/password → `userAccessToken` |
| `03-options-connection` | Resolve workspace + Test Connection + metrics |
| `04-sync-vector-obsidian` | Sync → job poll → metrics (vector pipeline) |

## Артефакт расширения

По умолчанию Playwright загружает папку `extensions/bookmarks-bro/`.

Для проверки zip-артефакта (как в CI):

```bash
BOOKMARKS_BRO_E2E_USE_ZIP=1 npm run bookmarks-bro:e2e
```

CI job `extension-e2e-staging` всегда использует `BOOKMARKS_BRO_E2E_USE_ZIP=1`.

## macOS / локальный Chrome

На macOS Playwright часто использует системный Chrome (`channel=chrome`). Если auto-detect extension id не срабатывает, задайте id вручную из `chrome://extensions` (Developer mode):

```bash
export BOOKMARKS_BRO_E2E_EXTENSION_ID='your32charid'
```

Рекомендуемый прогон — **GitHub Actions** (Ubuntu + Playwright Chromium).

## CI

Job `extension-e2e-staging` в `.github/workflows/keept-staging-smoke.yml`.

Secrets (GitHub repo):

- `KEEPT_E2E_EMAIL`
- `KEEPT_E2E_PASSWORD`

## Отчёты

После прогона: `extensions/bookmarks-bro/e2e/playwright-report/index.html`
