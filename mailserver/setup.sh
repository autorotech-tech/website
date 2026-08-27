#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f mailserver.env ]]; then
  cp mailserver.env.example mailserver.env
  echo "Создан mailserver.env из шаблона. Проверьте значения перед запуском."
fi

mkdir -p docker-data/mail-data docker-data/mail-state docker-data/mail-logs config

docker compose up -d mailserver

echo "Почтовый контейнер запущен."
echo "Добавьте пользователя (пример):"
echo "  docker exec -it autoro-mailserver setup email add admin@autoro.tech 'CHANGEME_STRONG_PASSWORD'"
echo "Сгенерируйте DKIM:"
echo "  docker exec -it autoro-mailserver setup config dkim"
echo ""
echo "=== DNS для autoro.tech ==="
echo "A      mail.autoro.tech -> <IP_СЕРВЕРА>"
echo "MX     autoro.tech      -> mail.autoro.tech (priority 10)"
echo "TXT    autoro.tech      -> v=spf1 mx -all"
echo "TXT    _dmarc.autoro.tech -> v=DMARC1; p=quarantine; rua=mailto:postmaster@autoro.tech; adkim=s; aspf=s"
echo "TXT    mail._domainkey.autoro.tech -> (значение из config/opendkim/keys/autoro.tech/mail.txt)"
echo ""
echo "=== После добавления DNS ==="
echo "1) Перезапустите контейнер: docker compose restart mailserver"
echo "2) Проверьте DNS:"
echo "   dig +short A mail.autoro.tech"
echo "   dig +short MX autoro.tech"
echo "   dig +short TXT autoro.tech"
echo "   dig +short TXT _dmarc.autoro.tech"
echo "   dig +short TXT mail._domainkey.autoro.tech"
echo ""
echo "3) Проверьте SMTP с сервера:"
echo "   openssl s_client -starttls smtp -connect mail.autoro.tech:587 -servername mail.autoro.tech"
