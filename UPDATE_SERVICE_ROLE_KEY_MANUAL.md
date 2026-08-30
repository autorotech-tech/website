# Обновление Service Role Key (ручная инструкция)

## Проблема

Ключ `SUPABASE_SERVICE_ROLE_KEY` нужно обновить, но нет места на диске для автоматического обновления.

## Найден правильный ключ

В файле `/home/vladx/supabase-project/.env` найден Service Role Key:
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

## Ручное обновление

### Шаг 1: Подключиться к серверу

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

### Шаг 2: Обновить .env файл

```bash
cd /home/vladx/autoro-blog
nano .env
```

Найдите строку:
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

Замените на:
```
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>
```

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

### Шаг 3: Перезапустить контейнер

```bash
docker-compose restart blog
```

### Шаг 4: Проверить

```bash
docker logs autoro-blog-nextjs | tail -20
```

Попробуйте загрузить файл в админ-панели.

## Альтернативный способ (если nano не работает из-за места)

Можно использовать `echo` для добавления строки:

```bash
cd /home/vladx/autoro-blog
# Создать новый файл без старой строки
grep -v 'SUPABASE_SERVICE_ROLE_KEY' .env > .env.new
# Добавить новую строку
echo 'SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>' >> .env.new
# Заменить файл
mv .env.new .env
```

## Примечание

Для self-hosted Supabase Service Role Key может быть коротким (не JWT токеном). Если новый ключ не работает, возможно нужен другой подход к аутентификации.


