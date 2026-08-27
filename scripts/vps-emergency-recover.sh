#!/usr/bin/env bash
# Экстренная диагностика и разгрузка VPS (46.250.228.229).
# Запускать НА СЕРВЕРЕ: через SSH (когда оживёт) или serial/VNC консоль провайдера.
set -euo pipefail

say() { printf '\n=== %s ===\n' "$*"; }

say "uptime / load"
uptime || true

say "memory"
free -h || true

say "disk"
df -h / /var/lib/docker 2>/dev/null || df -h /

say "OOM kills (recent)"
dmesg -T 2>/dev/null | grep -i 'killed process' | tail -10 || journalctl -k -n 50 2>/dev/null | grep -i oom | tail -10 || true

say "top memory consumers"
ps aux --sort=-%mem 2>/dev/null | head -12 || true

say "docker build / buildkit processes"
ps aux 2>/dev/null | grep -E 'docker build|buildkit|npm run build|node ' | grep -v grep | head -20 || true

say "docker containers"
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | head -25 || true

say "ssh / fail2ban"
systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null || true
if command -v fail2ban-client >/dev/null 2>&1; then
  fail2ban-client status sshd 2>/dev/null || fail2ban-client status 2>/dev/null || true
fi

say "RECOVERY: stop stuck docker builds"
pkill -f 'docker build' 2>/dev/null || true
docker builder prune -f 2>/dev/null || true

say "RECOVERY: optional light prune (no -a)"
docker system prune -f 2>/dev/null || true

say "RECOVERY: restart ssh"
sudo systemctl restart ssh 2>/dev/null || sudo systemctl restart sshd 2>/dev/null || true

say "RECOVERY: swoop frontend (fix-swoop-502)"
if [[ -f /home/vladx/autoro-dashboard/scripts/fix-swoop-502.sh ]]; then
  bash /home/vladx/autoro-dashboard/scripts/fix-swoop-502.sh || true
fi

say "local swoop check"
curl -sS -m 8 -o /dev/null -w 'swoop HTTP %{http_code}\n' http://127.0.0.1/ -H 'Host: swoop.autoro.tech' || echo 'curl failed'

say "done — try SSH from Mac again"
