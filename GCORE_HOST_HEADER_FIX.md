# Исправление Host header в GCore CDN

## Проблема

nginx-proxy не имеет конфигурации для домена `autoro.tech` (нет контейнера с `VIRTUAL_HOST=autoro.tech`).

В GCore CDN установлен **Host header = `autoro.tech`**, что вызывает 503, потому что nginx-proxy не знает, куда проксировать запросы.

## Решение

Изменить **Host header** в GCore CDN с `autoro.tech` на `cdn.autoro.tech`.

### Шаги:

1. **В GCore CDN Dashboard:**
  - Перейдите в **CDN resource** → `cdn.autoro.tech`
  - В боковом меню: **OPTIONS** → **HTTP headers** → **Host header**
  - Убедитесь, что **"Change Host header"** включен (зеленый переключатель)
  - Измените **Custom Host header** с `autoro.tech` на `**cdn.autoro.tech`**
  - Сохраните изменения
2. **Проверка:**
  ```bash
   # Должен вернуть 401 (не 503)
   curl -I https://cdn.autoro.tech/api/blog/admin/posts \
     -H 'Origin: https://swoop.autoro.tech'
  ```

---

## Почему это работает?

- nginx-proxy имеет конфигурацию для `cdn.autoro.tech`
- upstream указывает на контейнер `autoro-blog-nextjs` (192.168.48.4:3000)
- файл `/etc/nginx/vhost.d/cdn.autoro.tech_location` содержит location `/api/blog/`
- GCore CDN будет отправлять запросы с правильным Host header

---

## Альтернативное решение (если нужно оставить autoro.tech)

Если по какой-то причине нужно использовать Host: `autoro.tech`, можно создать конфигурацию в nginx-proxy:

1. Создать файл `/etc/nginx/vhost.d/autoro.tech_location` (уже создан)
2. Добавить контейнер с `VIRTUAL_HOST=autoro.tech` или настроить nginx-proxy вручную

Но проще всего использовать `cdn.autoro.tech` в Host header.