# Быстрый старт: Настройка MCP-серверов

## 🚀 Автоматическая установка (рекомендуется)

Запустите скрипт для добавления основных MCP-серверов:

```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website
./add_mcp_servers.sh
```

Скрипт добавит:
- ✅ Tailwind CSS MCP Server
- ✅ Next.js Docs MCP
- ✅ Filesystem MCP
- ✅ Brave Search MCP (требует API ключ)
- ✅ Puppeteer MCP

## 📝 Ручная настройка опциональных серверов

### PostgreSQL MCP

**Когда использовать**: Для инспектирования схемы БД и написания SQL-запросов.

**Требования**: SSH туннель к серверу

**Шаги**:
1. Откройте терминал и создайте SSH туннель:
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro -L 5433:localhost:5433 vladx@46.250.228.229
   ```
   Оставьте этот терминал открытым.

2. Добавьте в `~/.cursor/mcp.json`:
   ```json
   "postgres": {
     "command": "npx",
     "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://supabase_admin:supabase_password_e97577f974376e8d@localhost:5433/postgres?sslmode=disable"]
   }
   ```

3. Перезапустите Cursor IDE

### Supabase MCP

**⚠️ ВНИМАНИЕ**: Используйте только в режиме разработки с read-only правами!

**Когда использовать**: Для управления проектом Supabase через MCP (не рекомендуется для production).

**Шаги**:
1. Получите Service Role Key из Supabase Studio
2. Добавьте в `~/.cursor/mcp.json`:
   ```json
   "supabase": {
     "command": "npx",
     "args": ["-y", "@supabase/mcp-server"],
     "env": {
       "SUPABASE_URL": "https://api.autoro.tech",
       "SUPABASE_SERVICE_ROLE_KEY": "ваш_service_role_key"
     }
   }
   ```

3. Перезапустите Cursor IDE

**Рекомендация**: Для блога лучше использовать PostgreSQL MCP, так как Supabase уже доступен через REST API.

### Brave Search MCP

**Когда использовать**: Для поиска решений специфических ошибок в интернете.

**Шаги**:
1. Получите API ключ: https://brave.com/search/api/
2. Обновите конфигурацию в `~/.cursor/mcp.json`:
   ```json
   "brave-search": {
     "command": "npx",
     "args": ["-y", "@modelcontextprotocol/server-brave-search"],
     "env": {
       "BRAVE_API_KEY": "ваш_api_ключ"
     }
   }
   ```

3. Перезапустите Cursor IDE

## ✅ Проверка работы

После перезапуска Cursor IDE:

1. Откройте чат с AI-ассистентом
2. Попробуйте запросить:
   - "Покажи доступные классы Tailwind для создания карточки"
   - "Как использовать Server Components в Next.js 15?"
   - "Найди решение для ошибки [ваша ошибка]"

Если MCP-серверы работают, AI сможет использовать их инструменты для ответа.

## 📚 Дополнительная информация

- Полная инструкция: `MCP_SETUP_INSTRUCTIONS.md`
- Пример полной конфигурации: `MCP_CONFIG_WITH_ALL_SERVERS.json`
- Анализ стека: `STACK_ANALYSIS_AND_RECOMMENDATIONS.md`




