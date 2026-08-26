# Статус обновления блога

## ✅ Выполнено

### 1. SQL скрипт выполнен успешно
Buckets созданы в Supabase:
- ✅ `blog-images` (public: true)
- ✅ `blog-audio` (public: true)
- ✅ `blog-media` (public: true)

**Перезапуск контейнеров:** Не требуется. Изменения в Supabase Storage не требуют перезапуска контейнеров блога, так как приложение подключается к Supabase по API.

### 2. Next.js обновление

**Текущая версия:** 16.1.0  
**Целевая версия:** 16.1.1 (последняя стабильная)

**Проблема:** На сервере закончилось место на диске (`no space left on device`)

**Что нужно сделать:**

1. **Очистить место на сервере:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   
   # Очистить Docker
   docker system prune -a -f --volumes
   
   # Проверить свободное место
   df -h /
   ```

2. **Обновить package.json вручную:**
   ```bash
   cd /home/vladx/autoro-blog
   # Заменить в package.json:
   # "next": "16.1.0" → "next": "16.1.1"
   # "eslint-config-next": "16.1.0" → "eslint-config-next": "16.1.1"
   ```

3. **Пересобрать контейнер:**
   ```bash
   cd /home/vladx/autoro-blog
   docker-compose build --no-cache blog
   docker-compose up -d blog
   ```

## ⚠️ Примечание об ошибке TypeScript

Ошибка компиляции TypeScript с типами params может сохраняться даже после обновления Next.js. Файл `api/admin/posts/[id]/route.ts` уже использует правильный тип `Promise<{ id: string }>`, но TypeScript все еще видит старую сигнатуру.

**Возможные решения:**
- Обновление до Next.js 16.1.1 может помочь
- Если ошибка сохранится, можно временно использовать type assertion или обновить до Next.js 15.x

## 📋 Текущий статус

- ✅ SQL buckets созданы
- ⚠️ Обновление Next.js заблокировано недостатком места на диске
- ⚠️ Ошибка компиляции TypeScript требует проверки после освобождения места


