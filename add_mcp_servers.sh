#!/bin/bash
# Скрипт для добавления новых MCP-серверов к существующей конфигурации

CONFIG_FILE="$HOME/.cursor/mcp.json"
BACKUP_FILE="$HOME/.cursor/mcp.json.backup.$(date +%Y%m%d_%H%M%S)"

# Проверяем существование файла
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Ошибка: Файл $CONFIG_FILE не найден"
    exit 1
fi

# Создаем backup
cp "$CONFIG_FILE" "$BACKUP_FILE"
echo "✓ Backup создан: $BACKUP_FILE"
echo ""

# Используем Python для безопасного добавления новых серверов
python3 << 'PYTHON_SCRIPT'
import json
import sys
from pathlib import Path

config_file = Path.home() / ".cursor" / "mcp.json"

try:
    # Читаем существующую конфигурацию
    with open(config_file, 'r', encoding='utf-8') as f:
        config = json.load(f)
except Exception as e:
    print(f"Ошибка при чтении файла: {e}")
    sys.exit(1)

# Новые серверы для добавления
new_servers = {
    "tailwindcss": {
        "command": "npx",
        "args": ["-y", "tailwindcss-mcp-server"]
    },
    "nextjs-docs": {
        "command": "npx",
        "args": ["-y", "@taiyokimura/nextjs-docs-mcp@latest"]
    },
    "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "--allowed-directories", "/Users/vlad_x/Desktop/n8n/autoro.tech/website"]
    },
    "brave-search": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env": {
            "BRAVE_API_KEY": ""  # Пользователь должен добавить свой API ключ
        }
    },
    "puppeteer": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    }
}

# Серверы, требующие дополнительной настройки (добавляются с предупреждением)
optional_servers = {
    "postgres": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://supabase_admin:supabase_password_e97577f974376e8d@localhost:5433/postgres?sslmode=disable"],
        "note": "⚠️  Требует SSH туннель для доступа к БД на сервере"
    },
    "supabase": {
        "command": "npx",
        "args": ["-y", "@supabase/mcp-server"],
        "env": {
            "SUPABASE_URL": "https://api.autoro.tech",
            "SUPABASE_SERVICE_ROLE_KEY": ""  # Пользователь должен добавить свой ключ
        },
        "note": "⚠️  БЕЗОПАСНОСТЬ: Используйте только в режиме разработки с read-only правами!"
    }
}

# Добавляем новые серверы (только если их еще нет)
added_count = 0
for name, server_config in new_servers.items():
    if name not in config.get("mcpServers", {}):
        # Удаляем 'note' из конфигурации перед добавлением
        server_to_add = {k: v for k, v in server_config.items() if k != 'note'}
        config.setdefault("mcpServers", {})[name] = server_to_add
        print(f"✓ Добавлен сервер: {name}")
        added_count += 1
    else:
        print(f"⚠ Сервер {name} уже существует, пропускаем")

# Опциональные серверы (информация)
print("\n" + "="*60)
print("ОПЦИОНАЛЬНЫЕ СЕРВЕРЫ (требуют настройки):")
print("="*60)
for name, server_config in optional_servers.items():
    if name not in config.get("mcpServers", {}):
        note = server_config.get("note", "")
        print(f"\n{name.upper()}:")
        print(f"  {note}")
        print(f"  → Добавьте вручную в ~/.cursor/mcp.json при необходимости")
        print(f"  → См. пример в MCP_CONFIG_WITH_ALL_SERVERS.json")
    else:
        print(f"⚠ Сервер {name} уже существует, пропускаем")

# Сохраняем обновленную конфигурацию
try:
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Конфигурация обновлена: {config_file}")
    print(f"✓ Добавлено серверов: {added_count}")
except Exception as e:
    print(f"Ошибка при сохранении файла: {e}")
    sys.exit(1)
PYTHON_SCRIPT

echo ""
echo "Готово! Перезапустите Cursor IDE для применения изменений."


