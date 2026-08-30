# Настройка CNAME для Gcore CDN в Cloudflare

## Инструкция по добавлению CNAME записи

### Вариант 1: CNAME для основного домена (autoro.tech)

**Внимание:** Если используешь `autoro.tech` как основной домен в Gcore CDN, то нужно заменить A-запись на CNAME.

1. Зайди в **Cloudflare Dashboard**
2. Выбери домен **autoro.tech**
3. Перейди в **DNS** → **Records**
4. Найди существующую **A-запись** для `autoro.tech`
5. Нажми на неё → **Edit** или **Delete** (зависит от того, нужно ли сохранить оригинальный IP)

6. Создай новую **CNAME запись**:
   ```
   Type: CNAME
   Name: @ (или autoro.tech)
   Target: cl-glc03b3ef4.gcdn.co
   Proxy status: 🟠 Proxied (оранжевое облако) - ВАЖНО для CDN!
   TTL: Auto
   ```

7. Сохрани

**⚠️ Внимание:** Если у тебя уже есть A-запись для `autoro.tech`, её нужно либо удалить, либо временно отключить (если нужен fallback).

---

### Вариант 2: CNAME для поддомена (РЕКОМЕНДУЕТСЯ)

**Лучше создать поддомен для CDN**, чтобы не трогать основной домен:

1. В Cloudflare Dashboard → **DNS** → **Records** → **Add record**
2. Создай CNAME:
   ```
   Type: CNAME
   Name: cdn (или api-cdn)
   Target: cl-glc03b3ef4.gcdn.co
   Proxy status: 🟠 Proxied
   TTL: Auto
   ```

3. Получишь домен: `cdn.autoro.tech` (или `api-cdn.autoro.tech`)

4. В Gcore CDN добавь этот домен как **Custom Hostname**:
   - В CDN ресурсе → **Hostnames** → **Add Hostname**
   - Введи: `cdn.autoro.tech`
   - SSL будет автоматически

5. В `.env.production` используй:
   ```bash
   VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog
   ```

**Преимущества:**
- ✅ Не трогаешь основной домен
- ✅ Можно использовать оба (оригинал + CDN)
- ✅ Легко откатить изменения

---

### Вариант 3: CNAME только для API (api.autoro.tech)

Если у тебя уже есть `api.autoro.tech`:

1. В Cloudflare найди запись для `api.autoro.tech`
2. Измени на CNAME:
   ```
   Type: CNAME
   Name: api
   Target: cl-glc03b3ef4.gcdn.co
   Proxy status: 🟠 Proxied
   ```

3. Используй: `https://api.autoro.tech/api/blog`

---

## Важно: Proxy status

**🟠 Proxied (оранжевое облако)** - ДОЛЖНО быть включено!

Почему:
- Cloudflare проксирует запросы через свой CDN
- Работает вместе с Gcore CDN
- Обеспечивает дополнительную защиту
- SSL сертификат автоматически

**❌ DNS only (серое облако)** - НЕ используй для CDN!

---

## Рекомендуемый вариант

**Используй Вариант 2** (поддомен `cdn.autoro.tech`):

1. ✅ Не трогаешь основной домен
2. ✅ Можешь использовать оба
3. ✅ Легко тестировать
4. ✅ Легко откатить

### Пошаговая инструкция:

1. **В Cloudflare:**
   - DNS → Records → Add record
   - Type: CNAME
   - Name: `cdn`
   - Target: `cl-glc03b3ef4.gcdn.co`
   - Proxy: 🟠 Proxied
   - Save

2. **В Gcore CDN:**
   - Hostnames → Add Hostname
   - Введи: `cdn.autoro.tech`
   - SSL будет автоматически

3. **На сервере (уже сделано):**
   - Nginx уже поддерживает `cdn.autoro.tech`

4. **Во фронтенде:**
   - `.env.production`: `VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog`
   - Пересобери фронтенд

---

## Проверка

После настройки CNAME подожди несколько минут (распространение DNS), затем:

```bash
# Проверь DNS
dig cdn.autoro.tech

# Или через curl
curl -I https://cdn.autoro.tech/api/blog/admin/posts
```

---

## Итог

✅ **Да, нужно добавить CNAME в Cloudflare**

✅ **Рекомендуется:** Создать поддомен `cdn.autoro.tech` → CNAME → `cl-glc03b3ef4.gcdn.co`

✅ **Proxy status:** 🟠 Proxied (включено)

✅ **SSL:** Будет автоматически от Cloudflare

