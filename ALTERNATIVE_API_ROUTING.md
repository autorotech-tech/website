# Альтернативный подход: Прямой доступ к API без CDN

## Проблема с текущей архитектурой

Текущая архитектура: `Browser → GCore CDN → nginx-proxy → Next.js`

Проблемы:
- Сложная конфигурация кеширования для API
- Редиректы могут кешироваться
- API запросы не должны кешироваться

## Решение: Разделить API и статику

### Вариант 1: Прямой доступ к API через autoro.tech

**Настройка:**
- API: `https://autoro.tech/api/blog/admin/*` → напрямую через nginx-proxy
- Статика блога: `https://cdn.autoro.tech/*` → через GCore CDN

**Преимущества:**
- ✅ API работает без проблем с кешем
- ✅ Статика кешируется через CDN
- ✅ Простая конфигурация
- ✅ Нет проблем с редиректами

**Недостатки:**
- ⚠️ API не проходит через CDN (но это нормально для API)

**Изменения в коде:**
```typescript
// Вместо:
const BLOG_API_URL = 'https://cdn.autoro.tech/api/blog'

// Использовать:
const BLOG_API_URL = 'https://autoro.tech/api/blog'
```

**Настройка nginx-proxy:**
Нужно добавить location `/api/blog/` для `autoro.tech`:
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
# Создать файл /tmp/autoro.tech_location с location /api/blog/
```

---

### Вариант 2: Отдельный поддомен для API

**Настройка:**
- API: `https://api-blog.autoro.tech/*` → напрямую через nginx-proxy
- Статика: `https://cdn.autoro.tech/*` → через GCore CDN

**Преимущества:**
- ✅ Четкое разделение API и статики
- ✅ API не проходит через CDN
- ✅ Можно настроить отдельные правила безопасности

**Недостатки:**
- ⚠️ Нужен дополнительный поддомен
- ⚠️ Нужен SSL сертификат для api-blog.autoro.tech

**Настройка:**
1. В Cloudflare: добавить A-запись `api-blog` → `46.250.228.229` (Proxied)
2. В docker-compose.yml блога: добавить `VIRTUAL_HOST=api-blog.autoro.tech`
3. В коде: изменить `BLOG_API_URL` на `https://api-blog.autoro.tech`

---

### Вариант 3: Отключить GCore CDN для API через Rules

Если в GCore CDN есть возможность создать правило, которое отключает CDN для `/api/*`:

1. Создать правило в GCore CDN:
   - Pattern: `/api/*`
   - Action: Bypass CDN (если доступно)
   - Или: Disable caching, disable redirects

2. Проверить, есть ли такая возможность в GCore CDN Rules

---

## Рекомендация

**Использовать Вариант 1** (прямой доступ через autoro.tech):
- Проще всего реализовать
- Не требует дополнительных доменов
- API не должен кешироваться, поэтому CDN не нужен
- Статика может оставаться через CDN

---

## Шаги для реализации Варианта 1

1. **Найти где используется BLOG_API_URL:**
   ```bash
   grep -r "cdn.autoro.tech/api/blog" website/src/
   ```

2. **Заменить на autoro.tech:**
   ```typescript
   const BLOG_API_URL = 'https://autoro.tech/api/blog'
   ```

3. **Убедиться, что nginx-proxy обрабатывает /api/blog/ для autoro.tech:**
   - Файл `/etc/nginx/vhost.d/autoro.tech_location` уже создан
   - Проверить, что он правильно настроен

4. **Пересобрать фронтенд (если нужно)**

5. **Проверить работу:**
   ```bash
   curl -I 'https://autoro.tech/api/blog/admin/posts?page=1&limit=20' \
     -H 'Origin: https://swoop.autoro.tech'
   ```


