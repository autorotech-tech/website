# План безопасных фиксов безопасности

## Текущее состояние

### Открытые порты:
- **22** (SSH) - нужен, но требует усиления
- **80** (HTTP) - нужен для сайта
- **8081** - нужно проверить и закрыть/ограничить
- **8082** - нужно проверить и закрыть/ограничить  
- **8000** - нужно проверить и закрыть/ограничить

### WordPress файлы:
- `/home/vladx/projects/pquoc.com/wordpress/` - папка WordPress
- `/home/vladx/projects/pquoc.com/wp-*` - файлы WordPress в корне

---

## План действий

### 1. SSH-усиление (БЕЗОПАСНО)

**Цель:** Усилить SSH без потери доступа

#### Шаг 1.1: Проверка текущей конфигурации
```bash
# Проверить текущие настройки SSH
cat /etc/ssh/sshd_config | grep -E "PasswordAuthentication|PermitRootLogin|PubkeyAuthentication"
```

#### Шаг 1.2: Создать backup конфигурации
```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup.$(date +%Y%m%d_%H%M%S)
```

#### Шаг 1.3: Проверить, что ключевая аутентификация работает
```bash
# Убедиться, что у пользователя vladx есть ~/.ssh/authorized_keys
ls -la ~/.ssh/authorized_keys
cat ~/.ssh/authorized_keys | wc -l  # Должно быть > 0
```

#### Шаг 1.4: Безопасное изменение конфигурации SSH
```bash
# Создать временный файл с изменениями
sudo tee /tmp/sshd_config_changes.txt << 'EOF'
# Disable password authentication (only keys)
PasswordAuthentication no
ChallengeResponseAuthentication no

# Disable root login
PermitRootLogin no

# Ensure key authentication is enabled
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Additional security
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

# Применить изменения через sed (безопаснее чем полная замена)
sudo sed -i.bak \
  -e 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' \
  -e 's/^#*PermitRootLogin.*/PermitRootLogin no/' \
  -e 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' \
  /etc/ssh/sshd_config

# Добавить новые настройки, если их нет
grep -q "^MaxAuthTries" /etc/ssh/sshd_config || echo "MaxAuthTries 3" | sudo tee -a /etc/ssh/sshd_config
grep -q "^ClientAliveInterval" /etc/ssh/sshd_config || echo "ClientAliveInterval 300" | sudo tee -a /etc/ssh/sshd_config
grep -q "^ClientAliveCountMax" /etc/ssh/sshd_config || echo "ClientAliveCountMax 2" | sudo tee -a /etc/ssh/sshd_config

# Проверить синтаксис
sudo sshd -t

# Если синтаксис OK, перезагрузить SSH (НЕ перезапускать сервер!)
sudo systemctl reload sshd
```

#### Шаг 1.5: Установить и настроить fail2ban
```bash
# Установить fail2ban
sudo apt update && sudo apt install -y fail2ban

# Создать локальную конфигурацию для SSH
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

# Запустить fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
sudo systemctl status fail2ban
```

**⚠️ ВАЖНО:** После изменений SSH:
1. НЕ закрывать текущую SSH сессию
2. Открыть НОВУЮ SSH сессию в другом терминале для проверки
3. Только после успешной проверки закрыть старую сессию

---

### 2. Закрыть/ограничить порты 8081, 8082, 8000

#### Шаг 2.1: Определить, что слушает на этих портах
```bash
# Проверить Docker контейнеры
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -E "8081|8082|8000"

# Проверить процессы
sudo netstat -tulpn | grep -E ":8081|:8082|:8000"
```

#### Шаг 2.2: Если это Docker контейнеры - изменить порты
```bash
# Найти docker-compose файлы с этими портами
find ~ -name "docker-compose.yml" -exec grep -l "8081\|8082\|8000" {} \;

# Изменить порты на localhost только (127.0.0.1:PORT:PORT)
# Например, в docker-compose.yml:
# ports:
#   - "127.0.0.1:8081:8081"  # Только локальный доступ
```

