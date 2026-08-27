# Настройка GCore CDN для обхода блокировки России

## Проблема

`swoop.autoro.tech` не открывается с IP России - GCore CDN не справляется с обходом блокировки.

## Решения в GCore CDN

### Вариант 1: WAAP (Web Application and API Protection)

WAAP может помочь с обходом блокировок через различные техники.

**Настройка:**
1. В GCore CDN Dashboard → **CDN resource** → `cdn.autoro.tech`
2. Перейти в **OPTIONS** → **Security** → **WAAP**
3. Включить WAAP (если доступно в вашем тарифе)
4. Настроить правила для обхода блокировок

**Ограничения:**
- WAAP может быть недоступен в базовом тарифе
- Требует активации плана WAAP

---

### Вариант 2: IP Access Policy (если есть whitelist)

Если у вас есть список разрешенных IP адресов:

1. В GCore CDN → **OPTIONS** → **Access** → **IP access policy**
2. Включить IP access policy
3. Добавить разрешенные IP адреса или диапазоны

**Ограничения:**
- Не поможет, если блокировка на уровне провайдера/Роскомнадзора
- Нужен список разрешенных IP

---

### Вариант 3: Использовать другой CDN для обхода

**Bunny CDN:**
- Менее известен, может не блокироваться
- Дешевле ($1/TB)
- Простая настройка

**Настройка:**
1. Создать Pull Zone в Bunny CDN
2. Origin URL: `https://swoop.autoro.tech` или `http://46.250.228.229`
3. Получить домен типа `swoop-autoro.b-cdn.net`
4. В Cloudflare: CNAME `swoop-alt` → `swoop-autoro.b-cdn.net`
5. Использовать `swoop-alt.autoro.tech` для доступа из России

---

### Вариант 4: Cloudflare Tunnel

Cloudflare Tunnel создает зашифрованное соединение, которое сложнее заблокировать.

**Настройка:**
1. Установить `cloudflared` на сервере
2. Создать tunnel в Cloudflare Dashboard
3. Настроить маршрутизацию для `swoop.autoro.tech`
4. Использовать tunnel URL для доступа

---

### Вариант 5: Использовать VPN/Tunnel сервис

Настроить VPN или туннель для обхода блокировки на уровне сервера.

---

## Рекомендация

Для обхода блокировки России лучше всего использовать **Cloudflare Tunnel** или **Bunny CDN** как альтернативу GCore CDN.

GCore CDN не имеет встроенных функций для обхода блокировок на уровне провайдера/Роскомнадзора.

---

## Текущая архитектура

```
Browser (Russia) → GCore CDN → nginx-proxy → swoop.autoro.tech
```

Проблема: GCore CDN блокируется на уровне провайдера/Роскомнадзора.

---

## Альтернативная архитектура с обходом

```
Browser (Russia) → Bunny CDN / Cloudflare Tunnel → nginx-proxy → swoop.autoro.tech
```

Или:

```
Browser (Russia) → Cloudflare Tunnel → swoop.autoro.tech (напрямую)
```


