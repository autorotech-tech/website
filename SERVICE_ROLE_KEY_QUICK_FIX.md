# Быстрое обновление Service Role Key

## Проблема

Текущий `SUPABASE_SERVICE_ROLE_KEY` в файле `.env` содержит JWT Secret вместо Service Role JWT токена.

## Решение

### Шаг 1: Получить ключ из Supabase

1. Откройте: https://supabase.com/dashboard
2. Settings → API → service_role (secret)
3. Нажмите "Reveal" и скопируйте полный JWT токен (начинается с `eyJ...`)

### Шаг 2: Обновить на сервере

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/autoro-blog
nano .env
```

Найдите и замените:
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

На:
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...[ваш_JWT_токен_из_Dashboard]
```

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

### Шаг 3: Перезапустить

```bash
docker-compose down blog
docker-compose up -d blog
```

### Шаг 4: Проверить

```bash
docker logs autoro-blog-nextjs | tail -20
```

Если ошибок нет - загрузка файлов должна заработать!


