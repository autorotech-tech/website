#!/bin/bash
# Скрипт установки Outline VPN Server на ваш сервер
# Запуск: скопировать на сервер и выполнить с sudo, либо через ssh:
#   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 'bash -s' < outline_vpn_install.sh

set -e

HOSTNAME="${OUTLINE_HOSTNAME:-46.250.228.229}"
SHADOWBOX_DIR="${SHADOWBOX_DIR:-/opt/outline}"
API_PORT="${API_PORT:-8081}"
KEYS_PORT="${KEYS_PORT:-8388}"

echo "=== Outline VPN Server Install ==="
echo "Hostname: $HOSTNAME"
echo "Directory: $SHADOWBOX_DIR"
echo "API port: $API_PORT, Keys port: $KEYS_PORT"
echo ""

# Проверка прав
if [ "$EUID" -ne 0 ]; then
  echo "Запустите скрипт с sudo: sudo bash $0"
  exit 1
fi

# Установка Docker при необходимости
if ! command -v docker &> /dev/null; then
  echo "Установка Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker.service 2>/dev/null || true
fi

# Добавление пользователя в группу docker
CURRENT_USER="${SUDO_USER:-$USER}"
if [ -n "$CURRENT_USER" ] && [ "$CURRENT_USER" != "root" ]; then
  usermod -aG docker "$CURRENT_USER" 2>/dev/null || true
fi

# Скачивание и запуск официального скрипта установки
echo "Установка Outline Server..."
export SHADOWBOX_DIR
export ACCESS_CONFIG="${SHADOWBOX_DIR}/access.txt"
mkdir -p "$SHADOWBOX_DIR"

# Неинтерактивный запуск (yes на все подтверждения)
wget -qO /tmp/install_server.sh \
  https://raw.githubusercontent.com/Jigsaw-Code/outline-server/master/src/server_manager/install_scripts/install_server.sh
chmod +x /tmp/install_server.sh

yes | /tmp/install_server.sh \
  --hostname="$HOSTNAME" \
  --api-port="$API_PORT" \
  --keys-port="$KEYS_PORT" \
  || true

# Проверка результата
if [ -f "$ACCESS_CONFIG" ]; then
  echo ""
  echo "=== Установка завершена ==="
  echo ""
  echo "Конфиг для Outline Manager (добавить сервер):"
  echo "---"
  cat "$ACCESS_CONFIG"
  echo "---"
  echo ""
  echo "Откройте порты в firewall:"
  echo "  - TCP $API_PORT (Management API)"
  echo "  - TCP $KEYS_PORT (Shadowsocks)"
  echo "  - UDP $KEYS_PORT (Shadowsocks)"
  echo ""
  echo "UFW: sudo ufw allow $API_PORT/tcp && sudo ufw allow $KEYS_PORT/tcp && sudo ufw allow $KEYS_PORT/udp && sudo ufw reload"
else
  echo "Возможна ошибка установки. Проверьте логи выше."
  echo "Попробуйте установить через Outline Manager: https://getoutline.org"
fi
