# Генерация JWT токена для Service Role (Self-hosted Supabase)

## Проблема

Для self-hosted Supabase нужен Service Role JWT токен, а не просто ключ. Токен должен быть в формате JWT (начинается с `eyJ...`).

## Текущая ситуация

В `/home/vladx/supabase-project/.env` найден ключ:
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

Это может быть не JWT токен, а просто ключ. Нужно проверить, является ли он правильным JWT токеном.

## Решение

### Вариант 1: Проверить, является ли текущий ключ JWT токеном

JWT токен должен:
- Начинаться с `eyJ...` (Base64 encoded JSON header)
- Содержать 3 части, разделенные точками
- Быть длинным (200-300+ символов)

### Вариант 2: Создать JWT токен через Supabase CLI

Если установлен Supabase CLI:

```bash
cd /home/vladx/supabase-project
supabase status
# Покажет service_role key
```

### Вариант 3: Создать JWT токен вручную (если нужно)

Для self-hosted Supabase Service Role JWT токен можно создать используя:

1. **JWT Secret** (из config.toml или переменных окружения)
2. **Payload** с ролью `service_role`

Но обычно для self-hosted Supabase используется просто ключ из `.env`, а не полноценный JWT токен.

### Вариант 4: Использовать anon key вместо service_role

Если service_role key не работает как JWT, можно использовать anon key с правильными заголовками.

## Проверка текущего ключа

Текущий ключ `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`:
- НЕ начинается с `eyJ...`
- Короткий (44 символа)
- Похож на Base64 encoded ключ, а не JWT токен

Возможно, для self-hosted Supabase это правильный формат, но нужно проверить документацию или использовать Supabase CLI для получения правильного токена.


