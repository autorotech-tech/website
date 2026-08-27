# Исправление проблем с MCP-серверами

## Проблемы

### 1. context7 - поврежденный кэш npx
**Симптомы:**
- Множество ошибок `npm warn tar TAR_ENTRY_ERROR ENOENT`
- `ERR_MODULE_NOT_FOUND` для `@modelcontextprotocol/sdk/server/mcp.js`
- Клиент закрывается с ошибкой

**Причина:** Поврежденный кэш npx при установке пакета `@upstash/context7-mcp`

**Решение:** ✅ Кэш npx очищен

### 2. brave-search - отсутствует API ключ
**Симптомы:**
- `Error: BRAVE_API_KEY environment variable is required`
- Сервер не запускается

**Причина:** Сервер требует API ключ от Brave Search API

**Решение:** Требуется одно из действий:
- Добавить `BRAVE_API_KEY` в конфигурацию MCP (env)
- Удалить сервер из конфигурации, если не нужен

## Выполненные действия

1. ✅ Очищен кэш npx (`~/.npm/_npx`)
2. ✅ Проверена конфигурация MCP

## Следующие шаги

### Для context7:
1. **Перезапустите Cursor IDE** полностью
2. Проверьте статус сервера - должен работать после очистки кэша

### Для brave-search:
Выберите один из вариантов:

**Вариант A: Добавить API ключ** (если нужен Brave Search)
1. Получите API ключ: https://brave.com/search/api/
2. Добавьте в `~/.cursor/mcp.json`:
```json
"brave-search": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": {
    "BRAVE_API_KEY": "ваш_ключ_здесь"
  }
}
```

**Вариант B: Удалить сервер** (если не нужен)
Удалите блок `"brave-search"` из `~/.cursor/mcp.json`

## Рекомендации

- **context7** должен заработать после перезапуска Cursor
- **brave-search** можно оставить с ошибкой (не критично) или настроить/удалить
- Остальные серверы (tailwindcss, nextjs-docs, filesystem, puppeteer) должны работать нормально

