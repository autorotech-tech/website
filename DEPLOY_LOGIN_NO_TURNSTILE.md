# Деплой Login без Turnstile и устранение 502

## Проблемы
1. **swoop.autoro.tech/login** — Turnstile всё ещё показывается (исправление в коде есть, нужен деплой)
2. **autoro.tech/en/blog** — 502 Bad Gateway

## ⚠️ Перед деплоем: проверка места на диске

Если при копировании файлов появляется `No space left on device`, освободите место:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "df -h && du -sh /home/vladx/* 2>/dev/null | sort -hr | head -10"
```

---

## 1. Деплой Login без Turnstile на swoop

### Вариант A: Если swoop = autoro-dashboard (Docker)

```bash
# С локальной машины
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

# Скопировать исправленный Login.tsx
scp -i ~/.ssh/id_ed25519_autoro \
  src/components/Login.tsx \
  vladx@46.250.228.229:/home/vladx/autoro-dashboard/src/components/

# На сервере: пересобрать и перезапустить контейнер
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'EOF'
cd /home/vladx/autoro-dashboard
docker compose build autoro-frontend --no-cache 2>/dev/null || docker-compose build autoro-frontend --no-cache
docker compose up -d autoro-frontend 2>/dev/null || docker-compose up -d autoro-frontend
EOF
```

### Вариант B: Если swoop развёрнут иначе (например, из projects/)

```bash
# Узнайте путь к источнику swoop на сервере, затем:
scp -i ~/.ssh/id_ed25519_autoro \
  src/components/Login.tsx \
  vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/src/components/

# Затем пересоберите и перезапустите приложение swoop (команда зависит от вашей настройки)
```

### Проверка
Откройте https://swoop.autoro.tech/login — виджет Turnstile (галочка "Success!") не должен отображаться.

---

## 2. Устранение 502 на autoro.tech/en/blog

502 означает: nginx получил запрос, но upstream не ответил или вернул ошибку.

### Диагностика на сервере

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# 1. Проверить, как раздаётся /blog
grep -r "blog\|en/blog" /etc/nginx/ /home/vladx/projects/nginx/ 2>/dev/null | head -30

# 2. Если blog проксируется на Next.js — проверить, что контейнер запущен
docker ps | grep -E 'blog|nextjs'

# 3. Логи nginx
sudo tail -50 /var/log/nginx/error.log
# или
docker logs <nginx-container> --tail 50 2>&1

# 4. Прямой запрос к origin (в обход CDN)
curl -I -H "Host: autoro.tech" http://127.0.0.1/en/blog
```

### Типичные причины 502

| Причина | Решение |
|---------|---------|
| Next.js блог не запущен | `docker start autoro-blog-nextjs` или аналог |
| Неверный proxy_pass | Проверить nginx config, порт и host |
| Файл blog.html отсутствует | Убедиться, что `/usr/share/nginx/html/blog.html` существует |
| CDN/GCore некорректно обращается к origin | Проверить Host header, SSL, настройки Origin в GCore |

### Если blog должен идти в Next.js

В `autoro-tech-nginx.conf` сейчас `/blog` и `/en/blog` отдаются как статические `blog.html`. Если в проде blog должен рендериться Next.js, нужно добавить proxy на соответствующий порт.

---

## Краткий чеклист

- [ ] Скопировать Login.tsx на сервер
- [ ] Пересобрать и перезапустить swoop (autoro-frontend / autoro-dashboard)
- [ ] Проверить https://swoop.autoro.tech/login — Turnstile пропал
- [ ] Проверить логи nginx и контейнеры для 502
- [ ] При необходимости запустить контейнер блога или поправить nginx
