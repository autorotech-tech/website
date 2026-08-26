# Диагностика проблемы 503 в Nginx

## 🔍 Обнаруженные факты:

### ✅ Что работает:
1. **Nginx запущен** - процессы работают
2. **Конфигурация синтаксически правильная** - `nginx -t` проходит
3. **Файлы доступны** - `index.html` существует и читаемый
4. **Volume смонтирован** - `/usr/share/nginx/html` содержит файлы

### ❌ Проблема:
**Все запросы возвращают 503 Service Temporarily Unavailable**

## 🔎 Анализ:

### 1. Логи Nginx
- Логи идут в `/dev/stdout` и `/dev/stderr` (стандартный вывод Docker)
- В логах нет ошибок - только нормальные сообщения о запуске
- Это означает, что Nginx не видит проблему на своем уровне

### 2. Тестирование изнутри контейнера
```bash
curl -v http://127.0.0.1:80/ -H "Host: cdn.autoro.tech"
# Connection refused
```

**Проблема:** Nginx не слушает на `127.0.0.1:80` внутри контейнера.

### 3. Возможные причины 503:

#### A. Проблема с `try_files` в `location /`
```nginx
location / {
    root   /usr/share/nginx/html;
    index  index.html index.htm;
    try_files $uri $uri/ /index.html;
}
```

**Проблема:** `try_files` с `/index.html` может вызывать бесконечный цикл или ошибку, если файл не найден по абсолютному пути.

#### B. Проблема с server_name
Если `server_name` не совпадает с `Host: cdn.autoro.tech`, Nginx может использовать default server, который может быть настроен неправильно.

#### C. Проблема с доступом к файлам
Хотя файл читаемый, может быть проблема с правами доступа для процесса nginx.

## 🔧 Решения:

### Решение 1: Исправить `try_files` в `location /`

**Текущая конфигурация:**
```nginx
location / {
    root   /usr/share/nginx/html;
    index  index.html index.htm;
    try_files $uri $uri/ /index.html;
}
```

**Проблема:** `/index.html` - это абсолютный путь от root, но может вызывать проблемы.

**Исправление:**
```nginx
location / {
    root   /usr/share/nginx/html;
    index  index.html index.htm;
    try_files $uri $uri/ =404;
}
```

Или для SPA:
```nginx
location / {
    root   /usr/share/nginx/html;
    index  index.html index.htm;
    try_files $uri $uri/ /index.html =404;
}
```

### Решение 2: Проверить default server

Убедиться, что есть правильный default server или что `cdn.autoro.tech` в `server_name`.

### Решение 3: Добавить явную обработку ошибок

```nginx
error_page 404 /index.html;
error_page 500 502 503 504 /50x.html;
```

## 📋 План действий:

1. ✅ Проверить логи (сделано - нет ошибок)
2. ⏳ Исправить `try_files` в `location /`
3. ⏳ Проверить работу после исправления
4. ⏳ Проверить доступность через Gcore CDN

## 🎯 Следующий шаг:

Исправить `try_files` в `location /` и перезапустить Nginx.

