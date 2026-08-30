#!/bin/bash
# Скрипт для проверки использования диска и поиска ненужных файлов

echo "=== 1. Использование диска ==="
df -h

echo ""
echo "=== 2. Топ 20 самых больших директорий ==="
du -h --max-depth=1 /home/vladx 2>/dev/null | sort -hr | head -20

echo ""
echo "=== 3. Топ 20 самых больших файлов ==="
find /home/vladx -type f -size +100M -exec ls -lh {} \; 2>/dev/null | awk '{print $5, $9}' | sort -hr | head -20

echo ""
echo "=== 4. Docker использование ==="
docker system df

echo ""
echo "=== 5. Docker образы (размер) ==="
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | sort -k3 -hr | head -10

echo ""
echo "=== 6. Docker контейнеры (размер) ==="
docker ps -a --format "table {{.Names}}\t{{.Size}}" | sort -k2 -hr | head -10

echo ""
echo "=== 7. Docker volumes (размер) ==="
docker volume ls -q | xargs -r -I {} sh -c "echo '{}:'; docker system df -v | grep {} || echo 'Size: N/A'"

echo ""
echo "=== 8. Логи Docker (размер) ==="
du -sh /var/lib/docker/containers/*/*-json.log 2>/dev/null | sort -hr | head -10 || echo "Логи не найдены"

echo ""
echo "=== 9. Остановленные контейнеры ==="
docker ps -a --filter "status=exited" --format "table {{.Names}}\t{{.Status}}\t{{.Size}}"

echo ""
echo "=== 10. Неиспользуемые образы (dangling) ==="
docker images --filter "dangling=true" --format "table {{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}"

echo ""
echo "=== 11. Нужно ли очистить Docker? ==="
docker system df

