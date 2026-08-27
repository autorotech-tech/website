# 🚨 КРИТИЧЕСКАЯ ПРОБЛЕМА: Диск заполнен на 100%

## Проблема
Диск заполнен на **100%** (69GB из 72GB). Это причина всех проблем:
- Supabase база данных не может запуститься
- Studio не может загрузить таблицы
- Нельзя сохранять файлы

## Решение: Очистка места

### 1. Очистить Docker Build Cache (7.6GB можно освободить)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Очистить build cache
docker builder prune -a -f

# Это освободит ~7.6GB
```

### 2. Очистить неиспользуемые Docker образы (669MB)

```bash
# Посмотреть неиспользуемые образы
docker images --filter "dangling=true"

# Удалить неиспользуемые образы
docker image prune -a -f
```

### 3. Очистить неиспользуемые volumes (742MB)

```bash
# Посмотреть неиспользуемые volumes
docker volume ls -f dangling=true

# Удалить неиспользуемые volumes (ОСТОРОЖНО!)
docker volume prune -f
```

### 4. Удалить старые логи Docker

```bash
# Найти большие логи
sudo find /var/lib/docker/containers/ -name "*-json.log" -size +100M

# Очистить логи
sudo truncate -s 0 /var/lib/docker/containers/*/*-json.log
```

### 5. Полная очистка Docker (если ничего не помогает)

```bash
# ОСТОРОЖНО! Удалит все неиспользуемые ресурсы
docker system prune -a --volumes -f
```

### 6. Найти большие файлы на сервере

```bash
# Найти самые большие директории
sudo du -h --max-depth=1 / | sort -hr | head -20

# Найти большие файлы
sudo find / -type f -size +1G -exec ls -lh {} \; 2>/dev/null | head -20
```

## После освобождения места

### 1. Перезапустить Supabase базу данных

```bash
# Остановить контейнер
docker stop supabase-db supabase-db-pquoc

# Подождать
sleep 5

# Запустить
docker start supabase-db supabase-db-pquoc

# Проверить статус
docker ps | grep supabase-db
```

### 2. Перезапустить мета-сервис и Studio

```bash
docker restart supabase-meta supabase-meta-pquoc
docker restart supabase-studio-pquoc
```

### 3. Проверить что база работает

```bash
# Проверить логи
docker logs supabase-db --tail 20

# Должно быть "database system is ready to accept connections"
```

## Быстрое решение (освободит ~8GB)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Очистить build cache (самый большой объем)
docker builder prune -a -f

# Очистить неиспользуемые образы и volumes
docker system prune -a -f

# Перезапустить базу данных
docker restart supabase-db supabase-db-pquoc

# Подождать 10 секунд
sleep 10

# Проверить статус
docker ps | grep supabase-db
```

## Предотвращение в будущем

1. Настроить автоматическую очистку Docker:
   ```bash
   # Добавить в crontab
   docker system prune -a -f --filter "until=168h"  # Удалять старше 7 дней
   ```

2. Мониторинг диска:
   ```bash
   # Установить alert при заполнении > 80%
   ```

3. Очистка логов:
   ```bash
   # Настроить ротацию логов Docker
   ```

## После очистки

1. Проверить свободное место: `df -h /`
2. Перезапустить Supabase: `docker restart supabase-db`
3. Открыть Studio: http://127.0.0.1:3100
4. Проверить что таблицы загружаются

