# Финальное исправление ошибки 503 при валидации SSL

## Проблема

Ошибка **503 (Service Unavailable)** при валидации SSL означает, что Gcore CDN не может получить доступ к `/.well-known/acme-challenge/` на origin сервере.

**Причины:**
1. Nginx не обрабатывает путь `/.well-known/acme-challenge/`
2. Origin group в Gcore настроен неправильно
3. Host header не совпадает с server_name в Nginx

---

## Решение

### Шаг 1: Добавлен location блок в Nginx (УЖЕ СДЕЛАНО)

В Nginx конфигурацию добавлен location блок для ACME challenge:

```nginx
# ACME challenge для валидации SSL (Let's Encrypt)
location /.well-known/acme-challenge/ {
    allow all;
    default_type text/plain;
    access_log off;
    return 200 "";
}
```

Этот блок позволяет Gcore CDN получать доступ к пути валидации.

---

### Шаг 2: Проверь настройки Origin group в Gcore

**ВАЖНО:** Убедись, что Origin group настроен правильно:

1. В Gcore CDN Dashboard → ресурс **cdn.autoro.tech**
2. Перейди в **OPTIONS** → **General** → **Pull content from**
3. Нажми **"Edit this group"** (рядом с "autoro-origin-auth")
4. Проверь настройки:

**Должно быть:**
```
Origin address: 46.250.228.229
Port: 80
Host header: cdn.autoro.tech
```

**Или:**
```
Origin address: autoro.tech (если доступен)
Port: 80
Host header: cdn.autoro.tech
```

5. Сохрани изменения

---

### Шаг 3: Проверь Origin pull protocol

1. В Gcore CDN → **OPTIONS** → **General** → **Origin pull protocol**
2. Убедись, что выбран **"HTTP"** (не HTTPS)

**Почему:** Origin сервер (Nginx) работает по HTTP на порту 80.

---

### Шаг 4: Проверь доступность

После настройки Origin group, проверь доступность:

```bash
# Проверь доступность origin
curl -I -H "Host: cdn.autoro.tech" http://46.250.228.229/.well-known/acme-challenge/test

# Должен вернуть HTTP 200 (не 503)
```

---

### Шаг 5: Попробуй получить SSL снова

1. В Gcore CDN → **OPTIONS** → **General** → **SSL**
2. Убедись, что **"Enable HTTPS"** включен (ON)
3. Выбери **"Free Let's Encrypt certificate"**
4. Нажми **"Get SSL certificate"**
5. Подожди **5-15 минут**

---

## Пошаговая инструкция

### 1. Проверь Origin group в Gcore:

```
Gcore CDN Dashboard
  → cdn.autoro.tech (ресурс)
  → OPTIONS → General → Pull content from
  → Нажми "Edit this group"
  → Проверь:
    ✅ Origin address: 46.250.228.229
    ✅ Port: 80
    ✅ Host header: cdn.autoro.tech
  → Save
```

### 2. Проверь Origin pull protocol:

```
OPTIONS → General → Origin pull protocol
  → Выбери: "HTTP"
  → Save
```

### 3. Проверь доступность (локально):

```bash
curl -I -H "Host: cdn.autoro.tech" http://46.250.228.229/.well-known/acme-challenge/test

# Ожидаемый результат:
# HTTP/1.1 200 OK
```

### 4. Получи SSL в Gcore:

```
OPTIONS → General → SSL
  → Enable HTTPS: ON
  → "Free Let's Encrypt certificate"
  → "Get SSL certificate"
  → Подожди 5-15 минут
```

---

## Если ошибка 503 сохраняется

### Проверь логи Nginx:

```bash
# SSH на сервер
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверь логи Nginx
docker logs autoro-site 2>&1 | tail -50 | grep -i "error\|503"

# Проверь доступность с правильным Host header
curl -v -H "Host: cdn.autoro.tech" http://localhost/.well-known/acme-challenge/test
```

### Проверь, что Origin group правильный:

В Gcore должен быть настроен:
- ✅ **Origin address:** `46.250.228.229` (IP сервера)
- ✅ **Port:** `80` (HTTP)
- ✅ **Host header:** `cdn.autoro.tech` (совпадает с server_name в Nginx)

### Альтернатива: Использовать домен вместо IP

Если IP не работает, попробуй использовать домен:

```
Origin address: autoro.tech
Port: 80
Host header: cdn.autoro.tech
```

**Важно:** Домен должен резолвиться в IP `46.250.228.229`.

---

## Итоговая проверка

После всех настроек проверь:

1. ✅ **Nginx location блок** добавлен для `/.well-known/acme-challenge/`
2. ✅ **Origin group** настроен правильно (IP или домен, порт 80, Host header)
3. ✅ **Origin pull protocol** = HTTP
4. ✅ **Доступность проверена:** `curl` возвращает HTTP 200
5. ✅ **SSL получен:** статус "Active" или "Valid" в Gcore

---

## Следующие шаги после получения SSL

1. **Верни прокси в Cloudflare** (если отключал):
   - Cloudflare → DNS → Records
   - CNAME для `cdn` → Edit
   - Proxy status: 🟠 Proxied (оранжевое облако)
   - Save

2. **Обнови фронтенд:**
   - В `.env.production` добавь:
     ```bash
     VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog
     ```
   - Пересобери фронтенд

3. **Проверь работу:**
   ```bash
   curl -I https://cdn.autoro.tech/api/blog
   ```

