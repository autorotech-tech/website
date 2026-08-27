# Инструкция по тестированию гибридной авторизации в браузере

## Предварительные условия

✅ **Backend развернут:**
- `/home/vladx/autoro-blog/app/api/admin/upload/route.ts` - гибридная авторизация реализована
- Контейнер `autoro-blog-nextjs` работает

✅ **Frontend развернут:**
- `BlogPostEditor.tsx` обновлен в контейнере `autoro-frontend`
- Контейнер перезапущен

---

## Тест 1: Загрузка изображения (основной сценарий)

### Шаги:

1. **Открыть админ-панель:**
   ```
   https://swoop.autoro.tech/admin/blog
   ```

2. **Залогиниться:**
   - Если не залогинен, нажать "Continue with Google"
   - Пройти проверку Turnstile
   - Авторизоваться через Google OAuth

3. **Открыть редактор поста:**
   - Нажать "New Post" или открыть существующий пост для редактирования

4. **Загрузить изображение:**
   - В разделе "Featured Image" нажать "Upload Image"
   - Выбрать изображение (JPEG, PNG, WebP, до 10MB)

### Проверка в DevTools:

1. **Открыть DevTools** (F12 или Cmd+Option+I)
2. **Перейти на вкладку Network**
3. **Найти запрос:**
   - Фильтр: `upload`
   - Метод: `POST`
   - URL: `https://cdn.autoro.tech/api/blog/admin/upload`

4. **Проверить Request Headers:**
   - ✅ `Cookie: sb-access-token=eyJhbGci...` (должен присутствовать)
   - ✅ `Authorization: Bearer eyJhbGci...` (fallback, должен присутствовать)
   - ✅ `Content-Type: multipart/form-data; boundary=...`

5. **Проверить Response:**
   - ✅ Status: `200 OK` (не 401!)
   - ✅ Body: JSON с полями:
     ```json
     {
       "url": "https://...",
       "path": "image/...",
       "bucket": "blog-images",
       "type": "image",
       "size": 123456,
       "filename": "image.jpg"
     }
     ```

6. **Проверить Console (вкладка Console в DevTools):**
   - ❌ Не должно быть ошибок типа "401 Unauthorized"
   - ❌ Не должно быть CORS ошибок

### Ожидаемый результат:

✅ Изображение успешно загружается
✅ URL изображения отображается в форме
✅ Изображение можно увидеть (preview)

---

## Тест 2: Загрузка аудио файла

### Шаги:

1. В редакторе поста найти раздел "Audio File"
2. Нажать "Upload Audio"
3. Выбрать аудио файл (MP3, M4A, WAV, OGG, до 10MB)

### Проверка:

- ✅ Загрузка успешна
- ✅ Аудио файл отображается с контролами воспроизведения
- ✅ URL аудио сохранен в форме

---

## Тест 3: Fallback на Authorization header

### Шаги:

1. Открыть DevTools → Application → Cookies
2. Найти cookie `sb-access-token` для домена `.autoro.tech`
3. **Удалить** эту cookie
4. Вернуться в редактор и загрузить изображение

### Проверка:

1. В Network проверить Request Headers:
   - ❌ `Cookie: sb-access-token=...` (отсутствует)
   - ✅ `Authorization: Bearer eyJhbGci...` (присутствует)

2. Проверить Response:
   - ✅ Status: `200 OK` (запрос все еще успешен благодаря fallback)

3. Проверить логи сервера:
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   docker logs autoro-blog-nextjs 2>&1 | grep -E 'Authorization header|Custom cookie' | tail -10
   ```
   - Должно быть сообщение об использовании Authorization header

---

## Тест 4: Проверка всех методов авторизации

### Проверка логов на сервере:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
docker logs -f autoro-blog-nextjs
```

**Ожидаемые логи при успешной загрузке:**
- "Validating via custom cookie sb-access-token..."
- "Custom cookie validation successful"
- ИЛИ "Custom cookie token validation failed" → "Authorization header used" (fallback)

---

## Возможные проблемы

### Проблема 1: Cookie не устанавливается

**Симптомы:**
- В Request Headers нет `Cookie: sb-access-token=...`
- Запрос работает через Authorization header (это нормально для fallback)

**Решение:**
- Проверить Console на ошибки JavaScript
- Проверить, что функция `setAuthCookie()` вызывается
- Проверить, что `session.access_token` существует

### Проблема 2: 401 Unauthorized даже с cookie

**Симптомы:**
- Cookie присутствует в запросе
- Ответ 401 Unauthorized

**Решение:**
- Проверить логи сервера: `docker logs autoro-blog-nextjs`
- Убедиться, что токен в cookie валидный (не истек)
- Проверить, что email пользователя соответствует `autoro.tech@gmail.com`

### Проблема 3: CORS ошибка

**Симптомы:**
- Ошибка в консоли о CORS policy
- Cookie не отправляется

**Решение:**
- Убедиться, что `credentials: 'include'` установлен
- Проверить CORS настройки на сервере
- Проверить, что `SameSite=None` установлен для cookie

---

## Чеклист успешного тестирования

- ✅ Изображения загружаются без ошибок
- ✅ Аудио файлы загружаются без ошибок
- ✅ Cookie `sb-access-token` устанавливается и отправляется
- ✅ Fallback на Authorization header работает при отсутствии cookie
- ✅ Логи сервера показывают успешную авторизацию
- ✅ Файлы успешно сохраняются в Supabase Storage
- ✅ Нет ошибок в Console браузера

---

## Готово к тестированию! 🚀

Все настроено и готово к проверке в браузере.


