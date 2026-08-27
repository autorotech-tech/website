# Перезапуск контейнера блога

## Проблема:
`docker-compose restart autoro-blog-nextjs` выдает ошибку `no such service: autoro-blog-nextjs`

## Решение:

`autoro-blog-nextjs` - это **container_name**, а не имя сервиса в docker-compose.yml.

### Вариант 1: Использовать docker restart напрямую

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Перезапустить контейнер напрямую
docker restart autoro-blog-nextjs

# Проверить логи
docker logs autoro-blog-nextjs --tail 50
```

### Вариант 2: Проверить имя сервиса в docker-compose.yml

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

cd /home/vladx/autoro-blog
cat docker-compose.yml | grep -A 10 "services:"

# Затем использовать правильное имя сервиса:
docker-compose restart <имя_сервиса>
```

### Вариант 3: Пересобрать контейнер (если нужно применить изменения)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

cd /home/vladx/autoro-blog
docker-compose down
docker-compose up -d --build
```

## Проверка что файлы скопированы:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверить файлы
ls -la /home/vladx/autoro-blog/app/api/admin/posts/route.ts
ls -la /home/vladx/autoro-blog/lib/supabase/api-client.ts
ls -la /home/vladx/autoro-blog/lib/cors.ts

# Проверить что контейнер запущен
docker ps | grep blog
```

