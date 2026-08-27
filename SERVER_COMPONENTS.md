# Список компонентов и контейнеров на сервере

## Установленные компоненты:
- Docker / Docker Compose
- Nginx (в контейнере)
- PostgreSQL (Supabase)
- Node.js приложения (blog, frontend)

## Контейнеры:
См. вывод команды `docker ps -a`

## Конфигурации для сохранения после перезагрузки:
1. **Nginx конфигурация:** `/home/vladx/projects/autoro.tech/html/default.conf` и `nginx.conf`
   - Монтируется через volumes в docker-compose.yml
   - Автоматически подхватывается при старте контейнера

2. **Docker Compose:** `/home/vladx/projects/autoro.tech/docker-compose.yml`
   - Запускается через `docker-compose up -d`
   - Можно добавить в systemd для автозапуска

3. **Статические файлы:** `/home/vladx/projects/autoro.tech/html/`
   - Монтируются в контейнер через volume

## Для автозапуска после перезагрузки:
```bash
# Создать systemd service для docker-compose
sudo nano /etc/systemd/system/autoro-site.service
```

```ini
[Unit]
Description=Autoro Site Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/vladx/projects/autoro.tech
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable autoro-site.service
```

