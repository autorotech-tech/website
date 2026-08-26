# Финальная настройка Gcore CDN (БЕЗ WAAP)

## Решение: Gcore только для CDN

✅ **WAAP не включай** - он дорогой, а у тебя уже есть защита!

---

## Настройка Gcore CDN (без WAAP)

### Шаг 1: Создание ресурса

1. **Add domain:** `autoro.tech` (исправь опечатку если есть)
2. **Origin source:** `46.250.228.229`
3. **WAAP:** ❌ **OFF** (не включай!)
4. Нажми **"Create"**

---

### Шаг 2: Настройка Cache Rule (ОБЯЗАТЕЛЬНО!)

После создания ресурса:

1. **Cache Rules** → **Add Rule**
2. Настройки:
   ```
   Rule Name: Bypass API Cache
   Path: /api/*
   Cache Behavior: Bypass Cache
   Enable: ON
   ```
3. Сохрани

**Важно:** API не должен кэшироваться!

---

### Шаг 3: Получи CDN домен

После создания ресурса получишь CDN домен, например:
- `autoro-main.gcdn.co`
- Или custom домен, если настроил

---

### Шаг 4: Обновление фронтенда

В `.env.production` добавь:
```bash
VITE_BLOG_API_URL=https://autoro-main.gcdn.co/api/blog
```

Пересобери фронтенд.

---

## Защита от ботов (БЕЗ WAAP)

### У тебя уже есть 3 уровня защиты:

#### 1. Cloudflare Turnstile (если доступен)

✅ Уже настроен в коде:
- `Login.tsx` - проверка перед логином
- `BlogPostEditor.tsx` - проверка перед сохранением поста

Если Turnstile блокируется - он просто не будет работать, но остальная защита продолжит работать.

#### 2. Nginx Rate Limiting (уже настроено)

✅ Настроено на сервере:
```nginx
limit_req_zone $binary_remote_addr zone=blog_admin:10m rate=10r/m;

location /api/blog/ {
    limit_req zone=blog_admin burst=5 nodelay;
    ...
}
```

- Ограничение: **10 запросов в минуту**
- Защищает от массовых запросов

#### 3. Admin Guard в API (уже работает)

✅ Проверка в API routes:
- Email должен быть `autoro.tech@gmail.com`
- Требуется валидный JWT токен

---

## Усиление защиты (опционально)

Если нужно больше защиты БЕЗ WAAP, можешь усилить Nginx Rate Limiting:

### Добавить более строгие лимиты:

```nginx
# Для логина
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

location /login {
    limit_req zone=login burst=2 nodelay;
    ...
}

# Для создания постов
limit_req_zone $binary_remote_addr zone=post_create:10m rate=10r/5m;

location ~ ^/api/blog/admin/posts$ {
    if ($request_method = POST) {
        limit_req zone=post_create burst=3 nodelay;
    }
    ...
}
```

Но это опционально - текущей защиты достаточно.

---

## Сравнение с Bunny CDN

Если Gcore CDN не подходит, можно использовать Bunny CDN:

### Bunny CDN:
- ✅ Дешевле ($1/TB, первые 10GB бесплатно)
- ✅ Базовая защита от ботов (включена)
- ✅ Проще настройка

### Gcore CDN:
- ✅ Более мощный CDN
- ✅ Лучше для больших нагрузок
- ❌ WAAP дорогой

**Выбор:** Если нужна дешевая защита - Bunny. Если нужен мощный CDN без WAAP - Gcore.

---

## Итог

✅ **Создавай Gcore CDN БЕЗ WAAP**

✅ **Настрой Cache Rule** для `/api/*` → Bypass Cache

✅ **Защита уже есть:**
   - Cloudflare Turnstile (если доступен)
   - Nginx Rate Limiting
   - Admin Guard в API

✅ **Обнови фронтенд** с CDN доменом

🎯 **Готово! CDN работает, защита от ботов работает, БЕЗ платного WAAP!**

