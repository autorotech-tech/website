# 🔌 Настройка SSH туннеля для Dev сервера

## Проблема

Dev сервер работает на `localhost:3000` внутри контейнера/сервера, но недоступен напрямую по `http://46.250.228.229:3000`.

## Решение: SSH туннель

### Вариант 1: SSH Port Forwarding (Рекомендуется)

**С локальной машины (Mac):**
```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 3000:localhost:3000 vladx@46.250.228.229
```

**После подключения:**
- Откройте в браузере: **http://localhost:3000**
- Все запросы будут перенаправлены на сервер

### Вариант 2: Фоновый туннель

```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 3000:localhost:3000 -N -f vladx@46.250.228.229
```

**Параметры:**
- `-L 3000:localhost:3000` - локальный порт 3000 → сервер localhost:3000
- `-N` - не выполнять команды, только туннель
- `-f` - запустить в фоне

**Остановка туннеля:**
```bash
ps aux | grep "ssh.*3000" | grep -v grep | awk '{print $2}' | xargs kill
```

### Вариант 3: Через Docker контейнер

Если dev сервер в Docker:
```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 3000:localhost:3000 vladx@46.250.228.229
# Затем на сервере:
docker exec -it autoro-blog-nextjs npm run dev
```

### Вариант 4: Прямое проброс порта в Docker

**На сервере:**
```bash
docker run -d -p 3000:3000 --name blog-dev autoro-blog-nextjs npm run dev
```

Но лучше использовать docker-compose с проброшенным портом.

## 🔧 Альтернатива: Настройка Nginx для dev сервера

Если нужен постоянный доступ через домен, можно настроить Nginx:

```nginx
server {
    listen 80;
    server_name dev.autoro.tech;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

**Рекомендация:** Используйте SSH туннель (Вариант 1) для разработки.

