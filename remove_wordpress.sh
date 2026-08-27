#!/bin/bash
# Скрипт для удаления WordPress контейнеров и файлов

echo "=== Поиск WordPress контейнеров ==="
docker ps -a | grep -i wordpress

echo ""
echo "=== Поиск контейнеров pquoc ==="
docker ps -a | grep -i pquoc

echo ""
echo "=== Поиск контейнеров autoro wordpress ==="
docker ps -a | grep -i autoro | grep -i wordpress

echo ""
echo "=== Остановка контейнеров wordpress-pquoc ==="
docker stop $(docker ps -a -q --filter "name=wordpress-pquoc") 2>/dev/null || echo "Нет контейнеров wordpress-pquoc"
docker stop $(docker ps -a -q --filter "name=pquoc") 2>/dev/null || echo "Нет контейнеров pquoc"

echo ""
echo "=== Удаление контейнеров wordpress-pquoc ==="
docker rm $(docker ps -a -q --filter "name=wordpress-pquoc") 2>/dev/null || echo "Нет контейнеров wordpress-pquoc для удаления"
docker rm $(docker ps -a -q --filter "name=pquoc") 2>/dev/null || echo "Нет контейнеров pquoc для удаления"

echo ""
echo "=== Удаление папки projects/pquoc.com/wordpress ==="
if [ -d "/home/vladx/projects/pquoc.com/wordpress" ]; then
    sudo rm -rf /home/vladx/projects/pquoc.com/wordpress
    echo "Папка projects/pquoc.com/wordpress удалена"
else
    echo "Папка projects/pquoc.com/wordpress не найдена"
fi

echo ""
echo "=== Остановка контейнеров wordpress autoro.tech ==="
docker stop $(docker ps -a -q --filter "name=autoro.*wordpress") 2>/dev/null || echo "Нет контейнеров autoro wordpress"
docker stop $(docker ps -a -q --filter "name=wordpress.*autoro") 2>/dev/null || echo "Нет контейнеров wordpress autoro"

echo ""
echo "=== Удаление контейнеров wordpress autoro.tech ==="
docker rm $(docker ps -a -q --filter "name=autoro.*wordpress") 2>/dev/null || echo "Нет контейнеров autoro wordpress для удаления"
docker rm $(docker ps -a -q --filter "name=wordpress.*autoro") 2>/dev/null || echo "Нет контейнеров wordpress autoro для удаления"

echo ""
echo "=== Удаление папки projects/autoro.tech/wordpress ==="
if [ -d "/home/vladx/projects/autoro.tech/wordpress" ]; then
    sudo rm -rf /home/vladx/projects/autoro.tech/wordpress
    echo "Папка projects/autoro.tech/wordpress удалена"
else
    echo "Папка projects/autoro.tech/wordpress не найдена"
fi

echo ""
echo "=== Поиск оставшихся WordPress контейнеров ==="
docker ps -a | grep -i wordpress || echo "WordPress контейнеры не найдены"

echo ""
echo "=== Готово ==="