#### Шаг 2.3: Использовать firewall (ufw)
```bash
# Установить ufw если нет
sudo apt install -y ufw

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
sudo ufw status
```

---

### 3. Удалить WordPress файлы

#### Шаг 3.1: Создать backup (на всякий случай)
```bash
cd /home/vladx/projects/pquoc.com
tar -czf ~/pquoc_wordpress_backup_$(date +%Y%m%d_%H%M%S).tar.gz wordpress wp-*.php wp-admin wp-content wp-includes 2>/dev/null
```

#### Шаг 3.2: Удалить WordPress файлы
```bash
cd /home/vladx/projects/pquoc.com

# Удалить папку wordpress
rm -rf wordpress

# Удалить WordPress файлы в корне
rm -f wp-*.php wp-blog-header.php wp-links-opml.php wp-signup.php wp-trackback.php xmlrpc.php

# Удалить папки WordPress
rm -rf wp-admin wp-content wp-includes

# Удалить служебные файлы WordPress
rm -f readme.html license.txt index.php

# Проверить, что осталось только html
ls -la
```

---

### 4. Проверить проблему с постами блога

#### Шаг 4.1: Проверить API URL в фронтенде
```bash
# Проверить .env.production
cat /home/vladx/autoro-dashboard/.env.production | grep VITE_BLOG_API_URL

# Должно быть: VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog
```

#### Шаг 4.2: Проверить посты в базе данных
```bash
# Через Supabase API (если доступен)
curl -H "apikey: YOUR_ANON_KEY" \
     -H "Authorization: Bearer YOUR_JWT" \
     https://api.autoro.tech/rest/v1/blog_posts?select=id,title,status

# Или через Docker exec в PostgreSQL контейнер Supabase
docker exec $(docker ps | grep supabase_db | awk '{print $1}') \
  psql -U postgres -d postgres -c "SELECT id, title, status FROM blog_posts LIMIT 5;"
```

#### Шаг 4.3: Проверить логи блога
```bash
# Логи Next.js блога
docker logs autoro-blog-nextjs 2>&1 | tail -50 | grep -i "error\|post"

# Логи фронтенда
docker logs autoro-frontend 2>&1 | tail -50 | grep -i "blog\|api"
```

---

### 5. Обновить nginx и Docker образы

#### Шаг 5.1: Обновить nginx
```bash
# Проверить версию nginx
docker exec autoro-site nginx -v

# Обновить nginx образ (если используется Docker)
cd /home/vladx/projects/autoro.tech
docker-compose pull nginx
docker-compose up -d --build nginx
```

#### Шаг 5.2: Обновить базовые образы
```bash
# Обновить все Docker образы
docker images | grep -E "node|nginx|postgres" | awk '{print $1":"$2}' | xargs -I {} docker pull {}

# Пересобрать контейнеры с обновленными образами
cd /home/vladx/autoro-dashboard && docker-compose build --no-cache
cd /home/vladx/autoro-blog && docker-compose build --no-cache
```

---

## Порядок выполнения (БЕЗОПАСНЫЙ)

1. ✅ **SSH-усиление** (с проверкой в новой сессии)
2. ✅ **fail2ban** (защита от брутфорса)
3. ✅ **Удалить WordPress** (создать backup)
4. ✅ **Закрыть порты 8081/8082/8000** (через ufw или Docker)
5. ✅ **Проверить проблему с постами блога**
6. ✅ **Обновить nginx и Docker образы**

---

## Проверка после фиксов

```bash
# Проверить SSH доступ
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "echo 'SSH OK'"

# Проверить открытые порты
sudo ss -tulpn | grep -E ":22|:80|:8081|:8082|:8000"

# Проверить fail2ban
sudo fail2ban-client status sshd

# Проверить WordPress удален
ls /home/vladx/projects/pquoc.com/ | grep -E "wp-|wordpress"
```

