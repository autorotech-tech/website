# Инструкции по закрытию портов 8081, 8082, 8000

## Текущая ситуация

**Открытые порты:**
- **8081** → `compod-wordpress` (Docker контейнер)
- **8082** → `adesso-wordpress` (Docker контейнер)
- **8000** → `chroma` (Docker контейнер)

**Локации docker-compose.yml:**
- `/home/vladx/projects/adesso.us/docker-compose.yml`
- `/home/vladx/projects/compod.us/docker-compose.yml`
- Нужно найти docker-compose.yml для `chroma`

---

## Вариант 1: Изменить порты в Docker (РЕКОМЕНДУЕТСЯ)

### Для compod-wordpress (порт 8081)

```bash
cd /home/vladx/projects/compod.us
# Отредактировать docker-compose.yml
# Найти строку с "8081:80" и изменить на "127.0.0.1:8081:80"
# Или полностью удалить строку ports, если не нужен внешний доступ

# Пример изменения:
# Было:
#   ports:
#     - "8081:80"
# Стало:
#   ports:
#     - "127.0.0.1:8081:80"  # Только локальный доступ

# Перезапустить контейнер
docker-compose down
docker-compose up -d
```

### Для adesso-wordpress (порт 8082)

```bash
cd /home/vladx/projects/adesso.us
# Аналогично изменить "8082:80" на "127.0.0.1:8082:80"
docker-compose down
docker-compose up -d
```

### Для chroma (порт 8000)

```bash
# Найти docker-compose.yml для chroma
find ~ -name "docker-compose.yml" -exec grep -l "chroma\|8000" {} \;

# Изменить "8000:8000" на "127.0.0.1:8000:8000"
# Перезапустить контейнер
```

---

## Вариант 2: Использовать firewall (ufw)

```bash
# Установить ufw если нет
sudo apt update && sudo apt install -y ufw

# Разрешить SSH (ВАЖНО - сделать ПЕРВЫМ!)
sudo ufw allow 22/tcp

# Разрешить HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Закрыть 8081, 8082, 8000 для внешнего доступа
sudo ufw deny 8081/tcp
sudo ufw deny 8082/tcp
sudo ufw deny 8000/tcp

# Включить firewall
sudo ufw --force enable

# Проверить статус
sudo ufw status
```

**⚠️ ВАЖНО:** После включения ufw убедись, что SSH доступен!

---

## Рекомендация

**Использовать Вариант 1 (Docker порты)** - это безопаснее и не требует настройки firewall на уровне системы.

Если эти WordPress сайты не используются, можно вообще остановить контейнеры:

```bash
# Остановить WordPress контейнеры
cd /home/vladx/projects/compod.us && docker-compose stop
cd /home/vladx/projects/adesso.us && docker-compose stop

# Или удалить полностью
cd /home/vladx/projects/compod.us && docker-compose down
cd /home/vladx/projects/adesso.us && docker-compose down
```

---

## Проверка после изменений

```bash
# Проверить открытые порты
sudo ss -tulpn | grep -E ":8081|:8082|:8000"

# Должно показать только 127.0.0.1 или ничего (если контейнеры остановлены)
```

