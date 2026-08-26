# Как исправить SUPABASE_SERVICE_ROLE_KEY

## Проблема

Текущий ключ `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>` - это JWT Secret, а не Service Role JWT токен.

## Решение для Self-hosted Supabase

### Шаг 1: Получить Service Role Key через Supabase CLI

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/supabase-project
supabase status
```

**Команда `supabase status` покажет:**
- API URL
- anon key
- **service_role key** ← это то, что нужно!

Скопируйте `service_role key` (это длинный JWT токен, начинается с `eyJ...`).

### Шаг 2: Обновить в .env файле блога

```bash
cd /home/vladx/autoro-blog
nano .env
```

**Найдите строку:**
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

**Замените на:**
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...[ваш_service_role_key_из_supabase_status]
```

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

### Шаг 3: Перезапустить контейнер

```bash
cd /home/vladx/autoro-blog
docker-compose down blog
docker-compose up -d blog

# Проверить логи
docker logs autoro-blog-nextjs | tail -20
```

### Шаг 4: Проверить работу

Попробуйте загрузить файл в админ-панели - ошибка "Invalid Compact JWS" должна исчезнуть.

## Если Supabase CLI не установлен

Проверьте конфигурационные файлы:

```bash
cd /home/vladx/supabase-project
cat .env | grep SERVICE_ROLE_KEY
cat supabase/config.toml | grep -A 20 '\[auth\]'
```

Service Role Key может быть там сохранен.


