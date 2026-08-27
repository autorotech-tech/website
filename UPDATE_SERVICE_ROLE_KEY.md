# Обновление SUPABASE_SERVICE_ROLE_KEY

## Текущая ситуация

Antigravity обнаружил, что `SUPABASE_SERVICE_ROLE_KEY` содержит JWT Secret вместо Service Role JWT токена:
- **Текущее значение:** `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`
- **Проблема:** Это секрет для подписи JWT, а не сам Service Role токен
- **Результат:** Ошибка "Invalid Compact JWS" при загрузке файлов

## Что нужно сделать

1. **Получить правильный Service Role Key из Supabase Dashboard:**
   - Settings → API → service_role (secret)
   - Это должен быть длинный JWT токен (начинается с `eyJ...`)

2. **Обновить на сервере:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   cd /home/vladx/autoro-blog
   
   # Определить где хранится переменная
   grep -r SUPABASE_SERVICE_ROLE_KEY .env* docker-compose.yml
   
   # Обновить в соответствующем файле
   nano .env  # или docker-compose.yml
   
   # Перезапустить контейнер
   docker-compose down blog
   docker-compose up -d blog
   ```

3. **Проверить:**
   - Логи контейнера должны быть без ошибок
   - Загрузка файлов должна работать

## Подробная инструкция

См. файл `HOW_TO_GET_SUPABASE_SERVICE_ROLE_KEY.md`


