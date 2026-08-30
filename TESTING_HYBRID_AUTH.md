# Тестирование гибридной авторизации

## Статус реализации

✅ **Реализация завершена Antigravity**

### Что было реализовано:

1. **Frontend (BlogPostEditor.tsx):**
   - ✅ Добавлена функция `setAuthCookie()` для установки custom cookie
   - ✅ Cookie устанавливается перед upload запросами
   - ✅ Добавлен `credentials: 'include'` в fetch options
   - ✅ Сохранен Authorization header как fallback

2. **Backend (app/api/admin/upload/route.ts):**
   - ✅ Добавлена проверка custom cookie `sb-access-token`
   - ✅ Сохранена проверка Supabase SSR cookies
   - ✅ Сохранен fallback на Authorization header
   - ✅ Порядок проверки: custom cookie → SSR cookies → Authorization header

---

## Инструкции по тестированию

### Предварительные условия:

1. Убедиться, что изменения применены на сервере:
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   cd /home/vladx/autoro-blog
   docker-compose build blog
   docker-compose up -d blog
   ```

2. Проверить, что контейнер запущен:
   ```bash
   docker logs autoro-blog-nextjs | tail -20
   ```

---

## Тест 1: Загрузка изображения с cookie (основной сценарий)

### Шаги:

1. Открыть `https://swoop.autoro.tech/admin/blog`
2. Залогиниться через Google OAuth (если не залогинен)
3. Нажать "New Post" или открыть существующий пост для редактирования
4. В редакторе нажать "Upload Image"
5. Выбрать изображение (JPEG, PNG, WebP, до 10MB)

### Проверка в DevTools:

1. Открыть **DevTools → Network**
2. Найти запрос `POST https://cdn.autoro.tech/api/blog/admin/upload`
3. Проверить **Request Headers**:
   - ✅ `Cookie: sb-access-token=eyJhbGci...` (должен присутствовать)
   - ✅ `Authorization: Bearer eyJhbGci...` (fallback, должен присутствовать)
   - ✅ `credentials: include` (в fetch options)

4. Проверить **Response**:
   - ✅ Status: `200 OK` (не 401!)
   - ✅ Body: JSON с `url`, `path`, `bucket`, `type`, `size`, `filename`

### Проверка логов сервера:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
docker logs -f autoro-blog-nextjs
```

**Ожидаемый результат:**
- Нет ошибок "Missing or invalid Authorization header"
- Загрузка файла успешна
- Изображение отображается в редакторе

---

## Тест 2: Fallback на Authorization header

### Шаги:

1. Открыть `https://swoop.autoro.tech/admin/blog`
2. Залогиниться
3. Открыть **DevTools → Application → Cookies**
4. Найти cookie `sb-access-token` для домена `.autoro.tech`
5. **Удалить** эту cookie
6. Вернуться в редактор и загрузить изображение

### Проверка:

1. В **Network** проверить Request Headers:
   - ❌ `Cookie: sb-access-token=...` (отсутствует)
   - ✅ `Authorization: Bearer eyJhbGci...` (присутствует)

2. Проверить Response:
   - ✅ Status: `200 OK` (запрос все еще успешен благодаря fallback)

3. Проверить логи сервера:
   - Должно быть: "Custom cookie token validation failed" или аналогичное сообщение
   - Запрос должен быть успешен через Authorization header

---

## Тест 3: Загрузка аудио файла

### Шаги:

1. Открыть редактор поста
2. В разделе "Audio File" нажать "Upload Audio"
3. Выбрать аудио файл (MP3, M4A, WAV, OGG, до 10MB)

### Проверка:

- ✅ Загрузка успешна
- ✅ Аудио файл отображается с контролами воспроизведения
- ✅ URL аудио сохранен в форме

---

## Тест 4: Проверка всех методов авторизации

### Для отладки можно проверить логи на сервере:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
docker logs autoro-blog-nextjs 2>&1 | grep -E 'Upload POST|Admin check|Authorization|Cookie|sb-access-token' | tail -30
```

**Ожидаемые логи:**
- Для успешной авторизации через custom cookie: нет ошибок
- Для fallback: сообщения о том, что cookie не найден, но Authorization header использован

---

## Возможные проблемы и решения

### Проблема 1: Cookie не устанавливается

**Симптомы:**
- В Request Headers нет `Cookie: sb-access-token=...`
- Запрос все еще работает через Authorization header (это нормально для fallback)

**Решение:**
- Проверить, что функция `setAuthCookie()` вызывается перед fetch
- Проверить, что `session.access_token` существует
- Проверить консоль браузера на ошибки JavaScript

### Проблема 2: 401 Unauthorized даже с cookie

**Симптомы:**
- Cookie присутствует в запросе
- Ответ 401 Unauthorized

**Решение:**
- Проверить логи сервера для деталей ошибки
- Убедиться, что токен в cookie валидный (не истек)
- Проверить, что email пользователя соответствует `ADMIN_EMAIL`

### Проблема 3: CORS ошибка

**Симптомы:**
- Ошибка в консоли о CORS policy
- Cookie не отправляется

**Решение:**
- Убедиться, что `credentials: 'include'` установлен в fetch options
- Проверить, что CORS настроен правильно (`Access-Control-Allow-Credentials: true`)
- Проверить, что `SameSite=None` установлен для cookie (для cross-origin)

---

## Успешное завершение тестирования

### Критерии успеха:

- ✅ Изображения загружаются без ошибок
- ✅ Аудио файлы загружаются без ошибок
- ✅ Cookie устанавливается и отправляется с запросом
- ✅ Fallback на Authorization header работает при отсутствии cookie
- ✅ Логи сервера не показывают ошибок авторизации
- ✅ Файлы успешно сохраняются в Supabase Storage

---

## Следующие шаги

После успешного тестирования:

1. ✅ Проблема с 401 Unauthorized при загрузке файлов решена
2. ✅ Гибридная авторизация работает надежно
3. ✅ Система готова к продакшену

### Дополнительные улучшения (опционально):

1. Добавить логирование для мониторинга, какой метод авторизации используется
2. Добавить метрики для отслеживания успешности каждого метода
3. Рассмотреть применение cookie авторизации к другим POST запросам (если нужно)


