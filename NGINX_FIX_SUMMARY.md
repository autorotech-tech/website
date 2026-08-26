# Исправление Nginx конфигурации для Gcore CDN

## Проблемы, которые были исправлены:

### 1. ❌ Отсутствие location для статики
**Проблема:** Статические файлы (js, css, images) не обрабатывались отдельно, что приводило к 503 ошибкам.

**Решение:** Добавлен location блок для статики:
```nginx
location ~* \.(js|css|...|mp3|mp4|m4a|aac|ogg)$ {
    root   /usr/share/nginx/html;
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
}
```

### 2. ❌ Неправильный rewrite в location /blog
**Проблема:** `rewrite ^/api/blog/(.*) /api/$1 last;` был в `location /blog`, что неправильно.

**Решение:** Убран rewrite из `location /blog` (rewrite должен быть только в `/api/blog/`).

### 3. ❌ Неправильный порядок location блоков
**Проблема:** Более специфичные location должны быть выше общих.

**Решение:** Изменен порядок:
1. Статика (regex) - первый
2. `/api/blog/` - второй
3. `/blog` - третий
4. Мультиязычные `/XX/blog` - четвертый
5. `/` (root) - последний

### 4. ✅ Добавлены форматы аудио
Добавлены форматы: `m4a`, `aac`, `ogg` в pattern для статики.

---

## Новая структура конфигурации:

```nginx
server {
    listen 80;
    server_name ...;

    # 1. Статика (js, css, images, audio, video)
    location ~* \.(js|css|...|mp3|mp4|m4a|aac|ogg)$ {
        root /usr/share/nginx/html;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 2. Blog API (с CORS)
    location /api/blog/ {
        # CORS headers
        # rewrite для /api/blog/ → /api/
        # proxy_pass к blog container
    }

    # 3. Blog routing
    location /blog {
        # proxy_pass к blog container
    }

    # 4. Мультиязычные blog routes
    location ~ ^/(en|ru|es|it|fr|de|ko|zh|ja|vi|mn|kz)/blog {
        # proxy_pass к blog container
    }

    # 5. Root (HTML файлы)
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Проверка работы:

```bash
# Проверка статики
curl -I -H "Host: cdn.autoro.tech" http://localhost/static/js/main.js
# Ожидается: 200 OK, Cache-Control: public, immutable

# Проверка корня
curl -I -H "Host: cdn.autoro.tech" http://localhost/
# Ожидается: 200 OK, index.html

# Проверка API
curl -I -H "Host: cdn.autoro.tech" "http://localhost/api/blog/admin/posts?page=1&limit=20"
# Ожидается: 401 Unauthorized (нормально, нужен токен)

# Проверка блога
curl -I -H "Host: cdn.autoro.tech" http://localhost/blog
# Ожидается: 200 OK от blog container
```

---

## Следующие шаги:

1. ✅ Nginx конфигурация исправлена
2. ✅ Правило "Bypass API Cache" создано в Gcore
3. ✅ Правило "Static content" создано в Gcore
4. ⏳ Проверить работу через CDN после применения изменений
5. ⏳ Увеличить TTL для Static content в Gcore до 1 year

---

## Резюме:

- ✅ Статика теперь обрабатывается отдельно с правильным кешированием
- ✅ API правильно проксируется без лишних rewrite
- ✅ Порядок location блоков оптимизирован
- ✅ Добавлена поддержка всех аудио форматов

