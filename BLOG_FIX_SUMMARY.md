# Исправление CORS и добавление загрузки файлов для блога

## ✅ Выполнено

### 1. Конфигурация nginx для cdn.autoro.tech
Создан файл конфигурации `/etc/nginx/vhost.d/cdn.autoro.tech` с правильными CORS заголовками:
- Обработка OPTIONS запросов (preflight)
- CORS заголовки для `https://swoop.autoro.tech`
- Проксирование на `http://172.17.0.1:3002/api/`

### 2. API endpoint для загрузки файлов
Создан `/api/admin/upload/route.ts`:
- Поддержка изображений (JPEG, PNG, WebP, GIF, SVG)
- Поддержка аудио (MP3, WAV, OGG, WebM, AAC, M4A)
- Максимальный размер файла: 10MB
- Автоматическое определение bucket (blog-images или blog-audio)
- Возвращает публичный URL загруженного файла

### 3. SQL скрипт для настройки Storage
Создан `/tmp/blog_storage_setup.sql` для создания buckets в Supabase:
- `blog-images` - для изображений
- `blog-audio` - для аудио файлов
- `blog-media` - для других медиа файлов
- RLS политики для админа (autoro.tech@gmail.com)
- Публичный доступ на чтение

## ⚠️ Требуется исправление

### Middleware.ts
В файле `autoro-blog/middleware.ts` есть синтаксическая ошибка - лишняя закрывающая скобка на строке 25. Нужно удалить лишнюю `}` после блока обработки API routes.

### Остальные API routes
В некоторых файлах все еще используется `handleCORS`, который не существует. Нужно заменить на использование `getCorsHeaders` с проверкой OPTIONS.

## 📋 Следующие шаги

1. **Исправить middleware.ts:**
   - Удалить лишнюю закрывающую скобку
   - Проверить синтаксис

2. **Выполнить SQL скрипт в Supabase:**
   ```sql
   -- Скопировать содержимое /tmp/blog_storage_setup.sql в Supabase SQL Editor
   ```

3. **Пересобрать контейнер блога:**
   ```bash
   cd /home/vladx/autoro-blog
   docker-compose up -d --build blog
   ```

4. **Проверить работу:**
   - Запросы к `https://cdn.autoro.tech/api/blog/admin/posts` должны работать
   - Загрузка файлов через `/api/admin/upload` должна работать

## 📝 Использование API загрузки

```typescript
const formData = new FormData()
formData.append('file', file)

const response = await fetch('https://cdn.autoro.tech/api/blog/admin/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
  },
  body: formData,
})

const data = await response.json()
// data.url - публичный URL загруженного файла
// data.path - путь к файлу в storage
// data.bucket - bucket (blog-images или blog-audio)
// data.type - тип файла (image или audio)
```

## 🔧 Конфигурация nginx

Конфигурация сохранена в `nginx-proxy/vhost.d/cdn.autoro.tech` и автоматически подхватывается nginx-proxy.
