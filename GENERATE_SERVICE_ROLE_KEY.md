# Генерация Service Role Key для Self-hosted Supabase

## Проблема

Текущий `SUPABASE_SERVICE_ROLE_KEY` в `.env` содержит JWT Secret (`<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`), а не Service Role JWT токен.

Найден JWT Secret в контейнере: `GOTRUE_JWT_SECRET=3NpviugWXLuIjJJHRhNQVHOYWe4zgfYgkZf11MPVORw=`

## Решение: Использовать Supabase CLI

### Способ 1: Через `supabase status`

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/supabase-project
supabase status
```

Команда покажет все ключи, включая Service Role Key (anon key и service_role key).

### Способ 2: Через `supabase gen keys`

Если нужно сгенерировать новый ключ:

```bash
cd /home/vladx/supabase-project
supabase gen keys
```

### Способ 3: Проверить в .env или config.toml

```bash
cd /home/vladx/supabase-project
cat .env | grep SERVICE_ROLE_KEY
cat supabase/config.toml | grep -A 10 '\[auth\]'
```

## Формат Service Role Key

Для self-hosted Supabase Service Role Key - это JWT токен, который:
- Начинается с `eyJ...`
- Длинный (200-300+ символов)
- Содержит роль `service_role` в payload

Текущее значение `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>` - это JWT Secret, а не токен.

## После получения ключа

1. Скопируйте Service Role Key из вывода `supabase status`
2. Обновите в `/home/vladx/autoro-blog/.env`:
   ```bash
   nano /home/vladx/autoro-blog/.env
   # Замените SUPABASE_SERVICE_ROLE_KEY на новый токен
   ```
3. Перезапустите контейнер блога:
   ```bash
   cd /home/vladx/autoro-blog
   docker-compose down blog
   docker-compose up -d blog
   ```

## Альтернатива: Создать токен вручную

Если Supabase CLI не доступен, можно создать JWT токен вручную используя JWT Secret, но это сложнее. Лучше использовать `supabase status`.


