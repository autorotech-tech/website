#!/bin/bash
set -euo pipefail

# Скрипт очистки проекта adesso.us и освобождения дискового пространства на сервере 46.250.228.229
# Запуск на сервере (или через SSH): bash /path/to/cleanup-adesso-and-disk.sh

echo "=========================================="
echo "1. Текущее использование дискового пространства:"
echo "=========================================="
df -h /
echo ""

echo "=========================================="
echo "2. Остановка и удаление контейнеров adesso.us:"
echo "=========================================="
# Если контейнеры запущены в отдельной директории projects/adesso.us
if [ -d "/home/vladx/projects/adesso.us" ]; then
    echo "Останавливаем docker-compose в /home/vladx/projects/adesso.us..."
    (cd /home/vladx/projects/adesso.us && docker-compose down -v 2>/dev/null || true)
fi

# Остановка и удаление по именам контейнеров
echo "Останавливаем контейнеры adesso-wordpress, adesso-db..."
docker stop adesso-wordpress adesso-db 2>/dev/null || true
docker rm -f adesso-wordpress adesso-db 2>/dev/null || true

# Удаление любого контейнера, содержащего adesso в имени
AD_CONTAINERS=$(docker ps -a --filter "name=adesso" -q 2>/dev/null || true)
if [ -n "$AD_CONTAINERS" ]; then
    echo "Удаляем найденные adesso контейнеры: $AD_CONTAINERS"
    docker rm -f $AD_CONTAINERS 2>/dev/null || true
fi

echo "=========================================="
echo "3. Удаление docker volume и сетей adesso.us:"
echo "=========================================="
docker volume rm adesso_db_data 2>/dev/null || true
AD_VOLUMES=$(docker volume ls -q | grep -i adesso || true)
if [ -n "$AD_VOLUMES" ]; then
    echo "Удаляем volumes: $AD_VOLUMES"
    docker volume rm -f $AD_VOLUMES 2>/dev/null || true
fi

echo "=========================================="
echo "4. Удаление директорий и файлов adesso.us:"
echo "=========================================="
if [ -d "/home/vladx/projects/adesso.us" ]; then
    echo "Удаляем /home/vladx/projects/adesso.us..."
    sudo rm -rf /home/vladx/projects/adesso.us
fi

# Поиск и удаление любых оставшихся папок/файлов adesso
echo "Поиск дополнительных файлов/папок adesso в /home/vladx..."
find /home/vladx -maxdepth 3 -type d -name "*adesso*" -exec echo "Удаление: {}" \; -exec sudo rm -rf {} + 2>/dev/null || true

echo "=========================================="
echo "5. Безопасная очистка кэшей Docker и логов:"
echo "=========================================="
echo "Очистка кэша сборки Docker (builder)..."
docker builder prune -af --filter "until=24h" || true

echo "Очистка неиспользуемых docker образов..."
docker image prune -af || true

echo "Очистка неиспользуемых volumes (не привязанных к контейнерам)..."
docker volume prune -f || true

echo "Очистка раздутых Docker логов (>50MB)..."
sudo find /var/lib/docker/containers/ -name "*-json.log" -size +50M -exec truncate -s 0 {} \; 2>/dev/null || true

echo "Очистка системного журнала journald (оставляем 100M / 7 дней)..."
sudo journalctl --vacuum-size=100M 2>/dev/null || true
sudo journalctl --vacuum-time=7d 2>/dev/null || true

echo "Очистка кэша пакетов apt..."
sudo apt-get clean 2>/dev/null || true
sudo apt-get autoremove -y 2>/dev/null || true

echo "Очистка старых файлов в /tmp (>7 дней)..."
sudo find /tmp -type f -atime +7 -delete 2>/dev/null || true

echo "=========================================="
echo "6. Итоговое состояние дискового пространства:"
echo "=========================================="
df -h /
echo ""
echo "Docker disk usage:"
docker system df
echo "=========================================="
echo "✅ Очистка завершена успешно!"
echo "=========================================="
