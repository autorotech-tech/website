#!/usr/bin/env bash
set -euo pipefail

# Управление magic-resume на VPS с локальной macOS машины.
# Примеры:
#   bash scripts/magic-resume-remote.sh install
#   bash scripts/magic-resume-remote.sh update
#   bash scripts/magic-resume-remote.sh logs
#   bash scripts/magic-resume-remote.sh tunnel

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
REMOTE_USER="${REMOTE_USER:-vladx}"
REMOTE_HOST="${REMOTE_HOST:-46.250.228.229}"
REMOTE_BASE_DIR="${REMOTE_BASE_DIR:-/home/vladx/apps/magic-resume}"
REMOTE_URL="https://github.com/JOYCEQL/magic-resume.git"

usage() {
  cat <<'EOF'
Usage:
  magic-resume-remote.sh <command>

Commands:
  install   Clone repo (or reset to origin/main), build and start
  update    Pull latest from main, rebuild and restart
  start     Start existing stack
  stop      Stop stack
  restart   Restart stack
  logs      Stream container logs
  status    Show container status
  tunnel    SSH tunnel: localhost:13000 -> VPS:3000
EOF
}

ssh_run() {
  ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 \
    -i "$SSH_KEY" "${REMOTE_USER}@${REMOTE_HOST}" "$@"
}

install_or_update_remote() {
  ssh_run "
    set -e;
    mkdir -p \"$(dirname "$REMOTE_BASE_DIR")\";
    if [ -d \"$REMOTE_BASE_DIR/.git\" ]; then
      cd \"$REMOTE_BASE_DIR\";
      git fetch --all;
      git reset --hard origin/main;
    else
      git clone \"$REMOTE_URL\" \"$REMOTE_BASE_DIR\";
      cd \"$REMOTE_BASE_DIR\";
    fi;
    docker-compose down || true;
    docker-compose up -d --build;
    docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -i magic || true;
    curl -sS -m 20 -D - http://localhost:3000/ -o /tmp/magic_resume_health.html | head -20;
  "
}

cmd="${1:-}"
case "$cmd" in
  install|update)
    install_or_update_remote
    ;;
  start)
    ssh_run "cd \"$REMOTE_BASE_DIR\" && docker-compose up -d"
    ;;
  stop)
    ssh_run "cd \"$REMOTE_BASE_DIR\" && docker-compose down"
    ;;
  restart)
    ssh_run "cd \"$REMOTE_BASE_DIR\" && docker-compose restart"
    ;;
  logs)
    ssh_run "cd \"$REMOTE_BASE_DIR\" && docker-compose logs -f --tail=200"
    ;;
  status)
    ssh_run "docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -i magic || true"
    ;;
  tunnel)
    echo "Open http://localhost:13000 after tunnel starts"
    exec ssh -N -L 13000:localhost:3000 -i "$SSH_KEY" "${REMOTE_USER}@${REMOTE_HOST}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
