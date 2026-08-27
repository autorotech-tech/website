# 🚀 Запуск Dev сервера - Инструкция

## Проблемы и решения

### 1. ✅ Модуль '@/lib/utils' не найден
**Решение:** Файл `lib/utils.ts` синхронизирован на сервер.

### 2. SSH туннель: Connection refused
**Причина:** Dev сервер не запущен на сервере.

## Запуск Dev сервера

### Вариант 1: В текущей SSH сессии (для тестирования)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev
```

**Оставьте терминал открытым!**

### Вариант 2: В фоне (для постоянной работы)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "cd /home/vladx/projects/autoro.tech/website/blog-autoro && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && nohup npm run dev > /tmp/blog-dev.log 2>&1 &"
```

**Проверка логов:**
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "tail -f /tmp/blog-dev.log"
```

**Остановка сервера:**
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "pkill -f 'npm run dev'"
```

### Вариант 3: Через screen (рекомендуется)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
screen -S blog-dev
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev
```

**Отключиться:** `Ctrl+A`, затем `D`  
**Вернуться:** `screen -r blog-dev`

## Проверка что сервер запущен

```bash
# Проверить процессы
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "ps aux | grep -E 'node.*dev|next dev' | grep -v grep"

# Проверить порт
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "ss -tlnp | grep 3000"

# Проверить логи
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "tail -20 /tmp/blog-dev.log"
```

## После запуска сервера

1. **На вашем Mac** - запустите SSH туннель:
```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 3000:localhost:3000 -N vladx@46.250.228.229
```

2. **Откройте в браузере:**
- http://localhost:3000/blog

---

**Дата:** 2026-01-06

