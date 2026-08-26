#!/bin/bash
# Скрипт для копирования обновленного chat.js на сервер pquoc.com

# Настройки
SERVER="vladx@46.250.228.229"
SSH_KEY="~/.ssh/id_ed25519_autoro"
LOCAL_FILE="pquoc_chat_updated.js"
REMOTE_PATH="~/projects/pquoc.com/html/assets/js/chat.js"

echo "Копирование обновленного chat.js на сервер..."

# Копируем файл
scp -i $SSH_KEY $LOCAL_FILE $SERVER:$REMOTE_PATH

if [ $? -eq 0 ]; then
    echo "✅ Файл успешно скопирован!"
    echo "Проверьте на сервере: $REMOTE_PATH"
else
    echo "❌ Ошибка при копировании. Убедитесь, что:"
    echo "  1. Файл $LOCAL_FILE существует"
    echo "  2. SSH ключ доступен: $SSH_KEY"
    echo "  3. Путь на сервере корректен: $REMOTE_PATH"
fi

