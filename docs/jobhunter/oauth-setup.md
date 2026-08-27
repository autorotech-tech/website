# HH OAuth setup (Autoro Hunt)

Приложение: **Autoro Hunt** (employer / внутренний инструмент).  
Redirect URI (строго как в [dev.hh.ru](https://dev.hh.ru/admin)):

```text
https://tech.autoro.tech/rest/oauth2-credential/callback
```

Канонические ссылки:

- [Авторизация (обзор)](https://api.hh.ru/openapi/redoc#section/Avtorizaciya)
- [Процесс авторизации](https://api.hh.ru/openapi/redoc#section/Avtorizaciya/Process-avtorizacii)
- [dev.hh.ru](https://dev.hh.ru/)
- MCP-референс: [autorotech-tech/headhunter-mcp-server](https://github.com/autorotech-tech/headhunter-mcp-server)

Локальный env для сервера: `ai-job-search/AutoroHunt.env` (не коммитить секреты).

## Какие токены нужны

| Переменная | Что это | Обязателен? | Как получить |
|---|---|---|---|
| `HH_CLIENT_ID` / `HH_CLIENT_SECRET` | Учётные данные приложения | Да | [dev.hh.ru/admin](https://dev.hh.ru/admin) |
| `HH_APP_TOKEN` | Access-токен **приложения** | **Да для поиска** (`GET /vacancies`) | См. ниже |
| `HH_USER_TOKEN` (= MCP `HH_ACCESS_TOKEN`) | Access-токен **пользователя/менеджера** | Нет для ingest/поиска; да для user/employer методов | OAuth `authorization_code` |
| `HH_REFRESH_TOKEN` | Обновление user-токена | Только если есть user OAuth | Вместе с user token |
| `HH_USER_AGENT` | `AutoroHunt/0.1 (email)` | Да (HH требует UA) | Задать вручную |
| `APIFY_TOKEN` | Fallback-скрапер | Нет | Swoop Admin → Settings → `apify_keys` |

В [headhunter-mcp-server](https://github.com/autorotech-tech/headhunter-mcp-server) имена чуть другие:

- `HH_APP_TOKEN` - то же самое
- `HH_ACCESS_TOKEN` / `HH_REFRESH_TOKEN` - то же, что наш `HH_USER_TOKEN` (+ refresh)

## 1. Токен приложения (`HH_APP_TOKEN`)

По [authorization_for_application](https://github.com/hhru/api/blob/master/docs/authorization_for_application.md):

1. Токен приложения генерируется **один раз**.
2. После выдачи его можно увидеть на [dev.hh.ru/admin](https://dev.hh.ru/admin). Если ещё ни разу не получали - на админке его не будет.
3. Программная выдача (то же, что OpenAPI «Авторизация приложения»):

```bash
curl -sS -X POST 'https://hh.ru/oauth/token' \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "HH-User-Agent: AutoroHunt/0.1 (your@email)" \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$HH_CLIENT_ID" \
  --data-urlencode "client_secret=$HH_CLIENT_SECRET"
```

В ответе поле `access_token` → это и есть `HH_APP_TOKEN`.  
Повторный запрос **отзывает** предыдущий app token.

Проверка:

```bash
curl -sS 'https://api.hh.ru/me' \
  -H "Authorization: Bearer $HH_APP_TOKEN" \
  -H "HH-User-Agent: $HH_USER_AGENT"
# ожидается auth_type=application

curl -sS 'https://api.hh.ru/vacancies?text=python&host=hh.uz&per_page=1' \
  -H "Authorization: Bearer $HH_APP_TOKEN" \
  -H "HH-User-Agent: $HH_USER_AGENT"
```

## 2. Токен пользователя (`HH_USER_TOKEN` / `HH_ACCESS_TOKEN`)

Нужен только для методов «от имени человека» (менеджер работодателя или, если когда-либо будет applicant scope): резюме, переговоры, preferred_contact и т.п.

Процесс (как в MCP `examples/oauth_flow.py` / OpenAPI «Авторизация пользователя»):

1. Открыть authorize URL с `client_id` и `redirect_uri` = n8n callback.
2. Пользователь логинится и разрешает доступ.
3. С callback приходит `?code=...`.
4. Обмен code → tokens:

```bash
curl -sS -X POST 'https://hh.ru/oauth/token' \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "HH-User-Agent: AutoroHunt/0.1 (your@email)" \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "client_id=$HH_CLIENT_ID" \
  --data-urlencode "client_secret=$HH_CLIENT_SECRET" \
  --data-urlencode "redirect_uri=$HH_REDIRECT_URI" \
  --data-urlencode "code=$CODE"
```

Сохранить:

- `access_token` → `HH_USER_TOKEN` и/или `HH_ACCESS_TOKEN`
- `refresh_token` → `HH_REFRESH_TOKEN`

Удобнее хранить user OAuth в **n8n Credentials → OAuth2**, а не в файле.

### Важно про отклики соискателя

С 15.12.2025 applicant API для новых приложений фактически закрыт; Autoro Hunt зарегистрирован как **employer**.  
`POST /negotiations` от имени соискателя через API для нашего кейса **не целевой путь**.  
Отклик с тестового аккаунта: **Playwright / browser + human gate**.  
API используем для **поиска/ingest** (+ позже employer-операции).

## 3. Apify (опционально)

Ключи лежат в Swoop: Admin → Settings → `apify_keys` (не в git).  
В `AutoroHunt.env` поле `APIFY_TOKEN=` - один рабочий ключ из пула, если нужен fallback-скрапер вместо `api.hh.ru`.

## 4. Безопасность

- Секреты только в `AutoroHunt.env` на сервере / n8n Credentials, не в Sheets и не в git.
- Не печатать полные токены в чат/логи.
- При `403/429` с текстом о подозрительной активности - `pause_on_block=TRUE` останавливает apply-ветку.
