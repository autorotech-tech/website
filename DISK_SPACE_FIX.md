# Исправление нехватки места на диске

## Проблема

Диск заполнен на 100% (69G/72G использовано, 0 доступно).

## Найденные проблемы

### 1. Docker Build Cache - 17.21GB ⚠️ ГЛАВНАЯ ПРОБЛЕМА
Это основная причина нехватки места!

### 2. Docker образы
- Неиспользуемые образы: 788.5MB
- Несколько дублирующихся образов (tagged as `<none>`)

### 3. Docker Volumes
- Неиспользуемые volumes: 920.4MB

### 4. Домашняя директория
- `/home/vladx/projects` - 4.4GB
- `/home/vladx/supabase` - 2.8GB
- `/home/vladx/MCP-God-Mode` - 2.4GB
- `/home/vladx/mcp-god-mode` - 2.4GB (возможно дубликат?)
- `/home/vladx/autoro-blog` - 713MB

## Решение

### Шаг 1: Очистить Docker Build Cache (освободит ~17GB)

```bash
docker builder prune -af
```

### Шаг 2: Удалить неиспользуемые образы (освободит ~788MB)

```bash
docker image prune -af
```

### Шаг 3: Удалить неиспользуемые volumes (освободит ~920MB)

⚠️ Внимание: Сначала проверьте, какие volumes используются!

```bash
# Посмотреть используемые volumes
docker ps -a --format '{{.Names}}' | xargs -I {} docker inspect {} --format '{{range .Mounts}}{{.Name}} {{end}}' | tr ' ' '\n' | sort -u

# Удалить неиспользуемые volumes
docker volume prune -f
```

### Шаг 4: Проверить дубликаты директорий

```bash
# Проверить, не дубликат ли это
ls -la /home/vladx/ | grep -i mcp
du -sh /home/vladx/MCP-God-Mode /home/vladx/mcp-god-mode

# Если это дубликат, можно удалить один
```

## Результат

После очистки Build Cache должно освободиться ~17GB места, что решит проблему нехватки диска.

## Мониторинг

```bash
# Проверить использование диска
df -h /

# Проверить Docker использование
docker system df
```

## Профилактика

Чтобы избежать проблемы в будущем:

1. **Регулярно очищать Build Cache:**
   ```bash
   docker builder prune -f
   ```

2. **Автоматическая очистка (можно добавить в crontab):**
   ```bash
   # Раз в неделю очищать build cache
   0 2 * * 0 docker builder prune -f
   ```

3. **Ограничить размер логов Docker** (в `/etc/docker/daemon.json`):
   ```json
   {
     "log-driver": "json-file",
     "log-opts": {
       "max-size": "10m",
       "max-file": "3"
     }
   }
   ```


