# Получение Service Role Key для Self-hosted Supabase

## Текущая ситуация

Используется **self-hosted Supabase** на `api.autoro.tech`. Service Role Key нужно найти в конфигурационных файлах Supabase на сервере.

## Где искать Service Role Key

### Вариант 1: В docker-compose файле Supabase

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/supabase-project
cat docker-compose.supabase.yml | grep -A 5 -B 5 SERVICE_ROLE
```

### Вариант 2: В config.toml файле

```bash
cd /home/vladx/supabase-project
find . -name config.toml
cat ./supabase/config.toml | grep -A 5 -B 5 service_role
```

Service Role Key обычно находится в секции `[auth]` или `[api]` как `service_role_key`.

### Вариант 3: В переменных окружения контейнеров

```bash
# Проверить Kong (API Gateway)
docker exec supabase-kong env | grep SERVICE_ROLE

# Проверить Auth
docker exec supabase-auth env | grep -i JWT

# Проверить Studio (если есть доступ)
docker exec supabase-studio env | grep SERVICE_ROLE
```

### Вариант 4: Использовать Supabase CLI

Если установлен Supabase CLI на сервере:

```bash
cd /home/vladx/supabase-project
supabase status
# Покажет информацию о проекте, включая ключи

# Или
supabase secrets list
```

### Вариант 5: Генерация нового ключа

Если ключ потерян, можно сгенерировать новый через Supabase CLI:

```bash
cd /home/vladx/supabase-project
supabase secrets set SERVICE_ROLE_KEY=<новый_ключ>
```

Но это требует знания JWT Secret для подписи токенов.

## Формат Service Role Key

Для self-hosted Supabase Service Role Key - это JWT токен, который:

1. **Создается на основе JWT Secret:**
   - JWT Secret находится в `config.toml` в секции `[auth]` как `jwt_secret`
   - Или в переменных окружения как `JWT_SECRET`

2. **Структура JWT:**
   - Header: `{"alg":"HS256","typ":"JWT"}`
   - Payload: `{"role":"service_role","iss":"supabase","ref":"default"}`
   - Signature: подписан JWT Secret

3. **Можно создать через Supabase CLI:**
   ```bash
   supabase gen keys
   # Или
   supabase start
   # Service Role Key будет в выводе
   ```

## Быстрое решение

Если нужно быстро получить Service Role Key:

1. **Проверьте статус Supabase:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   cd /home/vladx/supabase-project
   supabase status
   ```

2. **Если Supabase CLI не установлен, найдите в конфигурации:**
   ```bash
   find /home/vladx/supabase-project -type f \( -name '*.toml' -o -name '*.env*' -o -name 'docker-compose*.yml' \) -exec grep -l 'service_role\|SERVICE_ROLE\|jwt_secret\|JWT_SECRET' {} \;
   ```

3. **Проверьте логи при старте Supabase:**
   ```bash
   docker logs supabase-kong | grep -i service_role | head -5
   docker logs supabase-auth | grep -i 'key\|secret' | head -10
   ```

## Альтернативный способ: Получить из .env файла проекта

Если Service Role Key был ранее сохранен в каком-то .env файле:

```bash
find /home/vladx -name '.env*' -type f -exec grep -l 'SERVICE_ROLE_KEY' {} \;
```

## Следующие шаги

После того как найдете правильный Service Role Key:

1. Обновите в `/home/vladx/autoro-blog/.env`
2. Перезапустите контейнер блога
3. Проверьте загрузку файлов


