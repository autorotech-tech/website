# Запуск блога контейнера

## Проблема:
- Контейнер `autoro-blog-nextjs` не найден или не запущен
- Блог не отвечает на порту 3002

## Решение:

### 1. Проверить все контейнеры:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Все контейнеры (включая остановленные)
docker ps -a | grep blog

# Все контейнеры с nextjs
docker ps -a | grep nextjs
```

### 2. Проверить docker-compose.yml:

```bash
cd /home/vladx/autoro-blog
cat docker-compose.yml | grep -A 10 "services:"
```

### 3. Запустить блог:

```bash
cd /home/vladx/autoro-blog

# Если есть docker-compose.yml
docker-compose up -d

# Или запустить конкретный сервис
docker-compose up -d <имя_сервиса>

# Проверить что запустился
docker ps | grep blog
```

### 4. Если контейнер не создан - создать и запустить:

```bash
cd /home/vladx/autoro-blog

# Проверить есть ли .env файл
ls -la .env

# Пересобрать и запустить
docker-compose up -d --build

# Проверить логи
docker-compose logs -f
```

