# Шаги для получения и обновления Service Role Key

## Где находится текущий ключ

**Файл:** `/home/vladx/autoro-blog/.env`
**Текущее значение:** `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`
**Проблема:** Это JWT Secret (секрет для подписи), а не Service Role JWT токен

## Шаги

### 1. Получить правильный Service Role Key

1. **Откройте Supabase Dashboard:**
   - Перейдите на https://supabase.com/dashboard
   - Войдите в аккаунт
   - Выберите проект **Autoro.tech** (или соответствующий проект)

2. **Перейдите в настройки API:**
   - В левом меню: **Settings** → **API**
   - Или прямая ссылка: `https://supabase.com/dashboard/project/[PROJECT_ID]/settings/api`

3. **Найдите Service Role Key:**
   - В разделе **Project API keys** найдите секцию **`service_role`** 
   - Нажмите на кнопку **"Reveal"** (раскрыть) или значок глаза 👁️
   - Это должен быть длинный JWT токен, начинающийся с `eyJ...`
   - ⚠️ **Скопируйте полностью весь токен** (обычно 200-300+ символов)

### 2. Обновить ключ на сервере

```bash
# Подключиться к серверу
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Перейти в директорию проекта
cd /home/vladx/autoro-blog

# Открыть файл .env для редактирования
nano .env
```

**Найти строку:**
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

**Заменить на:**
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...[ваш_полный_JWT_токен_из_Dashboard]
```

**Сохранить:**
- `Ctrl+O` (сохранить)
- `Enter` (подтвердить)
- `Ctrl+X` (выйти)

### 3. Перезапустить контейнер

```bash
cd /home/vladx/autoro-blog
docker-compose down blog
docker-compose up -d blog

# Проверить логи
docker logs -f autoro-blog-nextjs
```

### 4. Проверить работу

1. Попробуйте загрузить файл в админ-панели
2. Проверьте логи на наличие ошибок
3. Если все работает - ошибка "Invalid Compact JWS" должна исчезнуть

## Как отличить правильный ключ

✅ **Правильный Service Role Key:**
- Начинается с `eyJ` (Base64 encoded JSON header)
- Длинный (200-300+ символов)
- Это полный JWT токен (3 части, разделенные точками)
- Пример: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dG9yb3RlY2giLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjE2MjM5MDIyfQ.xxxxxxxxxxxxx...`

❌ **Неправильный ключ (JWT Secret):**
- Короткий (32-64 символа)
- Используется для подписи JWT, а не сам JWT
- Текущее значение: `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`

## Безопасность

⚠️ **Важно:** Service Role Key имеет полный доступ к базе данных, обходя все RLS политики. Не публикуйте его и не коммитьте в репозиторий!


