# 🚀 Запуск Dev сервера блога

## Быстрый старт

### 1. Подключение к серверу

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
```

### 2. SSH туннель (на локальной машине)

**Откройте новый терминал на Mac:**

```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 3000:localhost:3000 -N vladx@46.250.228.229
```

**Параметры:**
- `-L 3000:localhost:3000` - проброс локального порта 3000 на сервер порт 3000
- `-N` - не выполнять команды, только туннель
- Оставьте терминал открытым

### 3. Запуск Dev сервера (на сервере)

```bash
# Убедитесь, что используется правильная версия Node.js
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
node --version  # Должна быть v24.x.x

# Запустить dev сервер
npm run dev
```

### 4. Доступ к Dev серверу

Откройте в браузере на **вашем Mac**:
- **http://localhost:3000/blog**
- **http://localhost:3000/blog/[slug]**

---

## Альтернатива: Через Docker (если нужно)

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro

# Перезапустить контейнер с проброшенным портом
docker-compose down
docker-compose up -d

# Запустить dev сервер в контейнере
docker exec -it autoro-blog-nextjs npm run dev
```

---

## Остановка

**Остановить dev сервер:** `Ctrl+C` в терминале сервера

**Остановить SSH туннель:** `Ctrl+C` в терминале с туннелем

---

**Готово!** Теперь можно разрабатывать.

