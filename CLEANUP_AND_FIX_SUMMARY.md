# Очистка сервера и исправление 503

## Выполнено:

### 1. Очистка Docker:
- ✅ `docker system prune -f --volumes` - удалены неиспользуемые контейнеры, сети, volumes
- ✅ `docker builder prune -a -f` - очищен build cache
- ✅ Освобождено место на диске

### 2. Удаление WordPress:
- ✅ Удалена папка `wordpress` из `~/projects/pquoc.com`
- ✅ Удалены все `wp-*` файлы
- ✅ Удалены WordPress директории (`wp-admin`, `wp-content`, `wp-includes`)

### 3. Исправление конфигурации Nginx:
- ✅ Добавлен явный `location = /` с `try_files /index.html =404;`
- ✅ Упрощена конфигурация до минимума
- ✅ Regex location для статики отключен (для тестирования)

## Новая конфигурация location /:

```nginx
# Root - explicit redirect to index.html
location = / {
    root /usr/share/nginx/html;
    try_files /index.html =404;
}

# Root location - serve static files
location / {
    root /usr/share/nginx/html;
    index index.html index.htm;
}
```

## Проверка:

После перезагрузки сервера:
1. Проверить работу: `curl -I -H "Host: cdn.autoro.tech" http://127.0.0.1/`
2. Если 503 сохраняется, включить debug логи:
   ```bash
   docker exec autoro-site sed -i 's|error_log.*notice;|error_log /var/log/nginx/error.log debug;|' /etc/nginx/nginx.conf
   docker restart autoro-site
   docker logs autoro-site 2>&1 | tail -100
   ```

## Автозапуск:
- ✅ Systemd service создан: `/etc/systemd/system/autoro-site.service`
- ✅ Service включен: `systemctl enable autoro-site.service`
- ✅ Контейнеры поднимутся автоматически после перезагрузки

