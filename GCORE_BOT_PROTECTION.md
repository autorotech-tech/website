# Настройка защиты от ботов в Gcore WAAP

## Защита от автоматизации

Gcore WAAP предоставляет встроенную защиту от ботов через:
1. **Bot Protection** - JavaScript Challenge и CAPTCHA
2. **Rate Limiting** - ограничение количества запросов
3. **WAF Rules** - правила для блокировки подозрительного поведения

---

## 1. Защита регистраций/логина

### Настройка Rate Limiting для `/login`:

1. В Gcore Dashboard → **CDN** → **Your Resource** → **Security** → **WAAP** → **Rate Limiting**
2. Создай правило:
   ```
   Rule Name: Login Protection
   Path: /login, /auth/*
   HTTP Methods: POST, GET
   Limit: 5 requests
   Period: 1 minute
   Action: Challenge (JavaScript Challenge)
   Apply to: All IPs
   ```

3. Дополнительное правило для блокировки после нескольких попыток:
   ```
   Rule Name: Login Block After Failed Attempts
   Path: /login, /auth/*
   HTTP Methods: POST
   Limit: 10 requests
   Period: 15 minutes
   Action: Block
   Condition: Response Status = 401, 403
   ```

---

## 2. Защита создания постов

### Rate Limiting для создания постов:

1. **Rate Limiting** → **Add Rule**:
   ```
   Rule Name: Post Creation Limit
   Path: /api/blog/admin/posts
   HTTP Methods: POST
   Limit: 10 requests
   Period: 5 minutes
   Action: Block
   ```

2. Важно: Это правило должно применяться **только к неавторизованным** или подозрительным запросам.

---

## 3. Защита генерации постов

### Rate Limiting для генерации:

1. **Rate Limiting** → **Add Rule**:
   ```
   Rule Name: Generate Post Limit
   Path: /api/blog/admin/generate-post
   HTTP Methods: POST
   Limit: 5 requests
   Period: 10 minutes
   Action: Challenge (JavaScript Challenge)
   ```

2. Это защитит от автоматической генерации постов ботами.

---

## 4. Bot Protection (глобальная защита)

### Настройка JavaScript Challenge:

1. **Security** → **WAAP** → **Bot Protection**
2. Включи:
   - ✅ **Enable Bot Protection**
   - ✅ **JavaScript Challenge** - для подозрительных запросов
   - ✅ **CAPTCHA** - для очень подозрительных (опционально)

3. Настрой уровни:
   ```
   Trusted Bots: Allow (Googlebot, Bingbot)
   Unknown Bots: Challenge (JavaScript Challenge)
   Known Bad Bots: Block
   ```

4. **Challenge Sensitivity:** Medium (можно настроить)

---

## 5. WAF Rules для дополнительной защиты

### Правило для блокировки подозрительных User-Agent:

1. **Security** → **WAF Rules** → **Add Rule**
2. Настройки:
   ```
   Rule Name: Block Suspicious User Agents
   Condition: Request Header "User-Agent" contains:
     - "bot"
     - "crawler"
     - "scraper"
     - "spider"
   Exception: Contains "Googlebot" OR "Bingbot"
   Action: Challenge
   ```

### Правило для блокировки запросов без реферера (для API):

1. **WAF Rules** → **Add Rule**:
   ```
   Rule Name: Block API Requests Without Referer
   Condition: 
     - Path matches: /api/blog/admin/*
     - Request Header "Referer" is missing
   Action: Block
   Exception: Request Header "Authorization" is present
   ```

---

## 6. IP Reputation (опционально)

1. **Security** → **IP Reputation**
2. Включи блокировку IP из черных списков
3. Это поможет блокировать известные вредоносные IP

---

## 7. Настройка на уровне приложения

### Удаление Cloudflare Turnstile (так как он может не работать)

Если Cloudflare Turnstile блокируется, можно:

1. **Вариант A:** Оставить Turnstile, но добавить проверку на стороне сервера
2. **Вариант B:** Использовать только Gcore WAAP (рекомендуется)

### Проверка токена WAAP на сервере (опционально)

Если нужно проверить, что запрос прошел через WAAP:

```typescript
// В API route проверяй заголовки от Gcore
const gcoreRequestId = request.headers.get('X-GCore-RequestID')
if (!gcoreRequestId) {
  // Запрос не прошел через CDN - можно заблокировать
  return NextResponse.json({ error: 'Invalid request' }, { status: 403 })
}
```

---

## 8. Мониторинг и логи

### Просмотр заблокированных запросов:

1. **Security** → **Events**
2. Фильтры:
   - **Action:** Block, Challenge
   - **Rule:** Выбери конкретное правило
   - **Time Range:** Последний час/день

### Аналитика ботов:

1. **Security** → **Bot Protection** → **Analytics**
2. Статистика:
   - Количество ботов
   - Типы ботов
   - География

---

## 9. Тестирование

### Проверка Rate Limiting:

```bash
# Попробуй сделать 6 запросов за минуту к /login
for i in {1..6}; do
  curl -X POST https://autoro-main.gcdn.co/login \
    -H "Content-Type: application/json" \
    -d '{"test": "data"}'
  sleep 10
done

# После 5-го запроса должен сработать rate limit
```

### Проверка Bot Protection:

1. Открой сайт в режиме инкогнито
2. Попробуй несколько быстрых действий
3. Должен появиться JavaScript Challenge

---

## 10. Рекомендуемая конфигурация

### Базовая защита (минимум):

1. ✅ Bot Protection: Enabled (JavaScript Challenge)
2. ✅ Rate Limiting для `/login`: 5 req/min
3. ✅ Rate Limiting для `/api/blog/admin/posts`: 10 req/5min
4. ✅ Rate Limiting для `/api/blog/admin/generate-post`: 5 req/10min

### Расширенная защита:

1. ✅ Все из базовой
2. ✅ CAPTCHA для очень подозрительных запросов
3. ✅ WAF Rules для подозрительных User-Agent
4. ✅ IP Reputation включен
5. ✅ Geo-blocking (если нужно)

---

## Важные замечания

1. **JavaScript Challenge** требует, чтобы браузер выполнил JS - это защищает от простых ботов
2. **Rate Limiting** должен быть настроен так, чтобы не мешать нормальным пользователям
3. **CAPTCHA** - только для очень строгой защиты (может ухудшить UX)
4. Тестируй правила в режиме **Log Only** перед включением **Block**

---

## Итог

После настройки Gcore WAAP:

✅ Регистрации защищены от ботов (Rate Limit + Bot Protection)
✅ Создание постов защищено (Rate Limit)
✅ Генерация постов защищена (Rate Limit + Challenge)
✅ Общая защита от ботов через JavaScript Challenge

🛡️ **Защита от автоматизации настроена!**

