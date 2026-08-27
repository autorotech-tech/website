# Настройка Cloudflare Tunnel Proxy на Mac

## Общая информация

Cloudflare Tunnel обычно запускается с режимом `proxy-dns` или `proxy`, который создает локальный прокси для маршрутизации трафика.

## Варианты настройки

### Вариант 1: Cloudflared как локальный прокси (proxy-dns режим)

Если tunnel запущен в режиме `proxy-dns`, он обычно работает на:
- **Порт:** `localhost:53` (DNS) или `localhost:8080` (HTTP/SOCKS)

### Вариант 2: SOCKS5 прокси через SSH

Если нужно использовать SSH как SOCKS5 прокси:

```bash
ssh -i ~/.ssh/id_ed25519_autoro -D 1080 -N vladx@46.250.228.229
```

Затем в настройках Mac:
- **SOCKS Proxy:** `127.0.0.1:1080`

### Вариант 3: Cloudflared с proxy режимом

Если cloudflared запущен с `--proxy-port`, обычно это:
- **Порт:** `localhost:8080` или `localhost:8081`

## Шаги для настройки на Mac

### 1. Проверить, запущен ли tunnel на сервере

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
systemctl status cloudflared
# или
ps aux | grep cloudflared
```

### 2. Узнать порт прокси

Если tunnel запущен, нужно узнать на каком порту он слушает.

### 3. Настроить прокси в Mac

**System Settings → Network → [Ваше подключение] → Details → Proxies**

Или через терминал:
```bash
networksetup -setwebproxy "Wi-Fi" 127.0.0.1 8080
networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 8080
networksetup -setsocksfirewallproxy "Wi-Fi" 127.0.0.1 1080
```

### 4. Исключения (если нужно)

Для исключения определенных доменов:
```bash
networksetup -setproxybypassdomains "Wi-Fi" "*.local" "169.254/16"
```

## Типичные порты Cloudflare Tunnel

- **DNS (proxy-dns):** `localhost:53` или `localhost:5053`
- **HTTP Proxy:** `localhost:8080`
- **SOCKS5 Proxy:** `localhost:1080`

## Быстрая проверка

Проверить, работает ли прокси:
```bash
curl --proxy socks5h://127.0.0.1:1080 http://ifconfig.me
# или
curl --proxy http://127.0.0.1:8080 http://ifconfig.me
```

