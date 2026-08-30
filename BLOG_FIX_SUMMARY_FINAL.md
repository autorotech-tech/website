# Итоговый статус исправлений блога

## ✅ Исправлено

### 1. SQL скрипт исправлен
**Проблема:** `CREATE POLICY IF NOT EXISTS` не поддерживается в некоторых версиях PostgreSQL

**Решение:** Заменено на `DROP POLICY IF EXISTS` + `CREATE POLICY`

Файлы обновлены:
- ✅ `BLOG_STORAGE_SETUP.sql` (локально)
- ✅ `/tmp/blog_storage_setup.sql` (на сервере)
- ✅ `autoro-blog/blog_storage_setup.sql` (на сервере)

### 2. Типы params в route.ts
Файл `api/admin/posts/[id]/route.ts` использует правильный тип:
```typescript
{ params }: { params: Promise<{ id: string }> }
```

Все функции (GET, PUT, DELETE) используют `await params` для получения id.

## 📋 Выполнить SQL скрипт

Теперь можно выполнить исправленный SQL скрипт в Supabase:

1. **Подключиться через SSH туннель:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro -L 3100:127.0.0.1:3100 vladx@46.250.228.229
   ```

2. **Открыть Supabase Studio:**
   ```
   http://127.0.0.1:3100
   ```

3. **Перейти в SQL Editor** и выполнить содержимое файла `BLOG_STORAGE_SETUP.sql`

Или скопировать с сервера:
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "cat autoro-blog/blog_storage_setup.sql"
```

## ⚠️ Если ошибка компиляции TypeScript сохраняется

Ошибка может быть связана с кешем или версией Next.js 16.1.0. Попробуйте:

1. Очистить все кеши:
   ```bash
   cd autoro-blog
   rm -rf .next node_modules/.cache .turbo
   ```

2. Пересобрать без кеша:
   ```bash
   docker-compose build --no-cache blog
   docker-compose up -d blog
   ```

3. Если не поможет, можно временно отключить проверку типов в tsconfig.json или обновить Next.js до версии 16.2+

## 📝 Что создает SQL скрипт

- **Buckets:**
  - `blog-images` (public) - для изображений
  - `blog-audio` (public) - для аудио файлов  
  - `blog-media` (public) - для других медиа файлов

- **RLS политики:**
  - Загрузка (INSERT) - только для autoro.tech@gmail.com
  - Чтение (SELECT) - публичный доступ
  - Обновление (UPDATE) - только для autoro.tech@gmail.com
  - Удаление (DELETE) - только для autoro.tech@gmail.com

## 🎯 Следующие шаги

1. ✅ Выполнить SQL скрипт в Supabase
2. ✅ Пересобрать контейнер блога
3. ✅ Проверить работу загрузки файлов через админку


