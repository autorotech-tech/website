# Быстрый запуск блога

## Проблема:
- Контейнер `autoro-blog-nextjs` не найден
- Блог не отвечает

## Команды для выполнения:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

cd /home/vladx/autoro-blog

# 1. Проверить все контейнеры
docker ps -a | grep -E 'blog|nextjs'

# 2. Проверить docker-compose.yml
cat docker-compose.yml | head -30

# 3. Запустить блог
docker-compose up -d

# 4. Проверить что запустился
docker ps | grep blog

# 5. Проверить логи
docker-compose logs --tail 50

# 6. Проверить что блог отвечает
curl -I http://localhost:3002/api/admin/posts
```

## Если docker-compose не работает:

```bash
# Проверить имя контейнера
docker ps -a

# Запустить по имени (если нашли)
docker start <container_name>

# Или найти правильное имя сервиса
docker-compose ps
```

