# Исправление проблемы cursor_snap_ENV_VARS в Cursor IDE

## Проблема

При выполнении команд через `run_terminal_cmd` в Cursor IDE возникает ошибка:
```
(eval):3: parse error near `cursor_snap_ENV_VARS...'
zsh:1: command not found: dump_zsh_state
```

## Причина

Cursor IDE пытается установить внутренние переменные окружения (`cursor_snap_ENV_VARS`) через shell, но синтаксис несовместим с zsh или возникает конфликт с настройками zsh.

## Решения

### Решение 1: Проверить настройки Cursor IDE

1. Откройте **Settings** (Cmd+,) в Cursor
2. Найдите `terminal.integrated.shell.osx` или `terminal.integrated.defaultProfile.osx`
3. Убедитесь, что используется правильный путь к zsh: `/bin/zsh`
4. Проверьте `terminal.integrated.env.osx` - там могут быть конфликтующие переменные

### Решение 2: Обновить настройки терминала в Cursor

В файле `settings.json` Cursor добавьте:

```json
{
  "terminal.integrated.defaultProfile.osx": "zsh",
  "terminal.integrated.profiles.osx": {
    "zsh": {
      "path": "/bin/zsh",
      "args": ["-l"]
    }
  },
  "terminal.integrated.inheritEnv": false,
  "terminal.integrated.env.osx": {}
}
```

### Решение 3: Использовать bash вместо zsh (временно)

```json
{
  "terminal.integrated.defaultProfile.osx": "bash",
  "terminal.integrated.profiles.osx": {
    "bash": {
      "path": "/bin/bash"
    }
  }
}
```

### Решение 4: Создавать скрипты вместо heredoc

Вместо сложных heredoc в `run_terminal_cmd`, создавать скрипты:

```bash
# Создать скрипт локально
cat > script.sh << 'SCRIPT'
#!/bin/bash
# Ваши команды
SCRIPT

# Скопировать и выполнить
scp script.sh server:/tmp/
ssh server "bash /tmp/script.sh"
```

### Решение 5: Использовать простые команды

Разбивать сложные команды на простые:

```bash
# Вместо:
ssh server "cat > file.sh << 'EOF'
commands
EOF"

# Использовать:
echo "commands" > file.sh
scp file.sh server:/tmp/
ssh server "bash /tmp/file.sh"
```

## Временное решение для текущей работы

Для диагностики блога использовать простые команды:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps | grep blog"
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s http://localhost:3002/api/admin/posts"
```

Или создавать скрипты и копировать их на сервер.

## Проверка

После применения изменений:
1. Перезапустить Cursor IDE
2. Выполнить простую команду через `run_terminal_cmd`
3. Проверить что ошибка исчезла

## Рекомендации

1. **Использовать скрипты** вместо heredoc в `run_terminal_cmd`
2. **Разбивать команды** на простые шаги
3. **Проверять настройки** терминала в Cursor после обновлений
4. **Использовать bash** если проблема с zsh сохраняется

