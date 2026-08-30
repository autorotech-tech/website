# Инструкция по настройке MCP-серверов для Next.js блога

## Расположение конфигурации

MCP-серверы настраиваются в файле конфигурации Cursor. Можно использовать один из двух вариантов:

1. **Глобальный файл**: `~/.cursor/mcp.json` (применяется ко всем проектам)
2. **Локальный файл**: `.cursor/mcp.json` в корне проекта (применяется только к этому проекту)

## Важно: Добавление к существующей конфигурации

⚠️ **Ваш файл `~/.cursor/mcp.json` уже существует и содержит другие MCP-серверы!**

Не перезаписывайте файл полностью - добавьте новые серверы к существующим. См. раздел "Как добавить новые серверы" ниже.

## Рекомендуемая конфигурация (для новых установок)

Если файл не существует, создайте `~/.cursor/mcp.json` со следующим содержимым:

```json
{
  "mcpServers": {
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
    }
  }
}
```

## Как добавить новые серверы к существующей конфигурации

1. Откройте файл:
   ```bash
   nano ~/.cursor/mcp.json
   ```

2. Найдите секцию `"mcpServers"` и добавьте новые серверы после существующих (не забудьте добавить запятую после последнего существующего сервера):

```json
{
  "mcpServers": {
    // ... существующие серверы ...
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
    }
  }
}
```

3. Убедитесь, что JSON валидный (проверьте запятые, скобки)
4. Сохраните файл
5. Перезапустите Cursor IDE

## Установка (для новых установок)

### Вариант 1: Ручное создание файла

1. Откройте терминал
2. Выполните команду:
   ```bash
   mkdir -p ~/.cursor
   nano ~/.cursor/mcp.json
   ```
3. Вставьте содержимое из `MCP_CONFIG_EXAMPLE.json`
4. Сохраните файл (Ctrl+O, Enter, Ctrl+X)

### Вариант 2: Через команду (Mac/Linux)

```bash
mkdir -p ~/.cursor
cat > ~/.cursor/mcp.json << 'EOF'
{
  "mcpServers": {
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
    }
  }
}
EOF
```

## Описание серверов

### 1. Tailwind CSS MCP Server
- **Назначение**: Помощь с классами Tailwind CSS, автодополнение, документация
- **Команда**: `tailwindcss-mcp-server`
- **Использование**: Полезен при работе с компонентами блога, которые используют Tailwind CSS

### 2. Next.js Docs MCP
- **Назначение**: Документация и примеры Next.js
- **Команда**: `@taiyokimura/nextjs-docs-mcp@latest`
- **Использование**: Помощь с API Next.js, Server Components, Routing и другими функциями фреймворка

### 3. Filesystem MCP
- **Назначение**: Управление файлами в проекте
- **Команда**: `@modelcontextprotocol/server-filesystem`
- **Использование**: Чтение, создание и редактирование файлов в указанной директории

## Дополнительные серверы (опционально)

### 1. PostgreSQL MCP
**Назначение**: Прямой доступ к схеме базы данных для инспектирования таблиц и написания SQL-запросов.

**⚠️ Требования**: 
- Требуется SSH туннель для доступа к БД на сервере
- Используйте только в режиме разработки

**Конфигурация**:
```json
"postgres": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://supabase_admin:supabase_password_e97577f974376e8d@localhost:5433/postgres?sslmode=disable"]
}
```

**Настройка SSH туннеля**:
```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 5433:localhost:5433 vladx@46.250.228.229
```

### 2. Supabase MCP
**Назначение**: Управление проектом Supabase через MCP.

**⚠️ БЕЗОПАСНОСТЬ**: 
- Подключение БД к LLM несет риски безопасности (prompt injection)
- Используйте только в режиме разработки
- Настройте права "read-only" для AI
- Требуйте ручного подтверждения каждого действия

**Конфигурация**:
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

**Рекомендация**: Для блога используется Supabase через REST API, поэтому Supabase MCP обычно не требуется. PostgreSQL MCP может быть полезнее для инспектирования схемы.

### 3. Brave Search MCP
**Назначение**: Поиск в интернете для дебаггинга специфических ошибок сборки.

**Конфигурация**:
```json
"brave-search": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": {
    "BRAVE_API_KEY": "ваш_api_ключ"
  }
}
```

**Получение API ключа**: https://brave.com/search/api/

### 4. Puppeteer MCP
**Назначение**: Открытие страниц в headless-браузере, скриншоты, извлечение контента.

**Применение**:
- Автоматизированное тестирование верстки блога
- Парсинг мета-тегов с внешних ресурсов
- Визуальное тестирование компонентов

**Конфигурация**:
```json
"puppeteer": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
}
```

**Примечание**: Не требует дополнительной настройки, но может быть ресурсоемким.

## Автоматическое добавление (рекомендуется)

Используйте готовый скрипт для безопасного добавления новых серверов:

```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website
./add_mcp_servers.sh
```

Скрипт:
- ✅ Создаст backup существующей конфигурации
- ✅ Добавит только новые серверы (пропустит уже существующие)
- ✅ Сохранит все существующие серверы

## Перезапуск Cursor

После создания/изменения файла конфигурации:
1. Перезапустите Cursor IDE
2. MCP-серверы должны автоматически подключиться

## Проверка работы

После перезапуска Cursor, MCP-серверы должны быть доступны. Проверить можно в настройках Cursor или через использование функций, которые предоставляют эти серверы.

