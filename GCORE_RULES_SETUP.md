# Настройка Rules в Gcore CDN - Пошаговая инструкция

## Проблема 1: Как добавить опцию "Cache" в Rule

### Шаг 1: Создание правила
1. **RULES** → **Create rule** → **Create blank rule**
2. Введите **Rule name:** `Bypass API Cache`
3. В разделе **Match criteria** → **Rule pattern:**
   ```
   location ~* ^/api/
   ```

### Шаг 2: Добавление опции Cache
1. В разделе **Options** нажмите **"Add option"**
2. В открывшемся списке найдите и выберите **"Cache"** (в категории Cache)
3. Настройки опции Cache:
   - **Cache behavior:** Выберите **"Bypass Cache"**
   - **Enable:** ON
4. Нажмите **"Create rule"**

---

## Проблема 2: Query String Forwarding - настройка или отключение

### Вариант 1: Отключить Query String Forwarding (РЕКОМЕНДУЕТСЯ)

Если Query String Forwarding не нужен для вашего случая (API с query параметрами), просто **отключите** его:

1. В разделе **Optimization** → **Query String Forwarding**
2. Переключите **"Enable Query String Forwarding"** в положение **OFF**
3. Сохраните

**Почему отключить?**
- Query String Forwarding нужен только для медиа-контента (HLS playlists → .ts segments)
- Для обычного API и веб-сайта это не требуется
- У вас уже включен "Ignore query string" в Cache, что достаточно

### Вариант 2: Настроить Query String Forwarding (если нужно)

Если все-таки нужно включить, настройте так:

1. **Enable Query String Forwarding:** ON
2. **Forward from files types:**
   - Введите: `m3u8` (для HLS playlists)
   - Или оставьте пустым, если не используете медиа
3. **Forward to files types:**
   - Введите: `ts` (для Transport Stream segments)
   - Или оставьте пустым, если не используете медиа
4. **Forward only keys:** (оставить пустым)
5. **Forward except keys:** (оставить пустым)

**НО:** Для вашего случая (API блога) это **не нужно** - просто отключите!

---

## Правильная настройка Rules для вашего проекта

### Правило 1: Bypass для API

1. **Create rule** → **Create blank rule**
2. **Rule name:** `Bypass API Cache`
3. **Match criteria** → **Rule pattern:**
   ```
   location ~* ^/api/
   ```
4. **Options** → **Add option** → Выберите **"Cache"**
   - **Cache behavior:** `Bypass Cache`
   - **Enable:** ON
5. **Create rule**

### Правило 2: Кеширование статики

1. **Create rule** → **Create blank rule**
2. **Rule name:** `Cache Static Files`
3. **Match criteria** → **Rule pattern:**
   ```
   location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp)$
   ```
4. **Options** → **Add option** → Выберите **"Cache"**
   - **Cache behavior:** `Cache`
   - **TTL:** `31536000` (1 год в секундах)
   - **Enable:** ON
5. **Create rule**

### Правило 3: Кеширование HTML

1. **Create rule** → **Create blank rule**
2. **Rule name:** `Cache HTML Pages`
3. **Match criteria** → **Rule pattern:**
   ```
   location ~* \.html$
   ```
4. **Options** → **Add option** → Выберите **"Cache"**
   - **Cache behavior:** `Cache`
   - **TTL:** `3600` (1 час)
   - **Enable:** ON
5. **Create rule**

### Правило 4: Кеширование страниц блога

1. **Create rule** → **Create blank rule**
2. **Rule name:** `Cache Blog Pages`
3. **Match criteria** → **Rule pattern:**
   ```
   location ~* ^/(en|ru|es|it|fr|vi|kz)/blog
   ```
4. **Options** → **Add option** → Выберите **"Cache"**
   - **Cache behavior:** `Cache`
   - **TTL:** `1800` (30 минут)
   - **Enable:** ON
5. **Create rule**

---

## Настройки Cache (основные)

### ✅ Включено:
- **CDN caching:** ON
- **Browser caching:** ON (Origin controlled или установить TTL)
- **Ignore Set-Cookie:** ON ✅
- **Always online:** ON

### ❌ Отключено:
- **Query String Forwarding:** OFF (отключить, если не используете медиа)
- **Cache key modification:** OFF

---

## Настройки Content (сжатие)

### ✅ Включить:
- **GZip compression:** ON

