# Решение проблемы 503 в Nginx

## 🔍 Корневая причина:

**Проблема с правами доступа к файлам**

- Процесс Nginx работает от пользователя `nginx` (uid=101)
- Файлы принадлежат пользователю `1000` (vladx)
- Nginx не мог прочитать файлы из-за недостаточных прав

## 🔧 Решение:

### Исправление прав доступа:

```bash
# Внутри контейнера autoro-site
chmod 644 /usr/share/nginx/html/index.html
chmod 755 /usr/share/nginx/html
```

**Или на хосте:**
```bash
chmod 644 /home/vladx/projects/autoro.tech/html/index.html
chmod 755 /home/vladx/projects/autoro.tech/html
```

## ✅ Результат:

После исправления прав доступа:
- ✅ Nginx может читать файлы
- ✅ Запросы к `/` возвращают 200 OK
- ✅ `index.html` отдается корректно
- ✅ Статика работает через CDN

## 📝 Рекомендации:

### Для постоянного решения:

1. **Изменить владельца файлов на nginx:**
   ```bash
   chown -R nginx:nginx /usr/share/nginx/html
   ```
   Но это не сработает, так как volume смонтирован как read-only.

2. **Изменить права доступа на хосте:**
   ```bash
   chmod -R 755 /home/vladx/projects/autoro.tech/html
   find /home/vladx/projects/autoro.tech/html -type f -exec chmod 644 {} \;
   ```

3. **Или изменить пользователя Nginx в контейнере:**
   В `docker-compose.yml` или Dockerfile можно изменить пользователя Nginx, но это не рекомендуется.

## 🎯 Итог:

Проблема была в правах доступа. После исправления прав (`chmod 644` для файлов, `chmod 755` для директорий) Nginx смог читать файлы и отдавать их корректно.

