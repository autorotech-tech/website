# Исправление ошибки валидации SSL (404 при ACME challenge)

## Проблема

Gcore не может выпустить SSL сертификат, потому что Cloudflare Proxy блокирует доступ к `/.well-known/acme-challenge/` для валидации Let's Encrypt.

**Ошибка:** "A 404 error occurred when attempting to connect to the validation URL"

---

## Решение: Временно отключить прокси в Cloudflare

### Шаг 1: Отключить прокси в Cloudflare (DNS only)

1. Зайди в **Cloudflare Dashboard** → домен **autoro.tech**
2. Перейди в **DNS** → **Records**
3. Найди CNAME запись для `cdn`
4. Кликни на запись → **Edit**
5. Измени **Proxy status** с **🟠 Proxied** на **⚪ DNS only** (серое облако)
6. Нажми **Save**

**Это необходимо для валидации SSL от Let's Encrypt.**

---

### Шаг 2: Подожди распространения DNS (1-2 минуты)

```bash
# Проверь, что DNS изменился
dig cdn.autoro.tech

# Должно показать CNAME на cl-glc03b3ef4.gcdn.co (не IP Cloudflare)
```

---

### Шаг 3: Получить SSL сертификат в Gcore

1. В Gcore CDN Dashboard → **OPTIONS** → **General** → **SSL**
2. Убедись, что переключатель **"Enable HTTPS"** включен (ON)
3. Выбери **"Free Let's Encrypt certificate"**
4. Нажми **"Get SSL certificate"**
5. Подожди **5-15 минут** для выпуска сертификата

**Теперь валидация должна пройти успешно!**

---

### Шаг 4: После успешной валидации - вернуть прокси

**⚠️ ВАЖНО:** После того, как SSL сертификат будет выпущен (статус "Active" или "Valid"), верни прокси обратно:

1. В Cloudflare → **DNS** → **Records**
2. Найди CNAME для `cdn`
3. Кликни **Edit**
4. Верни **Proxy status** на **🟠 Proxied** (оранжевое облако)
5. Сохрани

**Почему:** Прокси Cloudflare обеспечивает защиту и кеширование, но блокирует валидацию SSL.

---

## Альтернативное решение: Правило в Cloudflare (если нужен постоянный прокси)

Если хочешь оставить прокси включенным постоянно, нужно настроить правило в Cloudflare для пропуска ACME challenge:

### Вариант A: Page Rules (устаревший метод)

1. Cloudflare Dashboard → **Rules** → **Page Rules**
2. Создай правило:
   ```
   URL Pattern: cdn.autoro.tech/.well-known/acme-challenge/*
   Setting: SSL → Off (или Flexible)
   ```
3. Сохрани

**⚠️ Проблема:** Page Rules работают только на платных тарифах.

---

### Вариант B: Transform Rules (современный метод)

1. Cloudflare Dashboard → **Rules** → **Transform Rules** → **URL Rewrite**
2. Создай правило для пропуска ACME challenge (но это сложно для валидации)

**Лучше использовать временное отключение прокси (Шаги 1-4 выше).**

---

## Пошаговая инструкция (РЕКОМЕНДУЕТСЯ)

### 1. Отключи прокси в Cloudflare:

```
Cloudflare Dashboard
  → autoro.tech (домен)
  → DNS → Records
  → Найди CNAME для "cdn"
  → Edit
  → Proxy status: ⚪ DNS only (серое облако)
  → Save
```

### 2. Подожди 1-2 минуты, проверь DNS:

```bash
dig cdn.autoro.tech

# Должно показать CNAME на cl-glc03b3ef4.gcdn.co (не IP Cloudflare)
```

### 3. Получи SSL в Gcore:

```
Gcore CDN Dashboard
  → autoro.tech (ресурс)
  → OPTIONS → General → SSL
  → Enable HTTPS: ON
  → Выбери: "Free Let's Encrypt certificate"
  → Нажми: "Get SSL certificate"
  → Подожди 5-15 минут
```

### 4. Проверь статус SSL:

В Gcore должен появиться статус:
- ✅ **"Active"** или **"Valid"** - сертификат готов
- ❌ **"Pending"** - еще обрабатывается
- ❌ **"Error"** - ошибка, попробуй еще раз

### 5. Верни прокси в Cloudflare:

```
Cloudflare Dashboard
  → DNS → Records
  → Найди CNAME для "cdn"
  → Edit
  → Proxy status: 🟠 Proxied (оранжевое облако)
  → Save
```

### 6. Проверь работу:

```bash
# Проверь SSL
curl -I https://cdn.autoro.tech

# Должен вернуть успешный ответ (HTTP 200/301/302)
# Без ошибки 525
```

---

## Если валидация все равно не проходит

### Проверь DNS:

```bash
# Должно показывать CNAME на Gcore, а не IP Cloudflare
dig cdn.autoro.tech +short
# Ожидаемый результат: cl-glc03b3ef4.gcdn.co

# Проверь, что CNAME резолвится правильно
dig cl-glc03b3ef4.gcdn.co +short
# Должен показать IP адреса Gcore CDN
```

### Проверь доступность ACME challenge:

После отключения прокси, проверь доступность:

```bash
# Попробуй открыть (замени TOKEN на реальный токен из Gcore)
curl http://cdn.autoro.tech/.well-known/acme-challenge/TOKEN

# Если вернет 404 или ошибку, значит проблема в Gcore/Origin
```

### Используй Custom SSL сертификат (если есть):

Если у тебя есть свой SSL сертификат:

1. В Gcore → **SSL** → выбери **"Custom SSL certificate"**
2. Загрузи сертификат и приватный ключ
3. Сохрани

**Это обойдет проблему с валидацией Let's Encrypt.**

---

## Итоговая последовательность

1. ✅ **Отключить прокси в Cloudflare** (DNS only)
2. ✅ **Подождать 1-2 минуты** (распространение DNS)
3. ✅ **Получить SSL в Gcore** (Get SSL certificate)
4. ✅ **Подождать 5-15 минут** (выпуск сертификата)
5. ✅ **Проверить статус SSL** в Gcore (Active/Valid)
6. ✅ **Вернуть прокси в Cloudflare** (Proxied)
7. ✅ **Проверить работу** `https://cdn.autoro.tech`

---

## Важно

- 🔄 **Прокси можно временно отключить** для валидации SSL
- ✅ **После валидации обязательно верни прокси** для защиты
- ⏱️ **Подожди распространения DNS** между шагами
- 🔒 **SSL сертификат останется валидным** даже после включения прокси

