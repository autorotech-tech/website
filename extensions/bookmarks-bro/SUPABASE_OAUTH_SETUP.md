# Supabase: OAuth для расширения Bookmarks Bro

> Полная EN-инструкция по auth, env и staging: **`docs/bookmarks-bro/AUTH-SETUP.md`**

Агент не может войти в ваш личный [Supabase Dashboard](https://supabase.com/dashboard) — redirect URL и ключи задаёте вы. Ниже шаги и официальные ссылки.

## 1. Узнайте EXTENSION_ID

1. Chrome → `chrome://extensions` → включите «Режим разработчика».
2. Найдите **Bookmarks Bro** и скопируйте **ID** (строка из 32 символов).

Redirect для OAuth:

```text
chrome-extension://<EXTENSION_ID>/oauth-callback.html
```

После каждой **перезагрузки распакованного** расширения ID может смениться — тогда обновите URL в Supabase.

## 2. Куда добавить Redirect URLs

В проекте Supabase:

1. **Authentication** → **URL Configuration** ([документация Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)).
2. В **Redirect URLs** добавьте строку целиком:  
   `chrome-extension://<ваш_ID>/oauth-callback.html`
3. При необходимости в **Site URL** укажите основной origin вашего приложения (на проде это не расширение, а ваш сайт/прокси — как настроено у вас для GoTrue).

## 3. Google

1. [Auth: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google).
2. **Authentication** → **Providers** → **Google** — включите провайдер, вставьте **Client ID** и **Client secret** из [Google Cloud Console](https://console.cloud.google.com/) (OAuth 2.0 Client, тип «Web application» или как рекомендует Supabase).
3. Убедитесь, что в Google Console в **Authorized redirect URIs** указан redirect Supabase вида  
   `https://<project-ref>.supabase.co/auth/v1/callback`  
   (точный URL см. подсказку в панели Supabase для провайдера).

## 4. Microsoft (Azure AD)

В Supabase провайдер называется **Azure** — в коде расширения используется `provider=azure`.

1. Документ: [Auth: Login with Azure (Microsoft)](https://supabase.com/docs/guides/auth/social-login/auth-azure).
2. **Authentication** → **Providers** → **Azure** — включите, заполните **Azure Client ID**, **Azure Secret**, **Azure Tenant URL** (часто `https://login.microsoftonline.com/<tenant-id>/v2.0`).
3. В Azure Portal для приложения зарегистрируйте redirect URI платформы: тот же `https://<project-ref>.supabase.co/auth/v1/callback`.

## 5. Локальный Supabase (опционально)

Если используете [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) и `supabase start`, Dashboard обычно на `http://127.0.0.1:54323`. Туда же добавьте расширенный redirect `chrome-extension://…/oauth-callback.html` в **Authentication → URL Configuration**. Для Google/Microsoft нужны отдельные OAuth-клиенты с redirect на **локальный** callback GoTrue из доков CLI.

## 6. Как расширение открывает вход

После включения провайдеров кнопки **Continue with Google / Microsoft** на странице `login.html` открывают **отдельное окно браузера** (`chrome.windows.create`, `type: "popup"`, `focused: true`), чтобы фокус перешёл на экран авторизации.

Для self-hosted изолированного Supabase через route `/bb-supabase`:

1. В `Bookmarks Bro Settings` задайте:
   - `API Base`: `https://swoop.autoro.tech`
   - `Supabase Auth Path`: `/bb-supabase`
2. OAuth в расширении пойдёт в `https://swoop.autoro.tech/bb-supabase/auth/v1/authorize?...`
