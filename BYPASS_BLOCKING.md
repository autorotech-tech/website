# Решение для обхода блокировки провайдера

## Проблема
Провайдер блокирует:
- VPN
- WireGuard
- Прямое соединение с autoro.tech

## Решение 1: Cloudflare Tunnel (Рекомендуется)

Cloudflare Tunnel использует HTTPS/HTTP2, а не WireGuard, и часто обходит блокировки.

### Настройка на сервере

```bash
# Установка cloudflared на сервере
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Логин в Cloudflare
cloudflared tunnel login

# Создание туннеля
cloudflared tunnel create autoro-tunnel

# Получить Tunnel ID
cloudflared tunnel list

# Создать конфиг
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: <TUNNEL_ID>
credentials-file: /home/vladx/.cloudflared/<TUNNEL_ID>.json

ingress:
  # API
  - hostname: api-autoro.bypass.tech
    service: http://localhost:54321
  # Swoop
  - hostname: swoop-autoro.bypass.tech
    service: http://localhost:8080
  # Main site
  - hostname: autoro.bypass.tech
    service: http://localhost:80
  # Catch-all
  - service: http_status:404
EOF

# Настроить DNS в Cloudflare Dashboard
# Для каждого hostname: CNAME -> <TUNNEL_ID>.cfargotunnel.com

# Запустить туннель
cloudflared tunnel run autoro-tunnel
```

### Автозапуск через systemd

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

## Решение 2: Использование альтернативного домена

Если у тебя есть другой домен, можно настроить его через Cloudflare Workers.

### Вариант A: Cloudflare Workers (прокси)

1. Создать Worker в Cloudflare Dashboard
2. Настроить как прокси на `autoro.tech`
3. Использовать новый домен для доступа

### Вариант B: DNS-записи на другой IP

Если у тебя есть другой сервер/IP, можно временно перенаправить DNS.

## Решение 3: Мобильный интернет / Hotspot

Если блокировка только на стационарном интернете, используй мобильный интернет или hotspot.

## Решение 4: HTTP/HTTPS прокси на другом сервере

Если у тебя есть другой сервер (не заблокированный), можно настроить простой HTTP-прокси.

## Рекомендация

Используй **Решение 1 (Cloudflare Tunnel)** - это самое надежное и простое решение, которое работает поверх стандартного HTTPS и обычно обходит блокировки провайдеров.

