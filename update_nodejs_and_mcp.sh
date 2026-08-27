#!/bin/bash
# Скрипт для обновления Node.js и добавления tailwindcss-mcp-server

set -e

echo "=== Обновление Node.js и настройка MCP ==="
echo ""

# Загружаем nvm если установлен
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Проверяем, установлен ли nvm
if ! command -v nvm &> /dev/null && [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "Установка nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

echo "Текущая версия Node.js: $(node --version 2>/dev/null || echo 'не установлена')"
echo ""

# Устанавливаем последнюю LTS версию Node.js
echo "Установка Node.js 20 (LTS)..."
nvm install 20
nvm use 20
nvm alias default 20

echo ""
echo "✓ Node.js обновлен до версии: $(node --version)"
echo "✓ npm версия: $(npm --version)"
echo ""

# Обновляем MCP конфигурацию
CONFIG_FILE="$HOME/.cursor/mcp.json"
BACKUP_FILE="$HOME/.cursor/mcp.json.backup.$(date +%Y%m%d_%H%M%S)"

if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    echo "✓ Backup создан: $BACKUP_FILE"
    
    python3 << 'PYTHON_SCRIPT'
import json
import sys
from pathlib import Path

config_file = Path.home() / ".cursor" / "mcp.json"

try:
    with open(config_file, 'r', encoding='utf-8') as f:
        config = json.load(f)
except Exception as e:
    print(f"Ошибка при чтении файла: {e}")
    sys.exit(1)

mcp_servers = config.get("mcpServers", {})

# Добавляем tailwindcss обратно, если его нет
if "tailwindcss" not in mcp_servers:
    mcp_servers["tailwindcss"] = {
        "command": "npx",
        "args": ["-y", "tailwindcss-mcp-server"]
    }
    print("✓ tailwindcss-mcp-server добавлен в конфигурацию")
else:
    print("⚠ tailwindcss уже существует в конфигурации")

# Сохраняем конфигурацию
try:
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"✓ Конфигурация MCP обновлена: {config_file}")
except Exception as e:
    print(f"Ошибка при сохранении файла: {e}")
    sys.exit(1)
PYTHON_SCRIPT

else
    echo "⚠ Файл конфигурации MCP не найден: $CONFIG_FILE"
fi

echo ""
echo "="*60
echo "ГОТОВО!"
echo "="*60
echo ""
echo "Следующие шаги:"
echo "1. Перезапустите терминал или выполните: source ~/.bashrc (или source ~/.zshrc)"
echo "2. Проверьте версию Node.js: node --version (должна быть 20.x)"
echo "3. Перезапустите Cursor IDE для применения изменений MCP"
echo ""


