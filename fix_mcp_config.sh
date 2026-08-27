#!/bin/bash
# Скрипт для исправления проблем с MCP-серверами

CONFIG_FILE="$HOME/.cursor/mcp.json"
BACKUP_FILE="$HOME/.cursor/mcp.json.backup.$(date +%Y%m%d_%H%M%S)"

# Создаем backup
cp "$CONFIG_FILE" "$BACKUP_FILE"
echo "✓ Backup создан: $BACKUP_FILE"
echo ""

# Используем Python для исправления конфигурации
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
fixed_count = 0

# Исправление 1: Убрать пустой env из brave-search (если ключ пустой)
if "brave-search" in mcp_servers:
    brave_config = mcp_servers["brave-search"]
    if "env" in brave_config:
        brave_api_key = brave_config["env"].get("BRAVE_API_KEY", "")
        if not brave_api_key or brave_api_key.strip() == "":
            # Удаляем env, если ключ пустой - сервер не будет работать, но не будет ошибок
            del brave_config["env"]
            print("✓ Удален пустой env из brave-search (добавьте API ключ вручную)")
            fixed_count += 1

# Исправление 2: Исправить путь к SSH ключу в working-mcp-docker
if "working-mcp-docker" in mcp_servers:
    docker_config = mcp_servers["working-mcp-docker"]
    if "args" in docker_config:
        args = docker_config["args"]
        # Заменяем ~ на абсолютный путь
        home_dir = str(Path.home())
        for i, arg in enumerate(args):
            if arg.startswith("~/"):
                args[i] = arg.replace("~/", f"{home_dir}/")
                print(f"✓ Исправлен путь SSH ключа: {arg} -> {args[i]}")
                fixed_count += 1

# Сохраняем исправленную конфигурацию
try:
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Конфигурация исправлена: {config_file}")
    print(f"✓ Исправлено проблем: {fixed_count}")
except Exception as e:
    print(f"Ошибка при сохранении файла: {e}")
    sys.exit(1)

# Предупреждения
print("\n" + "="*60)
print("ВАЖНО:")
print("="*60)
print("1. brave-search требует API ключ - добавьте его вручную при необходимости")
print("2. working-mcp-docker требует SSH доступ к серверу")
print("3. Перезапустите Cursor IDE для применения изменений")
PYTHON_SCRIPT

echo ""
echo "Готово!"



