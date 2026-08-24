# Job Responder - Google Drive import (MVP)

Импорт файлов из папки Google Drive в Resume RAG (`source=job_responder`).

## Что работает сейчас

1. В side panel: поле **Google Drive folder** (URL или folder id) + **OAuth access token**.
2. Кнопка **Импорт из Drive** -> `POST /api/v1/job-responder/resume/drive-import`.
3. Backend:
   - парсит folder id из URL `https://drive.google.com/drive/folders/FOLDER_ID`
   - `files.list` + download / export через Drive API v3
   - текст / docs / csv / изображения (через vision OCR) -> upsert в Resume RAG
4. Токен хранится только в `chrome.storage.local` (`jrDriveAccessToken`), **не** на сервере.

## Как получить access token (ручной MVP)

Полный OAuth consent flow в расширении **ещё не подключён** (TODO ниже).

Варианты для теста:

1. [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
   - Scope: `https://www.googleapis.com/auth/drive.readonly`
   - Authorize -> Exchange authorization code for tokens
   - Скопировать **Access token** в поле расширения
2. Или свой OAuth Client (Desktop/Web) с тем же scope и вручную вставить access token.

Токен короткоживущий (~1h) - при 401 обновите.

## Требования к папке

- Файлы доступны аккаунту, чей token вы вставили
- Shared drives: API вызывается с `supportsAllDrives=true`
- Лимит за один импорт: до 25 файлов (параметр `maxFiles`)

## TODO (полный OAuth)

- [ ] Chrome Identity / OAuth Client ID в `manifest.json` (`identity` permission + `oauth2`)
- [ ] Refresh token flow без ручной вставки
- [ ] Выбор папки через Google Picker
- [ ] Server-side token vault (только для залогиненных Keept users, не для test mode)

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
