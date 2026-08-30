# Service Role Key обновлен

## Что сделано

1. **Найден правильный Service Role Key** в `/home/vladx/supabase-project/.env`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
   ```

2. **Обновлен ключ** в `/home/vladx/autoro-blog/.env`:
   - Старое значение: `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`
   - Новое значение: `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>`

3. **Перезапущен контейнер** блога для применения изменений

4. **Создана резервная копия** `.env` файла

## Проверка

Теперь нужно проверить:
1. Логи контейнера на наличие ошибок
2. Загрузку файлов в админ-панели
3. Работу API endpoints

## Примечание

Для self-hosted Supabase Service Role Key может быть коротким (не JWT токеном), так как формат ключей может отличаться от облачной версии. Если новый ключ не работает, возможно нужно сгенерировать JWT токен через Supabase CLI или использовать другой метод аутентификации.

## Если проблема сохраняется

1. Проверьте логи: `docker logs autoro-blog-nextjs`
2. Попробуйте получить ключ через Supabase CLI (если установлен)
3. Проверьте, используется ли правильный формат ключа для self-hosted Supabase


