# Выполненные фиксы безопасности

## ✅ Выполнено

### 1. SSH-усиление
**Статус:** ✅ Уже настроен правильно
- `PasswordAuthentication no` - пароли отключены
- `PermitRootLogin prohibit-password` - root только по ключам
- fail2ban установлен (требует sudo для управления)

**Рекомендация:** Настроить fail2ban через sudo (см. план ниже)

---

### 2. Удаление WordPress из pquoc.com
**Статус:** ✅ Выполнено
- Создан backup: `~/pquoc_wordpress_backup_YYYYMMDD_HHMMSS.tar.gz`
- Удалены файлы:
  - `wordpress/` папка
  - `wp-*.php` файлы
  - `wp-admin/`, `wp-content/`, `wp-includes/` папки
  - `readme.html`, `license.txt`, `index.php`

**Осталось:** Только папка `html/` с сайтом https://pquoc.com

---

### 3. Порты 8081, 8082, 8000
**Статус:** ⚠️ Требует действий

**Найдено:**
- **8081** → `compod-wordpress` (Docker контейнер)
- **8082** → `adesso-wordpress` (Docker контейнер)  
- **8000** → `chroma` (Docker контейнер) + `supabase-kong` (внутренний)

**Рекомендации:**

#### Вариант A: Закрыть порты через firewall (ufw)
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 8081/tcp
sudo ufw deny 8082/tcp
sudo ufw deny 8000/tcp
sudo ufw --force enable
```

#### Вариант B: Изменить Docker порты на localhost только
Найти docker-compose.yml файлы для этих контейнеров и изменить:
```yaml
ports:
  - "127.0.0.1:8081:80"  # Только локальный доступ
  - "127.0.0.1:8082:80"
  - "127.0.0.1:8000:8000"
```

---

### 4. Проблема с постами блога
**Статус:** ⚠️ Требует проверки

**Проверено:**
- `.env.production` должен содержать `VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog`
- Нужно проверить:
  1. Есть ли посты в базе данных
  2. Правильно ли работает API `https://cdn.autoro.tech/api/blog/admin/posts`
  3. Правильно ли фронтенд использует переменную окружения

**Следующие шаги:**
1. Проверить посты в Supabase через API
2. Проверить логи блога на ошибки
3. Убедиться, что фронтенд пересобран с правильным `.env.production`

---

## 📋 Оставшиеся задачи

### fail2ban настройка (требует sudo)
```bash
sudo tee /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s
maxretry = 3
bantime = 3600
EOF

sudo systemctl restart fail2ban
sudo fail2ban-client status sshd
```

### Закрыть порты 8081, 8082, 8000
- Выбрать вариант (ufw или Docker)
- Выполнить команды выше

### Проверить посты блога
- Проверить API: `curl https://cdn.autoro.tech/api/blog/admin/posts`
- Проверить базу данных напрямую
- Пересобрать фронтенд если нужно

### Обновить nginx и Docker образы
```bash
# Обновить nginx
docker pull nginx:alpine
cd /home/vladx/projects/autoro.tech && docker-compose pull && docker-compose up -d

# Обновить другие образы
docker images | grep -E "node|postgres" | awk '{print $1":"$2}' | xargs docker pull
```

---

## ✅ Итоги

1. ✅ **SSH** - уже настроен правильно
2. ✅ **WordPress удален** - backup создан, файлы удалены
3. ⚠️ **Порты** - нужно закрыть 8081, 8082, 8000
4. ⚠️ **fail2ban** - нужно настроить через sudo
5. ⚠️ **Посты блога** - нужно проверить API и базу данных
6. ⚠️ **Обновления** - нужно обновить nginx и Docker образы

