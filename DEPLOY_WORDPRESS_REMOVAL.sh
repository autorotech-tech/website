#!/bin/bash
# Скрипт для создания и выполнения удаления WordPress на сервере

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'EOF'

# Создать скрипт на сервере
cat > /tmp/remove_wordpress.sh << 'SCRIPT'
#!/bin/bash
echo "=== 1. Поиск WordPress контейнеров ==="
docker ps -a | grep -i wordpress
docker ps -a | grep -i pquoc

echo ""
echo "=== 2. Остановка и удаление WordPress pquoc ==="
for id in $(docker ps -a | grep -i pquoc | awk '{print $1}'); do
    echo "Останавливаю контейнер $id"
    docker stop $id 2>/dev/null
    docker rm $id 2>/dev/null
done

echo ""
echo "=== 3. Удаление папки pquoc.com/wordpress ==="
if [ -d "/home/vladx/projects/pquoc.com/wordpress" ]; then
    echo "Удаляю папку..."
    sudo rm -rf /home/vladx/projects/pquoc.com/wordpress
    echo "Папка удалена"
else
    echo "Папка не найдена"
fi

echo ""
echo "=== 4. Остановка и удаление WordPress autoro.tech ==="
for id in $(docker ps -a | grep -i autoro | grep -i wordpress | awk '{print $1}'); do
    echo "Останавливаю контейнер $id"
    docker stop $id 2>/dev/null
    docker rm $id 2>/dev/null
done

echo ""
echo "=== 5. Удаление папки autoro.tech/wordpress ==="
if [ -d "/home/vladx/projects/autoro.tech/wordpress" ]; then
    echo "Удаляю папку..."
    sudo rm -rf /home/vladx/projects/autoro.tech/wordpress
    echo "Папка удалена"
else
    echo "Папка не найдена"
fi

echo ""
echo "=== 6. Поиск оставшихся WordPress контейнеров ==="
docker ps -a | grep -i wordpress || echo "WordPress контейнеры не найдены"

echo ""
echo "=== 7. Поиск volumes связанных с WordPress ==="
docker volume ls | grep -i wordpress || echo "WordPress volumes не найдены"

echo ""
echo "Готово!"
SCRIPT

chmod +x /tmp/remove_wordpress.sh
echo "Скрипт создан. Выполняю..."
/tmp/remove_wordpress.sh

EOF

