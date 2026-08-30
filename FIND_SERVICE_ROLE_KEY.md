# Поиск Service Role Key для Self-hosted Supabase

## Ситуация

Используется self-hosted Supabase на `api.autoro.tech`. Service Role Key нужно найти в конфигурации на сервере.

## Шаги для поиска

### 1. Проверить Supabase CLI (если установлен)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/supabase-project
supabase status
```

Команда `supabase status` покажет все ключи, включая Service Role Key.

### 2. Проверить config.toml

```bash
cd /home/vladx/supabase-project
cat supabase/config.toml | grep -A 10 '\[auth\]'
```

Service Role Key может быть указан там, или нужно будет создать его на основе JWT Secret.

### 3. Проверить переменные окружения контейнеров

```bash
# Kong (API Gateway) - часто содержит ключи
docker exec supabase-kong env | grep -i 'JWT\|SERVICE\|KEY'

# Auth сервис
docker exec supabase-auth env | grep -i 'JWT\|SECRET'
```

### 4. Проверить docker-compose файл

```bash
cd /home/vladx/supabase-project
cat docker-compose.supabase.yml | grep -A 5 -B 5 SERVICE_ROLE_KEY
```

### 5. Если ключ не найден - создать через Supabase CLI

```bash
cd /home/vladx/supabase-project

# Если Supabase CLI установлен
supabase gen keys

# Или запустить и посмотреть вывод
supabase start
# Service Role Key будет показан в выводе
```

## Где Service Role Key используется

В self-hosted Supabase Service Role Key - это JWT токен, который создается на основе:
- **JWT Secret** (из config.toml или переменных окружения)
- **Service Role** в payload токена

## Формат токена

Service Role Key должен быть JWT токеном вида:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJyZWYiOiJkZWZhdWx0In0.XXXXXXXXXXXXX...
```

Текущее значение в `.env` (`<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`) - это JWT Secret, а не сам токен.


