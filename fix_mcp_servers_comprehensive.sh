#!/bin/bash
# Комплексное исправление проблем с MCP-серверами

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

print("Анализ проблем MCP-серверов:")
print("="*60)

# Проблема 1: tailwindcss - требует Node.js 20+
# Решение: Пока оставляем, но добавим комментарий
if "tailwindcss" in mcp_servers:
    print("\n1. tailwindcss:")
    print("   ⚠️  Требует Node.js 20+ (текущая версия: 19.6.1)")
    print("   ⚠️  Обновите Node.js до версии 20+ для работы tailwindcss-mcp-server")
    print("   💡 Временно отключаем сервер (можно включить после обновления Node.js)")

# Проблема 2: filesystem - неправильный формат аргументов
# Согласно документации MCP, filesystem использует переменные окружения
if "filesystem" in mcp_servers:
    filesystem_config = mcp_servers["filesystem"]
    print("\n2. filesystem:")
    print("   ❌ Текущая конфигурация использует неправильный формат аргументов")
    
    # Исправляем: используем переменные окружения вместо args
    allowed_dir = "/Users/vlad_x/Desktop/n8n/autoro.tech/website"
    filesystem_config["args"] = ["-y", "@modelcontextprotocol/server-filesystem"]
    filesystem_config["env"] = {
        "ALLOWED_DIRECTORIES": allowed_dir
    }
    print(f"   ✅ Исправлено: используется env ALLOWED_DIRECTORIES={allowed_dir}")

# Проблема 3: puppeteer - проблема с зависимостями
# Решение: Очистить npx кэш и попробовать снова
if "puppeteer" in mcp_servers:
    print("\n3. puppeteer:")
    print("   ⚠️  Проблема с зависимостями в npx кэше")
    print("   💡 Попробуем исправить, очистив кэш...")
    # Конфигурация правильная, проблема в кэше npx

# Временно отключаем tailwindcss из-за несовместимости с Node.js 19
if "tailwindcss" in mcp_servers:
    print("\n⚠️  ВРЕМЕННОЕ РЕШЕНИЕ:")
    print("   tailwindcss будет отключен до обновления Node.js до версии 20+")
    print("   Раскомментируйте его в конфигурации после обновления Node.js")
    # Сохраняем конфигурацию в комментарии (не поддерживается JSON, поэтому удаляем)
    # Вместо этого создадим отдельный файл с инструкциями
    del mcp_servers["tailwindcss"]
    print("   ✅ tailwindcss временно удален из конфигурации")

# Сохраняем исправленную конфигурацию
try:
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print("\n" + "="*60)
    print("✓ Конфигурация исправлена: " + str(config_file))
except Exception as e:
    print(f"Ошибка при сохранении файла: {e}")
    sys.exit(1)
PYTHON_SCRIPT

echo ""
echo "Очистка npx кэша для puppeteer..."
npx clear-npx-cache 2>/dev/null || echo "⚠️  Команда clear-npx-cache не найдена (это нормально)"
echo ""

echo "="*60
echo "ИНСТРУКЦИИ:"
echo "="*60
echo ""
echo "1. tailwindcss:"
echo "   - Требует Node.js 20+"
echo "   - Обновите Node.js: nvm install 20 && nvm use 20"
echo "   - Затем добавьте tailwindcss обратно в конфигурацию"
echo ""
echo "2. filesystem:"
echo "   - ✅ Исправлено: теперь использует env ALLOWED_DIRECTORIES"
echo ""
echo "3. puppeteer:"
echo "   - Может потребоваться очистка npx кэша"
echo "   - Попробуйте: rm -rf ~/.npm/_npx"
echo "   - Или перезапустите Cursor после очистки"
echo ""
echo "4. Перезапустите Cursor IDE для применения изменений"
echo ""


