# Исправление проблемы 503 в Nginx

## 🔍 Проблема:
Все запросы к корневому пути `/` возвращали **503 Service Temporarily Unavailable**.

## 🔎 Диагностика:

### Проверенные факты:
1. ✅ Nginx запущен и работает
2. ✅ Конфигурация синтаксически правильная
3. ✅ Файл `index.html` существует и читаемый
4. ✅ Права доступа корректные
5. ✅ Volume смонтирован правильно

### Обнаруженная проблема:
**`try_files` в `location /` вызывал ошибку 503**

## 🔧 Решение:

### Убрать `try_files` из `location /`

**Было:**
```nginx
location / {
    root   /usr/share/nginx/html;
    index  index.html index.htm;
    try_files $uri $uri/ /index.html =404;
}
```

**Стало:**
```nginx
location / {
    root   /usr/share/nginx/html;
    index  index.html index.htm;
}
```

**Почему это работает:**
- `index` директива автоматически обрабатывает запросы к `/` и возвращает `index.html`
- `try_files` не нужен для простой статики
- Упрощенная конфигурация более надежна

## ✅ Результат:

После исправления:
- ✅ Запросы к `/` возвращают 200 OK
- ✅ `index.html` отдается корректно
- ✅ Статика работает через CDN

## 📝 Итоговая конфигурация `location /`:

```nginx
# Root location - serve static HTML files
location / {
    root   /usr/share/nginx/html;
    index  index.html index.htm;
}
```

**Примечание:** Если в будущем понадобится SPA роутинг, можно вернуть `try_files`, но с правильным синтаксисом:
```nginx
try_files $uri $uri/ /index.html;
```

