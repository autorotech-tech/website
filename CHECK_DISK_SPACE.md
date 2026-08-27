# Проверка использования дискового пространства

## Команды для проверки

### 1. Общее использование диска
```bash
df -h /
```

### 2. Что занимает больше всего места
```bash
du -sh /* 2>/dev/null | sort -hr | head -15
```

### 3. Docker использование
```bash
docker system df
```

### 4. Docker образы и контейнеры
```bash
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'
docker ps -a --format 'table {{.Names}}\t{{.Size}}'
```

### 5. Docker логи (частая причина)
```bash
# Размер всех логов контейнеров
find /var/lib/docker/containers -name '*.log' -exec du -ch {} + 2>/dev/null | tail -1

# Большие логи
find /var/lib/docker -name '*.log' -size +100M 2>/dev/null
```

### 6. Системные логи
```bash
journalctl --disk-usage
du -sh /var/log/* 2>/dev/null | sort -hr | head -10
```

### 7. Домашняя директория
```bash
du -sh /home/vladx/* 2>/dev/null | sort -hr | head -15
```

### 8. Docker volumes
```bash
docker volume ls
docker volume inspect $(docker volume ls -q) 2>/dev/null | grep -E 'Mountpoint|Name'
```

## Что можно удалить

### Docker логи (обычно самая большая проблема)
```bash
# Посмотреть размер
find /var/lib/docker/containers -name '*.log' -exec du -ch {} + | tail -1

# Очистить логи (требует sudo)
sudo truncate -s 0 /var/lib/docker/containers/*/*.log
# Или
sudo find /var/lib/docker/containers -name '*.log' -exec truncate -s 0 {} \;
```

### Docker system prune
```bash
# Удалить неиспользуемые образы, контейнеры, сети
docker system prune -a

# С volumes (осторожно!)
docker system prune -a --volumes
```

### Старые Docker образы
```bash
# Посмотреть образы
docker images

# Удалить конкретный образ
docker rmi <image_id>

# Удалить все неиспользуемые образы
docker image prune -a
```

### Системные логи
```bash
# Очистить journalctl логи
sudo journalctl --vacuum-time=7d  # Оставить последние 7 дней
sudo journalctl --vacuum-size=100M  # Оставить 100MB
```

### Временные файлы
```bash
# /tmp
sudo find /tmp -type f -atime +7 -delete
```

## Обычные причины роста диска

1. **Docker логи** - самая частая причина (могут занимать GB)
2. **Старые Docker образы** - неиспользуемые образы
3. **Journalctl логи** - системные логи
4. **Большие файлы в /tmp** - временные файлы
5. **Docker volumes** - данные контейнеров


