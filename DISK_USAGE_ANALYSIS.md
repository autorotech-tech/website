# Анализ использования диска и рекомендации по очистке

## 🔍 Команды для проверки:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# 1. Общее использование диска
df -h

# 2. Самые большие директории в /home/vladx
du -h --max-depth=1 /home/vladx 2>/dev/null | sort -hr | head -20

# 3. Самые большие файлы (>100MB)
find /home/vladx -type f -size +100M -exec ls -lh {} \; 2>/dev/null | awk '{print $5, $9}' | sort -hr

# 4. Docker использование
docker system df

# 5. Docker образы (размер)
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | sort -k3 -hr

# 6. Остановленные контейнеры
docker ps -a --filter "status=exited"

# 7. Неиспользуемые образы (dangling)
docker images --filter "dangling=true"

# 8. Docker build cache
docker builder du

# 9. Логи Docker контейнеров
du -sh /var/lib/docker/containers/*/*-json.log 2>/dev/null | sort -hr | head -10

# 10. Старые логи системы
sudo journalctl --disk-usage
```

## 🗑️ Что можно удалить:

### 1. Docker (обычно занимает больше всего):

```bash
# Остановленные контейнеры
docker container prune -f

# Неиспользуемые образы
docker image prune -a -f

# Build cache
docker builder prune -a -f

# Неиспользуемые volumes
docker volume prune -f

# Всё сразу (кроме используемых volumes)
docker system prune -a -f --volumes
```

### 2. Старые логи:

```bash
# Очистить логи journald (оставит последние 7 дней)
sudo journalctl --vacuum-time=7d

# Или ограничить размер
sudo journalctl --vacuum-size=100M

# Docker логи (очистить логи остановленных контейнеров)
sudo truncate -s 0 /var/lib/docker/containers/*/*-json.log
```

### 3. Кэш пакетов (если используется apt):

```bash
sudo apt-get clean
sudo apt-get autoremove -y
```

### 4. WordPress файлы (если еще остались):

```bash
# Проверить что осталось
find /home/vladx -name "*wordpress*" -o -name "*wp-*" 2>/dev/null

# Удалить если найдено
sudo rm -rf /home/vladx/projects/pquoc.com/wordpress
sudo rm -rf /home/vladx/projects/autoro.tech/wordpress
```

### 5. Временные файлы:

```bash
# /tmp
sudo find /tmp -type f -atime +7 -delete

# Старые core dumps
sudo find /var/crash -type f -delete

# Старые бэкапы (если есть)
find /home/vladx -name "*.bak" -o -name "*.backup" -o -name "*~" 2>/dev/null
```

## 📊 Скрипт для автоматической проверки:

```bash
cat > /tmp/check_disk.sh << 'EOF'
#!/bin/bash
echo "=== Использование диска ==="
df -h

echo ""
echo "=== Топ 10 самых больших директорий ==="
du -h --max-depth=1 /home/vladx 2>/dev/null | sort -hr | head -11

echo ""
echo "=== Docker использование ==="
docker system df

echo ""
echo "=== Остановленные контейнеры ==="
docker ps -a --filter "status=exited" | wc -l

echo ""
echo "=== Неиспользуемые образы ==="
docker images --filter "dangling=true" | wc -l

echo ""
echo "=== Размер логов Docker ==="
du -sh /var/lib/docker/containers/*/*-json.log 2>/dev/null | awk '{s+=$1} END {print s}'
EOF

chmod +x /tmp/check_disk.sh
/tmp/check_disk.sh
```

## 🎯 Рекомендуемый порядок очистки:

1. **Сначала проверить:**
   ```bash
   df -h
   docker system df
   ```

2. **Безопасная очистка Docker:**
   ```bash
   docker system prune -f  # Безопасно - только остановленные контейнеры
   docker builder prune -f  # Build cache
   ```

3. **Агрессивная очистка Docker (если нужно больше места):**
   ```bash
   docker system prune -a -f  # Удалит неиспользуемые образы
   docker builder prune -a -f  # Весь build cache
   ```

4. **Очистка логов:**
   ```bash
   sudo journalctl --vacuum-time=7d
   sudo find /var/lib/docker/containers -name "*.log" -size +100M -exec truncate -s 0 {} \;
   ```

5. **Проверить результат:**
   ```bash
   df -h
   ```

