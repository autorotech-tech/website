# Как получить правильный Supabase Service Role Key

## Проблема

Текущий `SUPABASE_SERVICE_ROLE_KEY` на сервере содержит JWT Secret (секрет для подписи), а не Service Role JWT токен. Это вызывает ошибку "Invalid Compact JWS" при загрузке файлов.

## Где взять правильный Service Role Key

### Вариант 1: Supabase Dashboard (рекомендуется)

1. **Войдите в Supabase Dashboard:**
   - Откройте https://supabase.com/dashboard
   - Выберите проект Autoro.tech

2. **Перейдите в настройки API:**
   - В левом меню: **Settings** → **API**
   - Или прямая ссылка: `https://supabase.com/dashboard/project/[PROJECT_ID]/settings/api`

3. **Найдите Service Role Key:**
   - В разделе **Project API keys** найдите **`service_role`** (secret)
   - Это длинный JWT токен, который начинается с `eyJ...`
   - ⚠️ **Внимание:** Это секретный ключ! Не публикуйте его.

4. **Скопируйте ключ:**
   - Нажмите на кнопку **"Reveal"** или **"Copy"** рядом с `service_role` key
   - Это будет длинная строка, например: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dG9yb3RlY2giLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjE2MjM5MDIyfQ...`

### Вариант 2: Supabase CLI

Если у вас установлен Supabase CLI:

```bash
supabase status
# Или
supabase secrets list
```

Но обычно Service Role Key нужно получать из Dashboard.

## Как обновить ключ на сервере

### Шаг 1: Определить где хранятся переменные окружения

Проверьте, где определены переменные:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/autoro-blog

# Проверьте файлы
ls -la .env* docker-compose.yml

# Посмотрите содержимое
cat docker-compose.yml | grep SUPABASE_SERVICE_ROLE_KEY
cat .env 2>/dev/null | grep SUPABASE_SERVICE_ROLE_KEY
```

### Шаг 2: Обновить ключ

**Если переменная в docker-compose.yml:**

```bash
nano /home/vladx/autoro-blog/docker-compose.yml
```

Найдите строку:
```yaml
- SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

Замените на:
```yaml
- SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...[ваш_полный_JWT_токен]
```

**Если переменная в .env файле:**

```bash
nano /home/vladx/autoro-blog/.env
```

Обновите строку:
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...[ваш_полный_JWT_токен]
```

### Шаг 3: Перезапустить контейнер

```bash
cd /home/vladx/autoro-blog
docker-compose down blog
docker-compose up -d blog

# Проверить логи
docker logs -f autoro-blog-nextjs
```

## Проверка правильности ключа

Правильный Service Role Key:
- ✅ Начинается с `eyJ` (Base64 encoded JSON)
- ✅ Длинный (обычно 200+ символов)
- ✅ Это JWT токен (3 части, разделенные точками)

Неправильный ключ (JWT Secret):
- ❌ Короткий (обычно 32-64 символа)
- ❌ Используется для подписи JWT, а не сам JWT
- ❌ Пример: `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`

## Важные замечания

1. **Безопасность:** Service Role Key имеет полный доступ к базе данных, обходя все RLS политики. Храните его в секрете!

2. **JWT Secret vs Service Role Key:**
   - **JWT Secret** - используется Supabase для подписи токенов
   - **Service Role Key** - сам JWT токен с правами service_role

3. **После обновления:** Перезапустите контейнер, чтобы применить новые переменные окружения.

## Следующие шаги

После обновления ключа:
1. Проверьте логи контейнера на наличие ошибок
2. Попробуйте загрузить файл в админ-панели
3. Проверьте, что список постов загружается корректно


