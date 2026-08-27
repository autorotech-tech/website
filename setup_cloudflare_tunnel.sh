#!/bin/bash
# Скрипт для настройки Cloudflare Tunnel на сервере

set -e

echo "=== Настройка Cloudflare Tunnel ==="

# Проверка установки cloudflared
if [ ! -f ~/bin/cloudflared ]; then
    echo "Установка cloudflared..."
    mkdir -p ~/bin
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/bin/cloudflared
    chmod +x ~/bin/cloudflared
    echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
    export PATH="$HOME/bin:$PATH"
fi

# Добавляем в PATH
export PATH="$HOME/bin:$PATH"

echo ""
echo "Шаг 1: Логин в Cloudflare"
echo "Открой браузер и авторизуйся в Cloudflare..."
cloudflared tunnel login

echo ""
echo "Шаг 2: Создание туннеля"
read -p "Введи имя туннеля (например: autoro-tunnel): " TUNNEL_NAME
cloudflared tunnel create "$TUNNEL_NAME" || echo "Туннель уже существует"

echo ""
echo "Шаг 3: Получение Tunnel ID"
TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}' | head -1)
echo "Tunnel ID: $TUNNEL_ID"

if [ -z "$TUNNEL_ID" ]; then
    echo "Ошибка: не удалось получить Tunnel ID"
    exit 1
fi

echo ""
echo "Шаг 4: Создание конфига"
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  # API (Supabase/Kong)
  - hostname: api-autoro.bypass.tech
    service: http://localhost:54321
  
  # Swoop (Admin Panel)
  - hostname: swoop-autoro.bypass.tech
    service: http://localhost:8080
  
  # Main site
  - hostname: autoro.bypass.tech
    service: http://localhost:80
  
  # Blog API (через Nginx)
  - hostname: blog-api-autoro.bypass.tech
    service: http://localhost:80
  
  # Catch-all
  - service: http_status:404
EOF

echo "Конфиг создан: ~/.cloudflared/config.yml"

echo ""
echo "Шаг 5: Настройка DNS"
echo "В Cloudflare Dashboard для каждого домена создай CNAME запись:"
echo "  api-autoro.bypass.tech -> $TUNNEL_ID.cfargotunnel.com"
echo "  swoop-autoro.bypass.tech -> $TUNNEL_ID.cfargotunnel.com"
echo "  autoro.bypass.tech -> $TUNNEL_ID.cfargotunnel.com"
echo "  blog-api-autoro.bypass.tech -> $TUNNEL_ID.cfargotunnel.com"

read -p "Нажми Enter после настройки DNS..."

echo ""
echo "Шаг 6: Тестирование туннеля"
cloudflared tunnel run "$TUNNEL_NAME" &
TUNNEL_PID=$!
sleep 5

echo "Туннель запущен (PID: $TUNNEL_PID)"
echo ""
echo "Проверь доступность:"
echo "  https://api-autoro.bypass.tech"
echo "  https://swoop-autoro.bypass.tech"
echo ""
echo "Для автозапуска создай systemd service или используй screen/tmux"

