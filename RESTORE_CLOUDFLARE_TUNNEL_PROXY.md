# Восстановление настроек Cloudflare Tunnel Proxy на Mac

## Информация о сервере

- **Host:** 46.250.228.229
- **Port:** 22
- **User:** vladx
- **SSH Key:** ~/.ssh/id_ed25519_autoro

## Настройка SSH config для Cloudflare Tunnel

### Шаг 1: Отредактировать SSH config

```bash
nano ~/.ssh/config
```

### Шаг 2: Добавить конфигурацию для Cloudflare Tunnel

Добавьте следующие строки в `~/.ssh/config`:

```
Host autoro-tunnel
    HostName 46.250.228.229
    User vladx
    IdentityFile ~/.ssh/id_ed25519_autoro
    ProxyCommand cloudflared access ssh --hostname %h
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Или если используете стандартный SSH через Cloudflare Tunnel:

```
Host autoro
    HostName 46.250.228.229
    User vladx
    IdentityFile ~/.ssh/id_ed25519_autoro
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

### Шаг 3: Проверить наличие cloudflared

```bash
which cloudflared
```

Если cloudflared не установлен:

```bash
# Установка через Homebrew
brew install cloudflare/cloudflare/cloudflared
```

### Шаг 4: Подключиться

```bash
ssh autoro-tunnel
# или
ssh autoro
```

## Альтернатива: Прямое подключение через SSH

Если Cloudflare Tunnel не нужен для SSH:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

## Настройка через System Settings (macOS)

Если настраивался через системные настройки macOS:

1. **System Settings** → **Network**
2. Найти и настроить **Proxy** settings
3. Обычно используется:
   - **SOCKS Proxy** или **HTTP Proxy**
   - **Server:** 127.0.0.1
   - **Port:** зависит от конфигурации tunnel

## Проверка активных tunnel

На сервере:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cloudflared tunnel list
ps aux | grep cloudflared
```

## Дополнительная информация

См. файл `CLOUDFLARE_TUNNEL_PROXY_SETUP.md` для подробной информации о первоначальной настройке.


