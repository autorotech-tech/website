# Быстрый старт: Gcore CDN и защита от ботов

## Что нужно сделать

### Шаг 1: Создание CDN ресурса в Gcore (5 минут)

1. Зайди на **https://gcore.com** и зарегистрируйся
2. **CDN** → **Resources** → **Create Resource**
3. Настройки:
   ```
   Resource Name: autoro-main
   Origin Address: 46.250.228.229
   Origin Protocol: HTTP
   Port: 80
   Host Header: autoro.tech
   ```
4. Сохрани и получи CDN домен (например: `autoro-main.gcdn.co`)

---

### Шаг 2: Настройка кэширования API (2 минуты)

1. В CDN ресурсе → **Cache Rules** → **Add Rule**
2. Настройки:
   ```
   Rule Name: Bypass API Cache
   Path: /api/*
   Cache Behavior: Bypass Cache
   Enable: ON
   ```
3. Сохрани

---

### Шаг 3: Настройка WAAP и защиты от ботов (10 минут)

#### 3.1. Включение WAAP

1. **Security** → **WAAP** → **Enable WAAP**
2. Режим: **Log Only** (для начала) или **Block**

#### 3.2. Bot Protection

1. **WAAP** → **Bot Protection**
2. Включи:
   - ✅ Enable Bot Protection
   - ✅ JavaScript Challenge

#### 3.3. Rate Limiting для логина

1. **WAAP** → **Rate Limiting** → **Add Rule**
2. Настройки:
   ```
   Rule Name: Login Protection
   Path: /login, /auth/*
   Limit: 5 requests
   Period: 1 minute
   Action: Challenge
   ```

#### 3.4. Rate Limiting для создания постов

1. **Rate Limiting** → **Add Rule**
2. Настройки:
   ```
   Rule Name: Post Creation Limit
   Path: /api/blog/admin/posts
   Method: POST
   Limit: 10 requests
   Period: 5 minutes
   Action: Block
   ```

#### 3.5. Rate Limiting для генерации постов

1. **Rate Limiting** → **Add Rule**
2. Настройки:
   ```
   Rule Name: Generate Post Limit
   Path: /api/blog/admin/generate-post
   Method: POST
   Limit: 5 requests
   Period: 10 minutes
   Action: Challenge
   ```

---

### Шаг 4: Обновление фронтенда (2 минуты)

1. Создай файл `.env.production` в корне проекта:
   ```bash
   VITE_BLOG_API_URL=https://autoro-main.gcdn.co/api/blog
   ```
   *(Замени `autoro-main.gcdn.co` на свой CDN домен)*

2. Пересобери фронтенд:
   ```bash
   npm run build
   # или
   docker-compose build frontend
   docker-compose up -d frontend
   ```

---

### Шаг 5: Проверка (1 минута)

```bash
# Проверь доступность через CDN
curl -I https://autoro-main.gcdn.co/api/blog/admin/posts

# Должны быть заголовки:
# Server: G-Core
# X-GCore-RequestID: ...
```

---

## Что уже настроено на сервере ✅

- ✅ Nginx обновлен для поддержки Gcore CDN домена
- ✅ CORS заголовки настроены
- ✅ API маршруты работают

---

## Защита от ботов - что работает

После настройки WAAP:

✅ **Регистрации/логин** - защищены Rate Limiting (5 req/min)
✅ **Создание постов** - защищено Rate Limiting (10 req/5min)
✅ **Генерация постов** - защищено Rate Limiting (5 req/10min) + Challenge
✅ **Общая защита** - JavaScript Challenge от Gcore WAAP

---

## Подробная документация

- `GCORE_CDN_SETUP.md` - детальная инструкция по настройке CDN
- `GCORE_BOT_PROTECTION.md` - детальная инструкция по защите от ботов

---

## Важно

1. **Тестируй правила в режиме Log Only** перед включением Block
2. **CDN домен** (`autoro-main.gcdn.co`) используй вместо `autoro.tech`
3. **Не нужен Core Tunnel** для CDN домена
4. **API не кэшируется** благодаря Cache Rule

---

## Готово! 🎉

После выполнения всех шагов:
- ✅ CDN работает
- ✅ Защита от ботов активна
- ✅ Доступ из заблокированных регионов работает

