# Резюме ответа Antigravity: Реализация Cookie-based авторизации

## Суть предложенного решения

Antigravity предлагает переключиться с Authorization header на Cookie-based авторизацию для исправления ошибки 401 при загрузке файлов через multipart/form-data запросы.

## Ключевые моменты предложения

### 1. Причина проблемы
- GET запросы с Authorization header работают ✅
- POST с JSON body работают ✅
- POST с multipart/form-data НЕ работают ❌ (заголовок теряется в CDN/Proxy)

### 2. Предложенное решение

**Frontend (BlogPostEditor.tsx):**
- Установить custom cookie `sb-access-token` с JWT токеном перед fetch запросом
- Формат cookie: `sb-access-token=${token}; Domain=.autoro.tech; Path=/; Secure; SameSite=None (или Lax)`
- Добавить `credentials: 'include'` в fetch options
- Применить только к функциям, использующим FormData (upload)

**Backend (route.ts):**
- В функции `isAdmin()` добавить проверку cookie `sb-access-token`
- Если cookie найден, валидировать токен через `supabase.auth.getUser(token)`
- Использовать ту же логику, что и для Bearer token

### 3. Особенности

⚠️ **Важно:** Используется custom cookie `sb-access-token`, а НЕ стандартные Supabase SSR cookies. Это сделано для:
- Надежности без необходимости реплицировать полную структуру Supabase SSR cookies на клиенте
- Специфичности для этого конкретного эндпоинта

### 4. Область изменений

Фокус на функции upload (FormData), но для консистентности можно применить и к другим POST запросам:
- `handleUploadImage` ✅ (главная цель)
- `handleUploadAudio` ✅
- `handleGenerateSEO` (опционально)
- `handleGenerateImage` (опционально)
- `handleOptimizeContent` (опционально)
- `handleTranslate` (опционально)
- `handleSave` (опционально)

### 5. План верификации

- Автоматические тесты: не доступны
- Ручная проверка:
  1. Открыть Blog Editor
  2. Загрузить изображение
  3. Проверить, что network request включает Cookie header
  4. Проверить, что backend принимает запрос

---

## Оценка предложения

**Плюсы:**
- ✅ Решает проблему с потерей Authorization header для multipart запросов
- ✅ Простое решение (только установка cookie на клиенте)
- ✅ Не требует изменений инфраструктуры (CDN/nginx)

**Минусы/Риски:**
- ⚠️ Custom cookie вместо стандартного подхода Supabase
- ⚠️ Нет fallback на Authorization header
- ⚠️ Может потребоваться настройка CORS для cookies (SameSite=None требует HTTPS)

**Рекомендация:**
Реализовать **гибридный подход**: сначала пробовать cookie, затем fallback на Authorization header для максимальной совместимости.


