# ✅ Готово к тестированию в браузере

## Статус развертывания

### Backend: ✅ РАЗВЕРНУТ

**Файл:** `/home/vladx/autoro-blog/app/api/admin/upload/route.ts`
- ✅ Гибридная авторизация реализована
- ✅ Проверка custom cookie `sb-access-token`
- ✅ Fallback на SSR cookies и Authorization header
- ✅ Контейнер работает

**Проверка:**
```bash
grep -A 5 'sb-access-token' /home/vladx/autoro-blog/app/api/admin/upload/route.ts
# ✅ Найдено: проверка custom cookie реализована
```

### Frontend: ✅ РАЗВЕРНУТ

**Файл:** `/app/src/components/BlogPostEditor.tsx` (в контейнере `autoro-frontend`)
- ✅ Функция `setAuthCookie()` добавлена
- ✅ Cookie устанавливается перед upload запросами
- ✅ `credentials: 'include'` добавлен
- ✅ Authorization header сохранен как fallback
- ✅ Контейнер перезапущен

**Проверка:**
```bash
docker exec autoro-frontend grep -c 'setAuthCookie' /app/src/components/BlogPostEditor.tsx
# ✅ Функция найдена
```

---

## Быстрая проверка перед тестом

### 1. Проверить контейнеры:

```bash
docker ps | grep -E 'autoro-blog-nextjs|autoro-frontend'
```

**Ожидаемый результат:**
- Оба контейнера работают (Status: Up)

### 2. Проверить доступность:

```bash
# Backend
curl -I http://localhost:3002
# Должен вернуть HTTP 307 (редирект - нормально)

# Frontend
curl -I https://swoop.autoro.tech
# Должен вернуть HTTP 200
```

### 3. Проверить CORS:

```bash
curl -X OPTIONS https://cdn.autoro.tech/api/blog/admin/upload \
  -H 'Origin: https://swoop.autoro.tech' \
  -H 'Access-Control-Request-Method: POST' \
  -v 2>&1 | grep -E '< Access-Control'
```

**Ожидаемый результат:**
- `Access-Control-Allow-Origin: https://swoop.autoro.tech`
- `Access-Control-Allow-Credentials: true`

---

## Инструкция для тестирования

См. файл **`BROWSER_TESTING_GUIDE.md`** для детальных инструкций.

### Краткая версия:

1. Открыть `https://swoop.autoro.tech/admin/blog`
2. Залогиниться
3. Открыть редактор поста
4. Загрузить изображение
5. Проверить в DevTools → Network:
   - Request содержит `Cookie: sb-access-token=...`
   - Response: `200 OK` (не 401!)

---

## Готово! 🚀

Все развернуто и готово к тестированию в браузере.


