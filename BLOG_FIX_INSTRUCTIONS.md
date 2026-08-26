# Инструкции по исправлению блога

## ✅ Выполнено

1. **Типы params в [id]/route.ts** - Уже исправлены, используются `Promise<{ id: string }>`
2. **SQL скрипт** - Создан и сохранен в:
   - `/tmp/blog_storage_setup.sql` на сервере
   - `autoro-blog/blog_storage_setup.sql` на сервере  
   - `BLOG_STORAGE_SETUP.sql` в локальном workspace

## 📋 Что нужно сделать

### 1. Выполнить SQL скрипт в Supabase

**Вариант 1: Через Supabase Studio (рекомендуется)**

1. Подключитесь через SSH туннель:
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro -L 3100:127.0.0.1:3100 vladx@46.250.228.229
   ```

2. Откройте в браузере:
   ```
   http://127.0.0.1:3100
   ```

3. Перейдите в **SQL Editor**

4. Скопируйте содержимое файла `BLOG_STORAGE_SETUP.sql` (или из `/tmp/blog_storage_setup.sql` на сервере)

5. Вставьте в SQL Editor и выполните (Run)

**Вариант 2: Через командную строку (если есть psql доступ)**

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
psql -h localhost -U postgres -d postgres < /tmp/blog_storage_setup.sql
```

### 2. Проверить и исправить ошибку компиляции (если всё ещё есть)

Ошибка может быть связана с кешем TypeScript. Попробуйте:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/autoro-blog

# Очистить кеш
rm -rf .next node_modules/.cache

# Пересобрать
docker-compose build --no-cache blog
docker-compose up -d blog
```

### 3. Пересобрать контейнер

После выполнения SQL скрипта:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/autoro-blog
docker-compose up -d --build blog
```

## 🔍 Проверка работы

1. **Проверить CORS:**
   ```bash
   curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/posts \
     -H "Origin: https://swoop.autoro.tech" \
     -H "Access-Control-Request-Method: GET" \
     -v
   ```
   Должен вернуть 204 с CORS заголовками.

2. **Проверить загрузку файлов:**
   - Откройте админку: https://swoop.autoro.tech/admin/blog
   - Попробуйте загрузить изображение или аудио файл

3. **Проверить Storage buckets:**
   В Supabase Studio → Storage → Buckets должны быть:
   - `blog-images` (public)
   - `blog-audio` (public)
   - `blog-media` (public)

## 📝 Примечания

- Типы params в `[id]/route.ts` уже используют `Promise<{ id: string }>`, что соответствует Next.js 16+
- Если ошибка компиляции сохраняется, возможно нужно обновить Next.js до более новой версии (16.2+)
- SQL скрипт создает buckets и RLS политики для безопасной загрузки файлов


