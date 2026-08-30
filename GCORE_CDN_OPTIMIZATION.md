# Оптимизация Gcore CDN для повышения скорости

## Проблема
После подключения Gcore CDN значительно упала скорость загрузки.

## Причины замедления

### 1. Неправильные настройки кеширования
- API кешируется (не должен!)
- Статические файлы не кешируются
- Нет оптимизации для разных типов контента

### 2. Проблемы с Origin
- Медленный ответ от origin сервера
- Неправильная конфигурация проксирования
- Отсутствие keep-alive соединений

### 3. Неоптимальные настройки CDN
- Отсутствие сжатия (gzip/brotli)
- Неправильные TTL для кеша
- Отсутствие HTTP/2 или HTTP/3

---

## Решение: Оптимизация Gcore CDN

### Шаг 1: Настройка Cache Rules (КРИТИЧНО!)

В Gcore Dashboard → **Cache Rules**:

#### Правило 1: Bypass для API
```
Rule Name: Bypass API
Path: /api/*
Cache Behavior: Bypass Cache
TTL: 0
Enable: ON
Priority: 1 (высокий)
```

#### Правило 2: Кеширование статики
```
Rule Name: Cache Static Files
Path: /*.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp)
Cache Behavior: Cache
TTL: 31536000 (1 год)
Enable: ON
Priority: 2
```

#### Правило 3: Кеширование HTML
```
Rule Name: Cache HTML
Path: /*.html
Cache Behavior: Cache
TTL: 3600 (1 час)
Enable: ON
Priority: 3
```

#### Правило 4: Кеширование блога (страницы постов)
```
Rule Name: Cache Blog Pages
Path: /blog/*
Cache Behavior: Cache
TTL: 1800 (30 минут)
Enable: ON
Priority: 4
```

---

### Шаг 2: Настройка Compression (Сжатие)

В Gcore Dashboard → **Compression**:

1. **Enable Compression:** ✅ ON
2. **Compression Level:** Medium (6)
3. **Compressible Types:**
   - `text/html`
   - `text/css`
   - `text/javascript`
   - `application/javascript`
   - `application/json`
   - `text/xml`
   - `application/xml`

---

### Шаг 3: Настройка Origin

В Gcore Dashboard → **Origin**:

1. **Origin Group:**
   - IP: `46.250.228.229`
   - Port: `80`
   - Host Header: `autoro.tech` (или `cdn.autoro.tech`)

2. **Origin Settings:**
   - **Connection Timeout:** 10s (уменьшить с 30s)
   - **Read Timeout:** 30s
   - **Keep-Alive:** ✅ Enable
   - **Max Connections:** 100

---

### Шаг 4: Настройка HTTP/2 и HTTP/3

В Gcore Dashboard → **Protocols**:

1. **HTTP/2:** ✅ Enable
2. **HTTP/3 (QUIC):** ✅ Enable (если доступно)

---

### Шаг 5: Оптимизация Nginx на Origin

На сервере (`/home/vladx/projects/autoro.tech/html/default.conf`):

```nginx
# Добавить в http блок
http {
    # Keep-alive для CDN
    keepalive_timeout 65;
    keepalive_requests 100;
    
    # Сжатие
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/json application/javascript application/xml+rss 
               application/rss+xml font/truetype font/opentype 
               application/vnd.ms-fontobject image/svg+xml;
    
    # Кеширование для статики
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
}
```

---

### Шаг 6: Проверка производительности

#### Тест 1: Прямой доступ к origin
```bash
curl -w "Time: %{time_total}s\n" -o /dev/null -s \
  "http://46.250.228.229/api/blog/admin/posts?page=1&limit=20"
```

#### Тест 2: Через CDN
```bash
curl -w "Time: %{time_total}s\n" -o /dev/null -s \
  "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"
```

#### Тест 3: Статические файлы через CDN
```bash
curl -w "Time: %{time_total}s\n" -o /dev/null -s \
  "https://cdn.autoro.tech/static/js/main.js"
```

---

## Дополнительные оптимизации

### 1. Использование ближайшего Edge Location

В Gcore Dashboard → **Edge Locations**:
- Выбери ближайшие к твоей аудитории локации
- Отключи ненужные (экономия)

### 2. Настройка Prefetch

Для блога можно добавить prefetch для популярных страниц:
```html
<link rel="prefetch" href="/blog/popular-post">
```

### 3. Минификация статики

Убедись, что JS/CSS минифицированы:
- Next.js делает это автоматически в production
- Проверь build конфигурацию

---

## Мониторинг производительности

### Gcore Analytics

В Gcore Dashboard → **Analytics**:
- **Response Time:** должен быть < 200ms для кешированного контента
- **Cache Hit Ratio:** должен быть > 80% для статики
- **Bandwidth:** проверь использование

### Google PageSpeed Insights

Проверь сайт:
```
https://pagespeed.web.dev/analysis?url=https://cdn.autoro.tech
```

---

## Быстрое решение (если ничего не помогает)

### Вариант 1: Отключить CDN для API
Используй прямой доступ к origin для API:
```javascript
// В .env.production
VITE_BLOG_API_URL=https://autoro.tech/api/blog
// Вместо
VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog
```

### Вариант 2: Использовать Bunny CDN
Bunny CDN может быть быстрее для небольших проектов:
- Первые 10GB бесплатно
- Проще настройка
- Хорошая производительность

---

## Итоговый чеклист

- [ ] Настроены Cache Rules (Bypass для API, Cache для статики)
- [ ] Включено сжатие (Compression)
- [ ] Оптимизированы настройки Origin (Keep-Alive, Timeouts)
- [ ] Включены HTTP/2 и HTTP/3
- [ ] Оптимизирован Nginx на origin (gzip, keepalive)
- [ ] Проверена производительность (тесты)
- [ ] Проверен Cache Hit Ratio в Analytics

---

## Ожидаемые результаты

После оптимизации:
- ✅ **Статика:** < 100ms (кешируется)
- ✅ **API:** < 500ms (не кешируется, но оптимизирован origin)
- ✅ **HTML:** < 200ms (кешируется на 30-60 минут)
- ✅ **Cache Hit Ratio:** > 80%

---

## Если проблема не решена

1. Проверь логи Gcore CDN (Dashboard → Logs)
2. Проверь логи Nginx на origin
3. Используй прямой доступ к origin для API
4. Рассмотри альтернативу (Bunny CDN, Cloudflare)

