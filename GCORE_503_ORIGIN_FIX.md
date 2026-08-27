# Исправление ошибки 503 при валидации SSL в Gcore CDN

## Проблема

Ошибка **503 (Service Unavailable)** означает, что Gcore CDN не может подключиться к origin серверу (46.250.228.229) для валидации SSL сертификата.

**Возможные причины:**
1. Origin сервер недоступен для Gcore CDN
2. Origin group настроен неправильно
3. Origin pull protocol неправильно настроен
4. Origin сервер блокирует запросы от Gcore CDN

---

## Решение

### Шаг 1: Проверь настройки Origin в Gcore CDN

1. В Gcore CDN Dashboard → ресурс **cdn.autoro.tech**
2. Перейди в **OPTIONS** → **General** → **Pull content from**
3. Нажми **"Edit this group"** (или "Edit this group" рядом с "autoro-origin-auth")
4. Проверь настройки Origin group:

**Должно быть:**
- ✅ **Origin address:** `46.250.228.229` (IP твоего сервера)
- ✅ **Port:** `80` (для HTTP) или `443` (для HTTPS)
- ✅ **Host header:** `cdn.autoro.tech` или `autoro.tech` (должен совпадать с server_name в Nginx)

---

### Шаг 2: Проверь Origin Pull Protocol

1. В Gcore CDN → **OPTIONS** → **General** → **Origin pull protocol**
2. Выбери:
   - ✅ **"HTTP"** - если origin сервер (Nginx) работает только по HTTP
   - ✅ **"HTTP and HTTPS"** - если origin поддерживает оба протокола

**Рекомендация:** Начни с **"HTTP"**, так как Nginx на сервере обычно работает по HTTP (443 порт может быть закрыт для прямых подключений).

---

### Шаг 3: Проверь доступность Origin сервера

Проверь, что origin сервер доступен:

```bash
# С сервера (или локально с пробросом портов)
curl -I http://46.250.228.229/
curl -I http://46.250.228.229/.well-known/acme-challenge/test

# Должен вернуть HTTP 200 или 404 (но не 503)
```

**Если возвращает 503:** Проблема на стороне origin сервера (Nginx).

---

### Шаг 4: Проверь Nginx конфигурацию

Убедись, что Nginx правильно настроен для обработки запросов от Gcore CDN:

1. **Проверь server_name:**
   ```nginx
   server_name cdn.autoro.tech autoro.tech;
   ```

2. **Проверь доступность /.well-known/acme-challenge/:**
   ```nginx
   location /.well-known/acme-challenge/ {
       allow all;
       # Разрешить доступ для валидации SSL
   }
   ```

---

### Шаг 5: Проверь, что Origin group настроен правильно

В Gcore CDN:

1. **OPTIONS** → **General** → **Pull content from** → **"Edit this group"**
2. Проверь настройки:

**Правильная конфигурация:**
```
Origin address: 46.250.228.229
Port: 80
Host header: cdn.autoro.tech (или autoro.tech, если используется общий Nginx)
```

**Или через домен (если доступен):**
```
Origin address: autoro.tech
Port: 80
Host header: cdn.autoro.tech
```

---

## Пошаговая инструкция

### 1. Проверь Origin group в Gcore:

```
Gcore CDN Dashboard
  → cdn.autoro.tech (ресурс)
  → OPTIONS → General → Pull content from
  → Нажми "Edit this group"
  → Проверь:
    - Origin address: 46.250.228.229
    - Port: 80
    - Host header: cdn.autoro.tech
  → Save
```

### 2. Установи Origin pull protocol на HTTP:

```
OPTIONS → General → Origin pull protocol
  → Выбери: "HTTP"
  → Save
```

### 3. Проверь доступность origin:

```bash
# С локальной машины (если есть доступ)
curl -I http://46.250.228.229/

# Должен вернуть HTTP 200/301/302 (не 503)
```

### 4. Попробуй получить SSL снова:

```
OPTIONS → General → SSL
  → Enable HTTPS: ON
  → "Free Let's Encrypt certificate"
  → "Get SSL certificate"
  → Подожди 5-15 минут
```

---

## Альтернативное решение: Использовать существующий ресурс

Если проблема сохраняется, можно использовать существующий ресурс `autoro.tech` вместо создания нового:

1. В существующем ресурсе `autoro.tech` добавь `cdn.autoro.tech` как custom domain
2. Используй уже настроенный Origin group
3. Получи SSL сертификат

**Преимущества:**
- ✅ Origin уже настроен
- ✅ Не нужно настраивать новый ресурс
- ✅ Меньше конфигурации

---

## Проверка Nginx на сервере

Если проблема сохраняется, проверь Nginx конфигурацию на сервере:

```bash
# SSH на сервер
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверь конфигурацию Nginx
cat /home/vladx/projects/autoro.tech/html/default.conf | grep -A 10 "server_name.*cdn"

# Проверь доступность
curl -I http://localhost/
curl -I -H "Host: cdn.autoro.tech" http://localhost/
```

---

## Если ничего не помогает

### Вариант 1: Использовать Custom SSL сертификат

Если у тебя есть SSL сертификат:

1. В Gcore → **SSL** → выбери **"Custom SSL certificate"**
2. Загрузи сертификат и приватный ключ
3. Сохрани

**Это обойдет проблему с валидацией Let's Encrypt.**

### Вариант 2: Временно использовать HTTP

Можно временно использовать HTTP (без SSL) для тестирования:

1. В Gcore отключи **"Enable HTTPS"**
2. Используй `http://cdn.autoro.tech` (не https)
3. Настрой SSL позже, когда origin будет доступен

---

## Итоговая проверка

После настройки Origin group, проверь:

1. ✅ **Origin address:** `46.250.228.229`
2. ✅ **Port:** `80` (для HTTP)
3. ✅ **Host header:** `cdn.autoro.tech`
4. ✅ **Origin pull protocol:** `HTTP`
5. ✅ **Origin сервер доступен:** `curl -I http://46.250.228.229/`

---

## Диагностика

Если проблема сохраняется, выполни диагностику:

```bash
# 1. Проверь доступность origin
curl -v http://46.250.228.229/

# 2. Проверь с правильным Host header
curl -v -H "Host: cdn.autoro.tech" http://46.250.228.229/

# 3. Проверь ACME challenge путь
curl -v http://46.250.228.229/.well-known/acme-challenge/test

# 4. Проверь логи Nginx на сервере
ssh vladx@46.250.228.229 "docker logs autoro-site 2>&1 | tail -50"
```

Если видишь ошибки в логах или curl возвращает 503, значит проблема в Nginx конфигурации или доступности сервера.

