# Резюме: Исправление проблемы shell в Cursor IDE

## Проблема

Ошибка `parse error near 'cursor_snap_ENV_VARS'` при выполнении команд через `run_terminal_cmd` в Cursor IDE.

## Причина

Cursor IDE пытается установить внутренние переменные окружения через shell, но синтаксис конфликтует с zsh.

## Решение

### Шаг 1: Обновить настройки Cursor IDE

Откройте Settings (Cmd+,) → найдите "Terminal" → добавьте настройки из `fix_cursor_shell_settings.json`

Или добавьте в `settings.json`:

```json
{
  "terminal.integrated.inheritEnv": false,
  "terminal.integrated.env.osx": {}
}
```

### Шаг 2: Перезапустить Cursor IDE

Полностью закройте и откройте Cursor IDE заново.

### Шаг 3: Проверить

Выполните простую команду в терминале Cursor:
```bash
echo "Test"
```

## Временное решение

Пока проблема не решена, использовать:
- **Внешний терминал** для выполнения команд
- **Скрипты** вместо heredoc в `run_terminal_cmd`
- **Простые команды** вместо сложных многострочных

## Файлы созданы

1. `CURSOR_SHELL_FIX.md` - подробные инструкции
2. `fix_cursor_shell_settings.json` - настройки для копирования
3. `CURSOR_IDE_SHELL_FIX_INSTRUCTIONS.md` - пошаговая инструкция
4. `SIMPLE_BLOG_CHECK.sh` - скрипт для проверки блога (без heredoc)

## Следующие шаги

1. Применить настройки из `fix_cursor_shell_settings.json`
2. Перезапустить Cursor IDE
3. Выполнить проверку блога через `SIMPLE_BLOG_CHECK.sh` или команды из `MANUAL_BLOG_CHECK.md`

