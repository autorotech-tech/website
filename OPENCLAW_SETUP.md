# Инструкция по использованию OpenClaw

## 📋 Содержание
1. [Запуск OpenClaw Gateway](#1-запуск-openclaw-gateway)
2. [Настройка Telegram бота](#2-настройка-telegram-бота)
3. [Настройка веб-интерфейса на swoop.autoro.tech](#3-настройка-веб-интерфейса-на-swoopautorotech)
4. [Полезные команды](#4-полезные-команды)

---

## 1. Запуск OpenClaw Gateway

### Первый запуск (onboarding)

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/openclaw
./docker-setup.sh
```

**Рекомендуемые ответы в onboarding:**
- **Gateway bind:** `lan` (для доступа по локальной сети)
- **Gateway auth:** `token` (использовать токен для доступа)
- **Tailscale exposure:** `Off` (не используем Tailscale)
- **Install Gateway daemon:** `No` (используем Docker Compose)

После завершения onboarding скрипт:
- Создаст `.env` файл с токеном
- Запустит gateway в Docker

### Проверка статуса

```bash
cd /home/vladx/openclaw
docker compose ps
docker compose logs -f openclaw-gateway
```

Gateway будет доступен на порту `18789` внутри Docker сети.

---

## 2. Настройка Telegram бота

### Шаг 1: Создание бота в Telegram

1. Откройте Telegram и найдите **@BotFather**
2. Отправьте команду `/newbot`
3. Следуйте инструкциям:
   - Придумайте имя бота (например: "AutoRo AI Assistant")
   - Придумайте username (должен заканчиваться на `bot`, например: `autorotech_bot`)
4. **Сохраните токен** вида `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### Шаг 2: Настройка бота в OpenClaw

```bash
cd /home/vladx/openclaw

# Добавить Telegram канал с токеном
docker compose run --rm openclaw-cli channels add \
  --channel telegram \
  --token "ВАШ_ТОКЕН_ОТ_BOTFATHER"
```

Или отредактируйте конфиг вручную:

```bash
# Открыть конфиг
nano ~/.openclaw/openclaw.json
```

Добавьте в конфиг:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "ВАШ_ТОКЕН_ОТ_BOTFATHER",
      "dmPolicy": "pairing",
      "groups": {
        "*": {
          "requireMention": true
        }
      }
    }
  }
}
```

### Шаг 3: Перезапуск gateway

```bash
cd /home/vladx/openclaw
docker compose restart openclaw-gateway
```

### Шаг 4: Подключение к боту (pairing)

1. Найдите вашего бота в Telegram по username
2. Отправьте ему любое сообщение
3. Проверьте код pairing:

```bash
cd /home/vladx/openclaw
docker compose run --rm openclaw-cli pairing list telegram
```

Вы увидите что-то вроде:
```
telegram: CODE123
```

4. Одобрите pairing:

```bash
docker compose run --rm openclaw-cli pairing approve telegram CODE123
```

Теперь бот будет отвечать на ваши сообщения!

### Шаг 5: Настройка для групп (опционально)

Если хотите использовать бота в группах:

1. Добавьте бота в группу
2. В BotFather выполните `/setprivacy` → **Disable** (чтобы бот видел все сообщения)
3. Удалите и снова добавьте бота в группу
4. Обновите конфиг:

```json
{
  "channels": {
    "telegram": {
      "groups": {
        "ВАШ_GROUP_ID": {
          "requireMention": false,
          "groupPolicy": "open"
        }
      }
    }
  }
}
```

Чтобы узнать ID группы:
- Перешлите сообщение из группы боту `@userinfobot`
- Или проверьте логи: `docker compose logs -f openclaw-gateway`

---

## 3. Настройка веб-интерфейса на swoop.autoro.tech

### Шаг 1: Настройка nginx для проксирования

OpenClaw Control UI работает на порту `18789` внутри Docker. Нужно настроить nginx для проксирования на `swoop.autoro.tech/openclaw`.

#### Вариант A: Создать отдельный конфиг для swoop.autoro.tech

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Создать конфигурацию (нужны права sudo)
sudo nano /home/vladx/projects/nginx/conf.d/swoop.autoro.tech.conf
```

Добавьте конфигурацию:

```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name swoop.autoro.tech;
    
    # SSL сертификаты (используйте существующие для autoro.tech)
    ssl_certificate /etc/letsencrypt/live/swoop.autoro.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/swoop.autoro.tech/privkey.pem;
    
    # Проксирование OpenClaw Control UI
    location /openclaw/ {
        proxy_pass http://127.0.0.1:18789/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket поддержка (важно для OpenClaw)
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Остальные маршруты для swoop.autoro.tech (если есть)
    location / {
        # Ваша существующая конфигурация для swoop
        # proxy_pass http://127.0.0.1:ВАШ_ПОРТ;
        root /usr/share/nginx/html;
        index index.html;
    }
}
```

#### Вариант B: Добавить location в существующий конфиг

Если у вас уже есть конфигурация для `swoop.autoro.tech`, просто добавьте location блок:

```nginx
location /openclaw/ {
    proxy_pass http://127.0.0.1:18789/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}
```

После создания/изменения конфига:

```bash
# Проверить конфигурацию
sudo nginx -t

# Перезагрузить nginx
sudo systemctl reload nginx

# Или если используете Docker nginx
docker compose restart nginx-proxy
```

### Шаг 2: Альтернатива - встроить в существующий nginx

Если у вас уже есть конфигурация для `swoop.autoro.tech`, просто добавьте location блок:

```nginx
location /openclaw/ {
    proxy_pass http://127.0.0.1:18789/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
}
```

### Шаг 3: Проверка доступности порта

Убедитесь, что порт `18789` доступен на хосте:

```bash
cd /home/vladx/openclaw

# Проверить, что контейнер слушает порт
docker compose ps
docker compose port openclaw-gateway 18789

# Проверить доступность
curl http://127.0.0.1:18789
```

Если порт не проброшен наружу, проверьте `docker-compose.yml`:

```bash
cat docker-compose.yml | grep -A 5 "ports:"
```

Если порт не проброшен, обновите `docker-compose.yml`:

```yaml
services:
  openclaw-gateway:
    ports:
      - "127.0.0.1:18789:18789"  # Только localhost (рекомендуется для безопасности)
```

После изменения перезапустите:

```bash
docker compose up -d openclaw-gateway
```

### Шаг 3.5: SSL сертификат для swoop.autoro.tech

Если у вас еще нет SSL сертификата для `swoop.autoro.tech`:

```bash
# Установить certbot (если еще не установлен)
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Получить сертификат
sudo certbot --nginx -d swoop.autoro.tech

# Или только получить сертификат без автоматической настройки nginx
sudo certbot certonly --nginx -d swoop.autoro.tech
```

Certbot автоматически обновит конфигурацию nginx или создаст сертификаты в `/etc/letsencrypt/live/swoop.autoro.tech/`.

### Шаг 4: Получение токена для веб-интерфейса

```bash
cd /home/vladx/openclaw
cat .env | grep OPENCLAW_GATEWAY_TOKEN
```

Или через CLI:

```bash
docker compose run --rm openclaw-cli dashboard --no-open
```

### Шаг 5: Доступ к веб-интерфейсу

1. Откройте в браузере: `https://swoop.autoro.tech/openclaw/`
2. Введите токен из `.env` файла
3. Готово! Вы можете общаться с ассистентом через веб-интерфейс

---

## 4. Полезные команды

### Управление gateway

```bash
cd /home/vladx/openclaw

# Запуск
docker compose up -d openclaw-gateway

# Остановка
docker compose stop openclaw-gateway

# Перезапуск
docker compose restart openclaw-gateway

# Логи
docker compose logs -f openclaw-gateway

# Статус
docker compose ps
```

### Работа с Telegram

```bash
# Проверить статус каналов
docker compose run --rm openclaw-cli channels status

# Отправить тестовое сообщение
docker compose run --rm openclaw-cli message send \
  --channel telegram \
  --target @ваш_username \
  --message "Привет!"

# Список pending pairing запросов
docker compose run --rm openclaw-cli pairing list telegram

# Одобрить pairing
docker compose run --rm openclaw-cli pairing approve telegram CODE

# Логи Telegram канала
docker compose logs -f openclaw-gateway | grep telegram
```

### Работа с агентом

```bash
# Отправить сообщение агенту через CLI
docker compose run --rm openclaw-cli agent \
  --message "Что ты умеешь?" \
  --thinking high

# Проверить статус gateway
docker compose run --rm openclaw-cli gateway status

# Открыть dashboard
docker compose run --rm openclaw-cli dashboard --no-open
```

### Конфигурация

```bash
# Просмотр конфига
cat ~/.openclaw/openclaw.json

# Редактирование конфига
nano ~/.openclaw/openclaw.json

# После изменения конфига - перезапуск
docker compose restart openclaw-gateway
```

### Диагностика

```bash
# Проверка здоровья gateway
docker compose exec openclaw-gateway \
  node dist/index.js health \
  --token "$(grep OPENCLAW_GATEWAY_TOKEN .env | cut -d= -f2)"

# Проверка подключений
docker compose run --rm openclaw-cli doctor

# Логи с фильтрацией
docker compose logs -f openclaw-gateway | grep -i error
```

---

## 🔧 Решение проблем

### Бот не отвечает в Telegram

1. Проверьте статус канала:
   ```bash
   docker compose run --rm openclaw-cli channels status
   ```

2. Проверьте логи:
   ```bash
   docker compose logs -f openclaw-gateway | grep telegram
   ```

3. Убедитесь, что pairing выполнен:
   ```bash
   docker compose run --rm openclaw-cli pairing list telegram
   ```

### Веб-интерфейс не открывается

1. Проверьте, что gateway запущен:
   ```bash
   docker compose ps
   ```

2. Проверьте доступность порта:
   ```bash
   curl http://127.0.0.1:18789
   ```

3. Проверьте nginx конфигурацию:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. Проверьте логи nginx:
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

### Gateway не запускается

1. Проверьте логи:
   ```bash
   docker compose logs openclaw-gateway
   ```

2. Проверьте конфигурацию:
   ```bash
   docker compose run --rm openclaw-cli doctor
   ```

3. Проверьте переменные окружения:
   ```bash
   cat .env
   ```

---

## 📚 Дополнительные ресурсы

- [Документация OpenClaw](https://docs.openclaw.ai/)
- [Telegram канал документации](https://docs.openclaw.ai/channels/telegram)
- [Gateway конфигурация](https://docs.openclaw.ai/gateway/configuration)
- [Troubleshooting](https://docs.openclaw.ai/channels/troubleshooting)

---

## 🎯 Быстрый старт (TL;DR)

```bash
# 1. Подключиться к серверу
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# 2. Запустить onboarding
cd /home/vladx/openclaw && ./docker-setup.sh

# 3. Добавить Telegram бота
docker compose run --rm openclaw-cli channels add --channel telegram --token "ВАШ_ТОКЕН"

# 4. Перезапустить gateway
docker compose restart openclaw-gateway

# 5. Одобрить pairing (после отправки сообщения боту)
docker compose run --rm openclaw-cli pairing approve telegram CODE

# 6. Настроить nginx для swoop.autoro.tech/openclaw/
sudo nano /home/vladx/projects/nginx/conf.d/swoop.autoro.tech.conf
# (добавить location /openclaw/ блок)
sudo nginx -t && sudo systemctl reload nginx

# 7. Открыть веб-интерфейс
# https://swoop.autoro.tech/openclaw/
```

Готово! 🎉

---

## 📝 Важные примечания

### Порт уже настроен
В `docker-compose.yml` порт `18789` уже проброшен через переменную `OPENCLAW_GATEWAY_PORT`. После запуска gateway он будет доступен на `127.0.0.1:18789`.

### Безопасность
- Gateway токен хранится в `.env` файле - не публикуйте его
- Рекомендуется использовать `127.0.0.1:18789` (только localhost) для безопасности
- Веб-интерфейс должен быть доступен только через HTTPS с SSL сертификатом

### Troubleshooting
Если что-то не работает:
1. Проверьте логи: `docker compose logs -f openclaw-gateway`
2. Проверьте статус: `docker compose ps`
3. Проверьте конфиг: `docker compose run --rm openclaw-cli doctor`
4. Проверьте порт: `curl http://127.0.0.1:18789`
