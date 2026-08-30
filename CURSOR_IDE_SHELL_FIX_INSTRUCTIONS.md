# Инструкции по исправлению cursor_snap_ENV_VARS в Cursor IDE

## Проблема

Ошибка при выполнении команд через терминал в Cursor:
```
(eval):3: parse error near `cursor_snap_ENV_VARS...'
zsh:1: command not found: dump_zsh_state
```

## Решение 1: Обновить настройки терминала в Cursor

1. Откройте **Command Palette** (Cmd+Shift+P)
2. Введите `Preferences: Open User Settings (JSON)`
3. Добавьте следующие настройки:

```json
{
  "terminal.integrated.defaultProfile.osx": "zsh",
  "terminal.integrated.profiles.osx": {
    "zsh": {
      "path": "/bin/zsh",
      "args": ["-l"]
    },
    "bash": {
      "path": "/bin/bash"
    }
  },
  "terminal.integrated.inheritEnv": false,
  "terminal.integrated.env.osx": {},
  "terminal.integrated.shellIntegration.enabled": true
}
```

4. Сохраните и **перезапустите Cursor IDE**

## Решение 2: Использовать bash временно

Если проблема сохраняется, временно переключитесь на bash:

```json
{
  "terminal.integrated.defaultProfile.osx": "bash"
}
```

## Решение 3: Обходной путь - использовать скрипты

Вместо выполнения сложных команд через `run_terminal_cmd`, создавайте скрипты:

```bash
# Создать скрипт
cat > test.sh << 'SCRIPT'
#!/bin/bash
docker ps | grep blog
SCRIPT

# Выполнить напрямую в терминале Cursor
chmod +x test.sh
./test.sh
```

## Решение 4: Проверить .zshrc

Убедитесь, что в `~/.zshrc` нет конфликтующих переменных:

```bash
# Проверить наличие cursor_snap в .zshrc
grep -i cursor ~/.zshrc

# Если найдено, закомментируйте или удалите
```

## Решение 5: Очистить кэш Cursor

1. Закройте Cursor IDE
2. Удалите кэш (опционально):
   ```bash
   rm -rf ~/Library/Application\ Support/Cursor/Cache
   ```
3. Перезапустите Cursor

## Быстрая проверка

После применения изменений выполните простую команду в терминале Cursor:

```bash
echo "Test"
```

Если ошибка исчезла - проблема решена.

## Альтернатива

Если проблема сохраняется, используйте внешний терминал (iTerm2, Terminal.app) для выполнения команд, а Cursor IDE - только для редактирования кода.

