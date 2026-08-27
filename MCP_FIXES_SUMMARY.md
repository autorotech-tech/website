# Резюме исправлений MCP-серверов

## 🔍 Обнаруженные проблемы

### 1. tailwindcss-mcp-server
**Ошибка:** `ReferenceError: File is not defined`  
**Причина:** Node.js v19.6.1 не поддерживает глобальный File API (требуется Node.js 20+)  
**Статус:** ⚠️ Временно отключен

### 2. @modelcontextprotocol/server-filesystem
**Ошибка:** `ENOENT: no such file or directory, stat '/Users/vlad_x/--allowed-directories'`  
**Причина:** Неправильный формат аргументов - флаг `--allowed-directories` интерпретируется как путь  
**Статус:** ✅ Исправлено (используется env переменная)

### 3. @modelcontextprotocol/server-puppeteer
**Ошибка:** `ERR_MODULE_NOT_FOUND: Cannot find module '@modelcontextprotocol/sdk/dist/server/index.js'`  
**Причина:** Проблема с зависимостями в npx кэше  
**Статус:** ✅ Кэш очищен, требует перезапуск Cursor

## ✅ Выполненные исправления

1. **filesystem сервер:**
   - Изменен формат конфигурации с `--allowed-directories` на переменную окружения `ALLOWED_DIRECTORIES`
   - Конфигурация обновлена в `~/.cursor/mcp.json`

2. **puppeteer сервер:**
   - Очищен npx кэш (`~/.npm/_npx`)
   - Конфигурация оставлена без изменений (должна работать после перезапуска)

3. **tailwindcss сервер:**
   - Временно удален из конфигурации до обновления Node.js до версии 20+

## 📋 Следующие шаги

### Обязательно:
1. **Перезапустите Cursor IDE** для применения изменений
2. Проверьте работу filesystem и puppeteer серверов

### Опционально (для tailwindcss):
1. Обновите Node.js до версии 20+:
   ```bash
   # Если используете nvm:
   nvm install 20
   nvm use 20
   
   # Или используйте другой менеджер версий Node.js
   ```
2. После обновления Node.js добавьте tailwindcss обратно в `~/.cursor/mcp.json`:
   ```json
   "tailwindcss": {
     "command": "npx",
     "args": ["-y", "tailwindcss-mcp-server"]
   }
   ```

## 📝 Текущая конфигурация

Файл: `~/.cursor/mcp.json`

**Активные серверы:**
- ✅ nextjs-docs (работает)
- ✅ filesystem (исправлено, должно работать после перезапуска)
- ✅ puppeteer (кэш очищен, должно работать после перезапуска)

**Временно отключены:**
- ⚠️ tailwindcss (требует Node.js 20+)

**Работающие серверы (не требуют изменений):**
- ✅ browsermcp
- ✅ Hugging Face
- ✅ context7
- ✅ n8n-mcp
- ✅ working-mcp-docker


