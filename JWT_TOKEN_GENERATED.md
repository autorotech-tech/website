# JWT токен для Service Role сгенерирован

## Что сделано

1. **Удалена директория** `/home/vladx/mcp-god-mode` (освобождено 2.4GB)
2. **Сгенерирован JWT токен** для Service Role используя JWT Secret из контейнера auth

## Генерация JWT токена

Для self-hosted Supabase JWT токен создается используя:

- **JWT Secret:** `3NpviugWXLuIjJJHRhNQVHOYWe4zgfYgkZf11MPVORw=`
- **Payload:**
  ```json
  {
    "iss": "supabase",
    "aud": "authenticated",
    "role": "service_role",
    "iat": <timestamp>,
    "exp": <timestamp + 1 year>
  }
  ```
- **Algorithm:** HS256

## Обновление Service Role Key

JWT токен обновлен в `/home/vladx/autoro-blog/.env`:
- Старое значение: `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`
- Новое значение: JWT токен (начинается с `eyJ...`)

## Проверка

Контейнер блога перезапущен. Теперь нужно проверить:
1. Загрузку файлов в админ-панели
2. Логи на наличие ошибок

## Формат JWT токена

Правильный JWT токен для Service Role:
- Начинается с `eyJ...`
- Содержит 3 части, разделенные точками
- Длинный (200-300+ символов)
- Содержит роль `service_role` в payload

## Если нужно перегенерировать токен

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /tmp
python3 << 'EOF'
import jwt
import time

jwt_secret = '3NpviugWXLuIjJJHRhNQVHOYWe4zgfYgkZf11MPVORw='
now = int(time.time())
payload = {
    'iss': 'supabase',
    'aud': 'authenticated',
    'role': 'service_role',
    'iat': now,
    'exp': now + 86400 * 365  # 1 год
}
token = jwt.encode(payload, jwt_secret, algorithm='HS256')
print(token)
EOF
```

Скопируйте токен и обновите в `.env` файле.


