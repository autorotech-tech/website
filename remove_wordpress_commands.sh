#!/bin/bash
# Команды для удаления WordPress

echo "=== 1. Поиск WordPress контейнеров ==="
docker ps -a | grep -i wordpress
docker ps -a | grep -i pquoc

echo ""
echo "=== 2. Остановка WordPress pquoc ==="
for container in $(docker ps -a -q --filter "name=wordpress-pquoc"); do
    echo "Останавливаю $container"
    docker stop $container
    docker rm $container
done

for container in $(docker ps -a -q --filter "name=pquoc"); do
    echo "Останавливаю $container"
    docker stop $container
    docker rm $container
done

echo ""
echo "=== 3. Удаление папки pquoc.com/wordpress ==="
sudo rm -rf /home/vladx/projects/pquoc.com/wordpress

echo ""
echo "=== 4. Остановка WordPress autoro.tech ==="
for container in $(docker ps -a | grep -i autoro | grep -i wordpress | awk '{print $1}'); do
    echo "Останавливаю $container"
    docker stop $container
    docker rm $container
done

echo ""
echo "=== 5. Удаление папки autoro.tech/wordpress ==="
sudo rm -rf /home/vladx/projects/autoro.tech/wordpress

echo ""
echo "=== 6. Поиск оставшихся WordPress контейнеров ==="
docker ps -a | grep -i wordpress

echo ""
echo "Готово!"

