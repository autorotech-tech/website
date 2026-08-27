# Развертывание upload/route.ts

## Проблема

Файл `upload/route.ts` существует локально, но не работает в контейнере, возвращает 401 Unauthorized.

## Решение

Файл нужно скопировать в директорию проекта на сервере и пересобрать контейнер.

### Шаги

1. **Скопировать файл на сервер:**
   ```bash
   scp -i ~/.ssh/id_ed25519_autoro \
     /Users/vlad_x/Desktop/n8n/autoro.tech/website/blog-autoro/app/api/admin/upload/route.ts \
     vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/upload/route.ts
   ```

2. **Пересобрать контейнер:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   cd /home/vladx/autoro-blog
   docker-compose build blog
   docker-compose up -d blog
   ```

3. **Проверить работу:**
   ```bash
   curl -X OPTIONS 'https://cdn.autoro.tech/api/blog/admin/upload' \
     -H 'Origin: https://swoop.autoro.tech' \
     -H 'Access-Control-Request-Method: POST'
   
   # Должен вернуть 204
   ```

---

## Текущий статус

- ✅ Файл скопирован на сервер
- ⚠️ Есть ошибка компиляции в другом файле (posts/route.ts)
- ⚠️ Нужно исправить ошибку компиляции перед пересборкой

---

## Альтернативное решение

Если пересборка не работает из-за ошибок компиляции, можно:
1. Исправить ошибку в posts/route.ts
2. Или использовать hot reload Next.js (если файл уже скопирован, он может работать после перезапуска)


