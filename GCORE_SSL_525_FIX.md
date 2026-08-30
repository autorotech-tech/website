# Исправление ошибки 525 (SSL handshake failed) в Gcore CDN

## Проблема

Ошибка **525 (SSL handshake failed)** означает, что Cloudflare не может установить SSL соединение с Gcore CDN.

**Причина:** Cloudflare (прокси) пытается подключиться к Gcore CDN через HTTPS, но SSL сертификат на стороне Gcore не настроен или невалиден.

---

## Решение

### Шаг 1: Включить HTTPS в Gcore CDN

1. В Gcore CDN Dashboard → твой ресурс `autoro.tech`
2. Перейди в **OPTIONS** → **General** → **SSL**
3. Включи переключатель **"Enable HTTPS"** (включи в ON положение)
4. Gcore автоматически создаст SSL сертификат для `cdn.autoro.tech` (Let's Encrypt)
5. Подожди 2-5 минут для выдачи SSL сертификата

**Важно:** SSL сертификат создается автоматически для всех custom domains (включая `cdn.autoro.tech`).

---

### Шаг 2: Настроить Origin Pull Protocol

1. В Gcore CDN Dashboard → **OPTIONS** → **General** → **Origin pull protocol**
2. Убедись, что выбрано:
   - ✅ **"HTTP and HTTPS"** (рекомендуется)
   - Или **"HTTPS"** (если origin сервер поддерживает только HTTPS)

**Почему:** Это позволяет Gcore CDN подключаться к origin серверу (46.250.228.229) по HTTPS, если нужно.

---

### Шаг 3: Проверь Host Header (уже настроен)

В разделе **OPTIONS** → **Content** → **Host header** должно быть:
- ✅ **"Change Host header"** включен (ON)
- ✅ **"Custom Host header"** выбран
- ✅ Значение: `46.250.228.229` (IP твоего сервера)

Это уже настроено правильно.

---

## Альтернативное решение (если проблема сохраняется)

Если после включения HTTPS ошибка 525 сохраняется, возможна проблема с SSL сертификатом Gcore для Cloudflare.

### Вариант A: Отключить прокси в Cloudflare (НЕ РЕКОМЕНДУЕТСЯ)

**⚠️ Это уберет защиту Cloudflare, но решит проблему 525:**

1. В Cloudflare → **DNS** → найди CNAME запись для `cdn`
2. Кликни на запись → измени **Proxy status** на **DNS only** (серое облако)
3. Сохрани

**Минусы:**
- ❌ Нет защиты Cloudflare
- ❌ Нет автоматического SSL от Cloudflare
- ❌ Нет DDoS защиты

**Плюсы:**
- ✅ Ошибка 525 исчезнет
- ✅ CDN будет работать напрямую через Gcore

---

### Вариант B: Использовать основной домен autoro.tech (если нужно)

Если `cdn.autoro.tech` не критичен, можно использовать основной домен:

1. В Cloudflare измени CNAME для `autoro.tech` (root):
   ```
   Type: CNAME
   Name: @
   Target: cl-glc03b3ef4.gcdn.co
   Proxy: 🟠 Proxied
   ```

2. В Gcore используй `autoro.tech` как custom domain

---

## Пошаговая инструкция (РЕКОМЕНДУЕТСЯ)

### 1. Включи HTTPS в Gcore:

```
Gcore CDN Dashboard
  → autoro.tech (ресурс)
  → OPTIONS → General → SSL
  → Enable HTTPS: ON
  → Сохрани
  → Подожди 2-5 минут
```

### 2. Проверь Origin Pull Protocol:

```
OPTIONS → General → Origin pull protocol
  → Выбери: "HTTP and HTTPS" или "HTTPS"
  → Сохрани
```

### 3. Проверь работу:

Через 2-5 минут после включения HTTPS:

```bash
# Проверь SSL сертификат
curl -I https://cdn.autoro.tech

# Или через браузер
# Открой: https://cdn.autoro.tech
```

Должно работать без ошибки 525.

---

## Проверка SSL сертификата

После включения HTTPS в Gcore, проверь SSL:

```bash
# Проверь SSL сертификат
openssl s_client -connect cdn.autoro.tech:443 -servername cdn.autoro.tech < /dev/null

# Или через curl
curl -vI https://cdn.autoro.tech 2>&1 | grep -i "SSL\|certificate"
```

Должен появиться валидный SSL сертификат от Let's Encrypt или Gcore.

---

## Если ошибка 525 сохраняется

1. **Проверь в Gcore:**
   - SSL включен? ✅
   - Custom domain `cdn.autoro.tech` добавлен? ✅
   - Прошло 5+ минут после включения SSL? ✅

2. **Проверь в Cloudflare:**
   - CNAME запись правильная? ✅
   - Proxy включен (оранжевое облако)? ✅

3. **Попробуй отключить прокси временно:**
   - В Cloudflare измени Proxy на "DNS only" (серое облако)
   - Если работает, значит проблема в SSL между Cloudflare и Gcore
   - Верни прокси и подожди еще 5-10 минут

4. **Очисти кеш Cloudflare:**
   - Cloudflare Dashboard → Caching → Configuration → Purge Everything

---

## Итоговая конфигурация

### Gcore CDN:
- ✅ Custom domain: `cdn.autoro.tech`
- ✅ SSL: Enabled (HTTPS включен)
- ✅ Origin pull protocol: HTTP and HTTPS
- ✅ Host header: `46.250.228.229`

### Cloudflare:
- ✅ CNAME: `cdn` → `cl-glc03b3ef4.gcdn.co`
- ✅ Proxy: 🟠 Proxied (оранжевое облако)

### Результат:
- ✅ `https://cdn.autoro.tech` работает
- ✅ SSL сертификат автоматически от Gcore
- ✅ Защита через Cloudflare прокси

