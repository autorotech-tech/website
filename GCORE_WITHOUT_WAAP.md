# Gcore CDN без WAAP: Использование альтернативной защиты

## Решение: Gcore только для CDN, защита от ботов через другие методы

WAAP **не обязателен** если у тебя есть другие методы защиты:

### ✅ У тебя уже есть защита:

1. **Cloudflare Turnstile** (в коде Login.tsx и BlogPostEditor.tsx)
2. **Nginx Rate Limiting** (настроен на сервере)
3. **Admin Guard** (проверка email в API routes)

---

## Вариант 1: Gcore CDN + Cloudflare Turnstile (если Turnstile доступен)

### Настройка Gcore CDN БЕЗ WAAP:

1. **Создай CDN ресурс БЕЗ WAAP:**
   - Add domain: `autoro.tech`
   - Origin: `46.250.228.229`
   - WAAP: **OFF** (не включай)
   - Создай ресурс

2. **Настрой Cache Rule:**
   - Path: `/api/*`
   - Cache Behavior: **Bypass Cache**

3. **Cloudflare Turnstile уже работает:**
   - ✅ В Login.tsx
   - ✅ В BlogPostEditor.tsx (для сохранения постов)
   - ✅ Проверка токена перед логином/сохранением

4. **Nginx Rate Limiting работает:**
   - ✅ `/api/blog/` - ограничение: 10 req/min
   - ✅ Уже настроено на сервере

### Преимущества:
- ✅ Gcore CDN работает для доступа из заблокированных регионов
- ✅ Защита от ботов через Turnstile
- ✅ Rate Limiting через Nginx
- ✅ БЕЗ платной WAAP

---

## Вариант 2: Gcore CDN + Nginx Rate Limiting (если Turnstile блокируется)

Если Cloudflare Turnstile блокируется, можно использовать только Nginx Rate Limiting:

### Что уже настроено:

1. **Nginx Rate Limiting:**
   ```nginx
   limit_req_zone $binary_remote_addr zone=blog_admin:10m rate=10r/m;
   
   location /api/blog/ {
       limit_req zone=blog_admin burst=5 nodelay;
       ...
   }
   ```
   - Ограничение: 10 запросов в минуту
   - Burst: 5 дополнительных запросов

2. **Admin Guard в API:**
   - Проверка email `autoro.tech@gmail.com`
   - Требуется JWT токен

### Дополнительно можно усилить на сервере:

Можешь добавить более строгие rate limits для конкретных эндпоинтов в Nginx:

```nginx
# Более строгий лимит для логина
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

location /login {
    limit_req zone=login burst=2 nodelay;
    ...
}

# Лимит для создания постов
limit_req_zone $binary_remote_addr zone=post_create:10m rate=10r/5m;

location ~ ^/api/blog/admin/posts$ {
    if ($request_method = POST) {
        limit_req zone=post_create burst=3 nodelay;
    }
    ...
}
```

---

## Вариант 3: Bunny CDN (если нужна дешевая встроенная защита)

Если нужна встроенная защита от ботов, но WAAP дорогой:

### Преимущества Bunny CDN:

1. **Дешевле:** $1/TB (первые 10GB бесплатно)
2. **Встроенная базовая защита от ботов** (без доплаты)
3. **Pull Zone** - простая настройка
4. **Edge Rules** для кэширования

### Настройка Bunny CDN:

См. `BUNNY_CDN_SETUP.md` - там есть инструкция.

---

## Сравнение вариантов

| Вариант | CDN | Защита от ботов | Стоимость | Сложность |
|---------|-----|-----------------|-----------|-----------|
| Gcore + Turnstile | ✅ Gcore | ✅ Turnstile | Низкая | Средняя |
| Gcore + Nginx | ✅ Gcore | ✅ Nginx Rate Limit | Низкая | Средняя |
| Gcore + WAAP | ✅ Gcore | ✅ WAAP | Высокая | Низкая |
| Bunny CDN | ✅ Bunny | ✅ Базовая защита | Низкая | Низкая |

---

## Рекомендация

### Используй: Gcore CDN БЕЗ WAAP

**Почему:**
1. ✅ У тебя уже есть Cloudflare Turnstile в коде
2. ✅ У тебя уже есть Nginx Rate Limiting на сервере
3. ✅ WAAP дорогой после триала
4. ✅ Gcore CDN дешевле для простого CDN использования

### Настройка:

1. **Создай Gcore CDN ресурс БЕЗ WAAP**
2. **Настрой Cache Rule** для `/api/*` → Bypass Cache
3. **Оставь Cloudflare Turnstile** (если не блокируется)
4. **Используй Nginx Rate Limiting** (уже настроено)

---

## Если Turnstile блокируется

Если Cloudflare Turnstile блокируется, можно:

1. **Усилить Nginx Rate Limiting** (добавить более строгие лимиты)
2. **Или перейти на Bunny CDN** с встроенной защитой (дешевле WAAP)

---

## Итог

✅ **WAAP не обязателен**

✅ **Используй Gcore CDN только для CDN** (без WAAP)

✅ **Защита от ботов через:**
   - Cloudflare Turnstile (если доступен)
   - Nginx Rate Limiting (уже настроено)
   - Admin Guard в API (уже работает)

🎯 **Создавай Gcore CDN ресурс БЕЗ WAAP!**

