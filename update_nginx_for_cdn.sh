#!/bin/bash
# Скрипт для добавления поддержки CDN домена в Nginx

set -e

echo "=== Обновление Nginx конфигурации для CDN ==="

CONFIG_FILE="/home/vladx/projects/autoro.tech/html/default.conf"
BACKUP_FILE="${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Ошибка: файл $CONFIG_FILE не найден"
    exit 1
fi

# Создаем резервную копию
cp "$CONFIG_FILE" "$BACKUP_FILE"
echo "Резервная копия создана: $BACKUP_FILE"

# Читаем существующие server_name
CURRENT_NAMES=$(grep -oP 'server_name\s+\K[^;]+' "$CONFIG_FILE" | head -1)

echo ""
echo "Текущие server_name: $CURRENT_NAMES"
read -p "Введи новый CDN домен (например: autoro-bypass.b-cdn.net): " CDN_DOMAIN

if [ -z "$CDN_DOMAIN" ]; then
    echo "Ошибка: домен не может быть пустым"
    exit 1
fi

# Добавляем новый домен в server_name
# Используем sed для замены
sed -i "s/server_name\s*\([^;]*\)/server_name \1 $CDN_DOMAIN/" "$CONFIG_FILE"

echo ""
echo "Обновлено! Новые server_name:"
grep "server_name" "$CONFIG_FILE"

echo ""
echo "Проверка синтаксиса Nginx..."
if docker exec autoro-site nginx -t 2>/dev/null; then
    echo "✓ Синтаксис правильный"
    read -p "Перезапустить Nginx? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker restart autoro-site
        echo "✓ Nginx перезапущен"
    fi
else
    echo "⚠ Ошибка синтаксиса! Восстанавливаю резервную копию..."
    cp "$BACKUP_FILE" "$CONFIG_FILE"
    echo "Восстановлено из: $BACKUP_FILE"
    exit 1
fi

echo ""
echo "=== Готово ==="
echo "Теперь можно использовать домен: $CDN_DOMAIN"

