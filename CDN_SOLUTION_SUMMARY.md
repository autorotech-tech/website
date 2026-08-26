# Решение для обхода блокировки через CDN

## Краткое решение: Bunny CDN

### Быстрый старт:

1. **Зарегистрируйся на Bunny CDN:**
   - https://bunny.net
   - Создай Pull Zone с Origin: `http://46.250.228.229`
   - Получишь домен типа: `autoro-bypass.b-cdn.net`

2. **Настрой Edge Rule для API (не кэшировать):**
   - Condition: `/api/*`
   - Action: Bypass Cache

3. **На сервере запусти:**
   ```bash
   bash ~/update_nginx_for_cdn.sh
   # Введи: autoro-bypass.b-cdn.net
   ```

4. **В .env фронтенда добавь:**
   ```bash
   VITE_BLOG_API_URL=https://autoro-bypass.b-cdn.net/api/blog
   ```

5. **Пересобери фронтенд:**
   ```bash
   docker-compose build frontend
   docker-compose up -d frontend
   ```

6. **Используй новый домен для доступа!**

---

## Альтернативные CDN (если Bunny тоже блокируется)

### Вариант 1: KeyCDN
- https://www.keycdn.com
- Pull Zone аналогично Bunny
- Домены: `*.kxcdn.com`

### Вариант 2: StackPath
- https://www.stackpath.com
- Более дорогой, но надежный

### Вариант 3: AWS CloudFront
- https://aws.amazon.com/cloudfront/
- Сложнее настройка, но очень надежно

### Вариант 4: Multi-CDN
Используй несколько CDN одновременно с автоматическим переключением при недоступности.

---

## Важные моменты

1. **API не должен кэшироваться** - настрой Edge Rules
2. **Cookies должны передаваться** - важно для авторизации
3. **CORS заголовки** должны быть на origin сервере
4. **WebSocket** может не работать через CDN

---

## Стоимость

- **Bunny CDN:** $1/TB (первые 10GB бесплатно)
- **KeyCDN:** ~$0.04/GB
- **CloudFront:** ~$0.085/GB

Для небольшого трафика практически бесплатно.

---

## Подробные инструкции

- `BUNNY_CDN_SETUP.md` - детальная инструкция по настройке Bunny CDN
- `CDN_BYPASS_SOLUTION.md` - обзор всех вариантов CDN

