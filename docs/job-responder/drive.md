# Job Responder - Google Drive import

Импорт файлов из папки Google Drive в Resume RAG (`source=job_responder`).

## UX (после настройки OAuth)

1. Один раз: **Подключить Google Drive** -> Google account picker / consent.
2. Один раз: вставить URL или ID папки (`https://drive.google.com/drive/folders/...`).
3. Дальше: **Импорт из Drive** - token берётся через `chrome.identity.getAuthToken` (без ручной вставки).

Токены Identity API кэширует Chrome; на сервер не сохраняются. Папка хранится в `chrome.storage.local` (`jrDriveFolderUrlOrId`).

Ручной token остаётся как fallback (блок «Ручной token»), если `client_id` ещё не прописан.

## Одноразовая настройка Google Cloud (обязательно для Connect)

Client ID для Chrome Extension - **публичный** (его кладут в `manifest.json`). Client secret **не** нужен и **не** коммитить.

1. [Google Cloud Console](https://console.cloud.google.com/) -> проект (новый или существующий).
2. **APIs & Services -> Library** -> включить **Google Drive API**.
3. **APIs & Services -> OAuth consent screen**:
   - User type: External (для личного теста) или Internal (Workspace).
   - App name / support email.
   - Scopes -> добавить `https://www.googleapis.com/auth/drive.readonly`.
   - Test users: свой Google-аккаунт (пока app в Testing).
4. **Credentials -> Create credentials -> OAuth client ID**:
   - Application type: **Chrome Extension** (не Web).
   - Item ID: ID расширения из `chrome://extensions` (Developer mode -> у карточки Job Responder).
5. Скопировать **Client ID** (`….apps.googleusercontent.com`) в:

```json
// extensions/job-responder/manifest.json
"oauth2": {
  "client_id": "PASTE_HERE.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/drive.readonly"]
}
```

6. Chrome -> `chrome://extensions` -> **Reload** Job Responder.
7. Side panel -> **Подключить Google Drive**.

### Стабильный Extension ID (рекомендуется для unpacked)

Пока расширение loaded unpacked без поля `key`, Chrome может менять ID между машинами. Для продакшена:

- опубликовать в Chrome Web Store **или**
- добавить в manifest поле `key` (публичный ключ из упакованного `.crx` / store listing), чтобы Item ID в GCP совпадал всегда.

Placeholder в репо: `YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com` - кнопка Connect скрыта, открыт ручной fallback.

## Что делает backend

`POST /api/v1/job-responder/resume/drive-import`:

- парсит folder id из URL
- `files.list` + download / export через Drive API v3
- текст / docs / csv / изображения (vision OCR) -> upsert в Resume RAG
- Shared drives: `supportsAllDrives=true`
- Лимит за импорт: до 25 файлов (`maxFiles`)

Redeploy agent-api **не** нужен только из-за Connect в extension - backend уже принимает `accessToken` в теле запроса.

## Fallback: ручной access token

Если OAuth client ещё не готов:

1. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Scope: `https://www.googleapis.com/auth/drive.readonly`
3. Authorize -> Exchange -> скопировать Access token в «Ручной token»
4. Токен ~1h - при 401 обновить

## Ограничения MVP (не zero-friction полностью)

| Есть | Пока нет |
|------|----------|
| Connect без paste token | Google Picker UI выбора папки |
| Авто-refresh через chrome.identity | Server-side token vault для Keept users |
| Folder URL один раз | Публикация в Web Store / verified OAuth brand |

Google Picker потребует отдельный API key + picker JS в extension page - следующий шаг после стабильного `client_id`.

## API

```http
POST /api/v1/job-responder/resume/drive-import
Content-Type: application/json

{
  "workspaceId": "1",
  "folderUrlOrId": "https://drive.google.com/drive/folders/XXXX",
  "accessToken": "ya29....",
  "kind": "job_experience",
  "category": "drive",
  "maxFiles": 25
}
```

## Checklist после изменений extension

1. Reload unpacked extension
2. Проверить, что в `manifest.json` реальный `oauth2.client_id` (не `YOUR_…`)
3. Подключить Drive -> указать folder -> Импорт
4. Test mode (`jrTestMode=true`) продолжает работать без Keept login