### ❌ Отключить:
- **Brotli compression:** OFF (недоступно без Origin Shielding)
- **Fetch compressed:** OFF

---

## Настройки General (Origin)

### ✅ Включить:
- **Custom connection timeout:** ON, значение: `10` секунд
- **Custom read timeout:** ON, значение: `30` секунд

---

## Настройки Access (безопасность)

### ✅ Включить:
- **Redirect HTTP to HTTPS:** ON

---

## Настройки HTTP headers

### CORS header support:
- ✅ **Enable CORS header support:** ON
- Выбрать: **"$http_origin" if an origin is listed below**
- Добавить origin: `https://swoop.autoro.tech`
- ✅ **Always add the header to response from CDN regardless of response code:** ON

---

## Проблема 3: 502 ошибка от Cloudflare

В терминале видно:
```
HTTP/2 502 
server: cloudflare
```

Это означает, что Cloudflare не может достучаться до Gcore CDN или origin сервера.

### Решение:

1. **Проверь Origin Group в Gcore:**
   - IP: `46.250.228.229`
   - Port: `80` (или `443` для HTTPS)
   - Host header: `cdn.autoro.tech` или `autoro.tech`

2. **Проверь, что origin сервер доступен:**
   ```bash
   curl -I http://46.250.228.229/
   ```

3. **Проверь настройки Origin pull protocol:**
   - Должно быть: **HTTP** (если origin на порту 80)
   - Или: **HTTPS** (если origin на порту 443)

4. **Проверь Host header:**
   - В разделе **HTTP headers** → **Host header**
   - Должно быть: **Custom Host header** = `autoro.tech` или `cdn.autoro.tech`

---

## Итоговый чеклист

- [ ] Создано правило "Bypass API Cache" с опцией Cache → Bypass Cache
- [ ] Создано правило "Cache Static Files" с опцией Cache → Cache, TTL 31536000
- [ ] Создано правило "Cache HTML Pages" с опцией Cache → Cache, TTL 3600
- [ ] Создано правило "Cache Blog Pages" с опцией Cache → Cache, TTL 1800
- [ ] Browser caching включен
- [ ] Ignore Set-Cookie включен
- [ ] Query String Forwarding **отключен** (если не нужен)
- [ ] GZip compression включен
- [ ] Custom connection timeout: 10s
- [ ] Custom read timeout: 30s
- [ ] Redirect HTTP to HTTPS включен
- [ ] CORS настроен правильно
- [ ] Origin Group настроен правильно
- [ ] Проверена доступность origin сервера

---

## Если опция "Cache" не находится в списке

### Вариант 1: Использовать поиск
1. В поле **"Search option"** введите: `cache`
2. Должна появиться опция **"Cache"** в категории **Cache**

### Вариант 2: Найти вручную
1. В списке опций прокрутите до категории **"Cache"**
2. В этой категории должна быть опция **"Cache"** (или **"CDN caching"**)

### Вариант 3: Альтернативный подход
Если опция Cache недоступна в Rules, можно использовать настройки на уровне ресурса:

1. В разделе **Cache** → **CDN caching**
2. Включить **"Enable CDN caching"**
3. Создать Rules с другими опциями для более тонкой настройки (например, через **Rewrite** или **Status code**)

### Вариант 4: Использовать шаблоны
1. **Create rule** → **Create from system templates**
2. Выберите **"Static content"** - это автоматически настроит кеширование для статики

---

## Решение проблемы Query String Forwarding

### ❌ РЕКОМЕНДУЕТСЯ: Отключить Query String Forwarding

**Почему?**
- Query String Forwarding нужен только для медиа-контента (HLS playlists)
- Для API блога это не требуется
- У вас уже включен "Ignore query string" в Cache, что достаточно

**Как отключить:**
1. В разделе **Optimization** → **Query String Forwarding**
2. Переключите **"Enable Query String Forwarding"** в положение **OFF**
3. Сохраните

### ✅ Если все-таки нужно включить (для медиа):

1. **Enable Query String Forwarding:** ON
2. **Forward from files types:**
   - Введите: `m3u8` (минимум одно значение обязательно!)
3. **Forward to files types:**
   - Введите: `ts` (минимум одно значение обязательно!)
4. **Forward only keys:** (оставить пустым)
5. **Forward except keys:** (оставить пустым)

**НО:** Для вашего API блога это **не нужно** - просто отключите!

