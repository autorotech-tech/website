# Восстановление настроек Core Tunnel (Cloudflare Tunnel) Proxy на Mac

## Информация о сервере

- **Host:** 46.250.228.229
- **Port:** 22
- **User:** vladx
- **SSH Key:** ~/.ssh/id_ed25519_autoro (или ~/.ssh/id_autoro)

## Варианты настройки Proxy

### Вариант 1: SOCKS5 Proxy через SSH (Простой способ)

Это создает локальный SOCKS5 прокси через SSH туннель:

#### Шаг 1: Запустить SSH SOCKS5 туннель

```bash
ssh -i ~/.ssh/id_ed25519_autoro -D 1080 -N -f vladx@46.250.228.229
```

Параметры:
- `-D 1080` - создает SOCKS5 прокси на порту 1080
- `-N` - не выполнять команды, только туннель
- `-f` - запустить в фоне

#### Шаг 2: Настроить прокси в Mac через терминал

Для Wi-Fi:
```bash
networksetup -setsocksfirewallproxy "Wi-Fi" 127.0.0.1 1080
networksetup -setsocksfirewallproxystate "Wi-Fi" on
```

Для Ethernet:
```bash
networksetup -setsocksfirewallproxy "Ethernet" 127.0.0.1 1080
networksetup -setsocksfirewallproxystate "Ethernet" on
```

#### Шаг 3: Исключения (если нужно)

Добавить домены, которые не должны идти через прокси:
```bash
networksetup -setproxybypassdomains "Wi-Fi" "*.local" "169.254/16" "*.autoro.tech"
```

#### Шаг 4: Отключить прокси (когда не нужен)

```bash
networksetup -setsocksfirewallproxystate "Wi-Fi" off
```

### Вариант 2: Настройка через System Settings (GUI)

1. Открой **System Settings** (Системные настройки)
2. Перейди в **Network** (Сеть)
3. Выбери активное подключение (Wi-Fi или Ethernet)
4. Нажми **Details** (Подробнее)
5. Перейди во вкладку **Proxies** (Прокси)
6. Включи **SOCKS Proxy**
7. Укажи:
   - **Server:** `127.0.0.1`
   - **Port:** `1080`
8. Нажми **OK**

### Вариант 3: Cloudflare Tunnel Proxy (если используется cloudflared)

Если на сервере запущен cloudflared в режиме proxy:

#### Шаг 1: Проверить, запущен ли cloudflared на Mac

```bash
which cloudflared
cloudflared --version
```

Если не установлен:
```bash
brew install cloudflare/cloudflare/cloudflared
```

#### Шаг 2: Запустить cloudflared proxy локально

```bash
cloudflared proxy-dns --port 5053
```

Или для HTTP прокси:
```bash
cloudflared proxy --port 8080
```

#### Шаг 3: Настроить в System Settings

**DNS Proxy:**
- System Settings → Network → DNS
- Добавить: `127.0.0.1:5053`

**HTTP Proxy:**
- System Settings → Network → Proxies
- SOCKS Proxy: `127.0.0.1:8080`

### Вариант 4: SSH Config с ProxyCommand (для SSH соединений)

Если нужно использовать прокси только для SSH:

Отредактируйте `~/.ssh/config`:

```bash
nano ~/.ssh/config
```

Добавьте или обновите:

```
Host autoro
    HostName 46.250.228.229
    User vladx
    IdentityFile ~/.ssh/id_ed25519_autoro
    IdentitiesOnly yes
    Port 22
    ServerAliveInterval 60
    ServerAliveCountMax 3
    # Опционально: SOCKS5 proxy для SSH
    # ProxyCommand nc -X 5 -x 127.0.0.1:1080 %h %p
```

## Проверка работы прокси

### Проверить, работает ли SOCKS5 прокси:

```bash
curl --socks5 127.0.0.1:1080 http://ifconfig.me
```

Или для проверки через прокси:
```bash
curl --proxy socks5h://127.0.0.1:1080 https://www.google.com
```

### Проверить текущие настройки прокси:

```bash
# Проверить SOCKS proxy
networksetup -getsocksfirewallproxy "Wi-Fi"

# Проверить HTTP proxy
networksetup -getwebproxy "Wi-Fi"

# Проверить, включен ли прокси
networksetup -getinfo "Wi-Fi"
```

## Управление SSH SOCKS5 туннелем

### Запустить в фоне:
```bash
ssh -i ~/.ssh/id_ed25519_autoro -D 1080 -N -f vladx@46.250.228.229
```

### Остановить туннель:
```bash
pkill -f "ssh.*-D 1080"
```

### Проверить, работает ли туннель:
```bash
ps aux | grep "ssh.*-D 1080" | grep -v grep
lsof -i :1080
```

## Рекомендуемый вариант

Для простого использования рекомендую **Вариант 1 (SOCKS5 через SSH)**:

1. Запустить SSH туннель: `ssh -i ~/.ssh/id_ed25519_autoro -D 1080 -N -f vladx@46.250.228.229`
2. Включить в System Settings → Network → Proxies → SOCKS Proxy: `127.0.0.1:1080`
3. Использовать для обхода блокировок

## Отключение прокси

Когда прокси больше не нужен:

```bash
# Отключить SOCKS proxy
networksetup -setsocksfirewallproxystate "Wi-Fi" off

# Остановить SSH туннель
pkill -f "ssh.*-D 1080"
```
