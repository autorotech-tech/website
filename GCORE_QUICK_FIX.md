# Быстрое решение проблем Gcore CDN

## Проблема 1: Не находит опцию "Cache" в Rules

### Решение:
1. В разделе **Options** нажмите **"Add option"**
2. В поле **"Search option"** введите: `cache`
3. Выберите опцию **"Cache"** из результатов поиска
4. Или прокрутите список до категории **"Cache"** и выберите опцию **"Cache"**

**Альтернатива:** Используйте шаблон **"Static content"** при создании правила - он автоматически настроит кеширование.

---

## Проблема 2: Query String Forwarding - ошибка валидации

### ❌ РЕШЕНИЕ: Отключить Query String Forwarding

**Почему?**
- Query String Forwarding нужен только для медиа-контента (HLS playlists → .ts segments)
- Для API блога это **не требуется**
- У вас уже включен **"Ignore query string"** в Cache, что достаточно

**Как отключить:**
1. В разделе **Optimization** → **Query String Forwarding**
2. Переключите **"Enable Query String Forwarding"** в положение **OFF**
3. Сохраните

**Если все-таки нужно включить (для медиа):**
1. **Enable Query String Forwarding:** ON
2. **Forward from files types:** `m3u8` (минимум одно значение!)
3. **Forward to files types:** `ts` (минимум одно значение!)
4. Остальные поля оставить пустыми

---

## Проблема 3: 502 ошибка от Cloudflare

### Причина:
Origin сервер возвращает 503, поэтому Cloudflare/Gcore не может получить контент.

### Решение:
1. Проверь, что Nginx контейнер работает:
   ```bash
   docker ps | grep autoro-site
   ```

2. Проверь логи Nginx:
   ```bash
   docker logs autoro-site | tail -20
   ```

3. Исправь конфигурацию Nginx (если есть ошибки)

4. Проверь настройки Origin в Gcore:
   - IP: `46.250.228.229`
   - Port: `80`
   - Host header: `autoro.tech` или `cdn.autoro.tech`

---

## Минимальная настройка для начала работы

### 1. Cache Rules (создать 2 правила):

**Правило 1: Bypass API**
- Rule name: `Bypass API Cache`
- Rule pattern: `location ~* ^/api/`
- Options → Add option → **Cache** → Bypass Cache

**Правило 2: Cache Static**
- Rule name: `Cache Static Files`
- Rule pattern: `location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp)$`
- Options → Add option → **Cache** → Cache, TTL: `31536000`

### 2. Основные настройки Cache:
- ✅ CDN caching: ON
- ✅ Browser caching: ON
- ✅ Ignore Set-Cookie: ON
- ✅ Always online: ON

### 3. Content:
- ✅ GZip compression: ON

### 4. Optimization:
- ❌ Query String Forwarding: **OFF** (отключить!)

### 5. Access:
- ✅ Redirect HTTP to HTTPS: ON

### 6. HTTP headers:
- ✅ CORS header support: ON
- Выбрать: `"$http_origin" if an origin is listed below`
- Добавить: `https://swoop.autoro.tech`

---

## Проверка работы

После настройки проверь:

```bash
# Проверка статики (должен быть кеширован)
curl -I https://cdn.autoro.tech/static/js/main.js

# Проверка API (не должен кешироваться)
curl -I "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"

# Проверка сжатия
curl -H "Accept-Encoding: gzip" -I https://cdn.autoro.tech/
```

Ожидаемые результаты:
- Статика: `Cache-Control: public, max-age=31536000`
- API: `Cache-Control: no-cache` или отсутствие заголовка кеширования
- Сжатие: `Content-Encoding: gzip`

