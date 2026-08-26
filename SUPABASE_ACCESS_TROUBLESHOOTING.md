# Устранение проблем с доступом к Supabase

## Проблема

Ошибка при доступе к Supabase Studio: `https://api.autoro.tech/project/default/editor`
- "Failed to load schemas"
- "Failed to retrieve tables"

## Возможные причины

### 1. Неправильный URL для Supabase Studio

`https://api.autoro.tech/project/default/editor` - это не стандартный URL для Supabase Studio.

**Стандартные URL для Supabase:**
- **Supabase Dashboard:** `https://supabase.com/dashboard/project/[PROJECT_REF]`
- **Supabase Studio (self-hosted):** `https://[your-domain]/studio` или `https://[your-domain]/project/default/studio`
- **API:** `https://[PROJECT_REF].supabase.co` или `https://api.autoro.tech` (если self-hosted)

### 2. Self-hosted Supabase

Если используется self-hosted Supabase на `api.autoro.tech`, то:
- Studio может быть доступен по другому пути
- Service Role Key может храниться в конфигурационных файлах на сервере

## Решения

### Вариант 1: Облачный Supabase (Supabase.com)

Если используется облачный Supabase:

1. **Определите PROJECT_REF:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   cd /home/vladx/autoro-blog
   cat .env | grep NEXT_PUBLIC_SUPABASE_URL
   ```

2. **Если URL вида:** `https://[PROJECT_REF].supabase.co`
   - Dashboard: `https://supabase.com/dashboard/project/[PROJECT_REF]`
   - Settings → API → service_role key

### Вариант 2: Self-hosted Supabase

Если используется self-hosted Supabase:

1. **Проверьте конфигурацию Supabase:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   
   # Найдите docker-compose или конфигурацию Supabase
   find /home/vladx -name '*supabase*' -type d
   find /home/vladx -name 'docker-compose*.yml' | xargs grep -l supabase
   ```

2. **Service Role Key в self-hosted Supabase:**
   - Обычно находится в `.env` файле Supabase
   - Или в `config.toml` файле
   - Или можно сгенерировать через Supabase CLI

3. **Доступ к Studio:**
   - Попробуйте: `https://api.autoro.tech/studio`
   - Или: `https://api.autoro.tech/project/default/studio`
   - Или: через SSH туннель к порту Studio

### Вариант 3: Получить Service Role Key через API

Если есть доступ к API, можно попробовать получить через переменные окружения контейнера:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Если Supabase в Docker
docker exec supabase_* env | grep SERVICE_ROLE_KEY

# Или проверьте файлы конфигурации
cat /home/vladx/supabase/.env 2>/dev/null | grep SERVICE_ROLE_KEY
```

### Вариант 4: Использовать Supabase CLI

Если установлен Supabase CLI:

```bash
supabase status
# Покажет информацию о проекте и ключах
```

## Следующие шаги

1. **Определите тип установки Supabase:**
   - Проверьте URL в `.env`: если `*.supabase.co` - облачный, если `api.autoro.tech` - self-hosted

2. **Найдите конфигурацию:**
   - Для self-hosted проверьте файлы конфигурации на сервере
   - Для облачного используйте Dashboard на supabase.com

3. **Получите Service Role Key:**
   - Из Dashboard (если облачный)
   - Из конфигурации (если self-hosted)


