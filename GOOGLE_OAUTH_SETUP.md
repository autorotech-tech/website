# Настройка Google OAuth для Supabase

## Проблема
Кнопка "Continue with Google" не работает при входе в админку.

## Причины
1. **Не настроен Google OAuth в Supabase Dashboard**
2. **Неправильный Redirect URI в Google Cloud Console**
3. **Неправильный Supabase URL (используется локальный вместо облачного)**

## Решение

### 1. Настройка Google OAuth в Supabase

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard)
2. Выберите ваш проект
3. Перейдите в **Authentication** → **Providers**
4. Найдите **Google** и включите его
5. Вам понадобятся:
   - **Client ID** (из Google Cloud Console)
   - **Client Secret** (из Google Cloud Console)

### 2. Создание OAuth приложения в Google Cloud Console

1. Откройте [Google Cloud Console](https://console.cloud.google.com)
2. Выберите ваш проект или создайте новый
3. Перейдите в **APIs & Services** → **Credentials**
4. Нажмите **Create Credentials** → **OAuth client ID**
5. Выберите **Web application**
6. Укажите:
   - **Name**: `Autoro Dashboard`
   - **Authorized JavaScript origins**: 
     - `https://swoop.autoro.tech`
     - `https://api.autoro.tech` (если используется облачный Supabase)
   - **Authorized redirect URIs**:
     - `https://YOUR_SUPABASE_PROJECT.supabase.co/auth/v1/callback`
     - (Найдите точный URL в Supabase Dashboard → Authentication → URL Configuration)

### 3. Проверка переменных окружения

Убедитесь, что в `.env` или `docker-compose.yml` указан **облачный** Supabase URL:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

**НЕ используйте:**
- `http://localhost:54321`
- `http://46.250.228.229:54321`

### 4. Проверка настроек в Supabase

В Supabase Dashboard → Authentication → URL Configuration:

- **Site URL**: `https://swoop.autoro.tech`
- **Redirect URLs**: Добавьте `https://swoop.autoro.tech/**`

### 5. Проверка после настройки

1. Перезапустите админку:
   ```bash
   cd /home/vladx/autoro-dashboard
   docker-compose restart autoro-frontend
   ```

2. Откройте консоль браузера (F12)
3. Нажмите "Continue with Google"
4. Проверьте ошибки в консоли

## Типичные ошибки

### Ошибка: "redirect_uri_mismatch"
**Решение**: Проверьте Redirect URI в Google Cloud Console - должен точно совпадать с URL из Supabase

### Ошибка: "invalid_client"
**Решение**: Проверьте Client ID и Secret в Supabase Dashboard

### Ошибка: "couldn't start a new transaction"
**Решение**: Используйте облачный Supabase, а не локальный

### Кнопка не реагирует
**Решение**: 
- Проверьте консоль браузера на ошибки
- Убедитесь, что Supabase URL настроен правильно
- Проверьте, что Google OAuth включен в Supabase Dashboard

## Полезные ссылки

- [Supabase Google OAuth Guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google OAuth Setup](https://developers.google.com/identity/protocols/oauth2/web-server)

