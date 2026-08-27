# Исправление SUPABASE_SERVICE_ROLE_KEY

## Проблема

Текущий ключ `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>` в `/home/vladx/autoro-blog/.env` вызывал ошибку "Invalid Compact JWS" при загрузке файлов.

## Решение

### Найден правильный ключ

В файле `/home/vladx/supabase-project/.env` найден Service Role Key:
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

### Обновление

1. **Обновлен ключ** в `/home/vladx/autoro-blog/.env`
2. **Перезапущен контейнер** блога

### Команды

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/autoro-blog
sed -i 's|SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>|' .env
docker-compose restart blog
```

## Следующие шаги

1. **Проверить загрузку файлов** в админ-панели
2. **Проверить логи** на наличие ошибок: `docker logs autoro-blog-nextjs`

## Примечание

Для self-hosted Supabase Service Role Key может быть коротким (не JWT токеном), так как формат может отличаться от облачной версии. Если новый ключ не работает, возможно нужно использовать другой метод аутентификации или сгенерировать JWT токен.

## Если проблема сохраняется

Если ошибка "Invalid Compact JWS" остается, возможно нужно:
1. Проверить формат ключа - возможно нужен JWT токен, а не Secret
2. Использовать anon key с токеном в заголовке вместо service_role key
3. Проверить настройки Supabase и способ создания клиента


