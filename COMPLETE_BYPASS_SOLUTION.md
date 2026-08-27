# Полное решение для обхода блокировки провайдера

## Проблема

Провайдер блокирует:
- Прямое соединение с autoro.tech
- Cloudflare
- VPN/WireGuard
- Core Tunnel блокирует большие файлы (загрузка аудио)

## Решение: Multi-CDN + Альтернативный домен

### Стратегия

Используем **несколько CDN одновременно** с альтернативным доменом, который провайдер не блокирует.

---

## Шаг 1: Настройка Bunny CDN (основной CDN)

### 1.1. Регистрация и создание Pull Zone

1. Зайди на **https://bunny.net**
2. Создай аккаунт (есть бесплатный пробный период)
3. **Storage** → **Pull Zones** → **Add Pull Zone**
4. Настройки:
   - **Name:** `autoro-main`
   - **Origin URL:** `http://46.250.228.229`
   - **Cache Expiration:** 86400
   - **Query String Varying:** Enabled
   - **Disable Cookies:** Disabled

5. Получишь домен: `autoro-main.b-cdn.net`

### 1.2. Настройка Edge Rules (не кэшировать API)

1. В Pull Zone → **Edge Rules** → **Add Rule**
2. Настройки:
   - **Name:** `Bypass API Cache`
   - **When:** Request URL matches `/api/*`
   - **Action:** Bypass Cache
   - **Enabled:** ON

### 1.3. Добавление Custom Hostname (если есть альтернативный домен)

Если у тебя есть альтернативный домен (например, `autoro-alt.tld`):

1. В Pull Zone → **Hostnames** → **Add Hostname**
2. Введи: `api-autoro-alt.tld`
3. SSL будет автоматически (Let's Encrypt)
4. В DNS твоего домена создай CNAME:
   ```
   api-autoro-alt.tld  CNAME  autoro-main.b-cdn.net
   ```

---

## Шаг 2: Настройка KeyCDN (резервный CDN)

На случай, если Bunny CDN тоже заблокируют:

1. Зайди на **https://www.keycdn.com**
2. Создай аккаунт
3. **Zones** → **Pull Zone**
4. Настройки:
   - **Origin URL:** `http://46.250.228.229`
   - **Name:** `autoro-backup`
5. Получишь домен: `autoro-backup.kxcdn.net`

---

## Шаг 3: Настройка на сервере

### 3.1. Обновление Nginx

```bash
# На сервере запусти скрипт
bash ~/update_nginx_for_cdn.sh

# Введи домены (можно несколько через пробел):
autoro-main.b-cdn.net autoro-backup.kxcdn.net api-autoro-alt.tld
```

Или вручную отредактируй `/home/vladx/projects/autoro.tech/html/default.conf`:

```nginx
server_name localhost autoro.tech www.autoro.tech autoro-main.b-cdn.net autoro-backup.kxcdn.net api-autoro-alt.tld;
```

### 3.2. Перезапуск Nginx

```bash
docker restart autoro-site
```

---

## Шаг 4: Обновление фронтенда

### 4.1. Создать файл `.env.production`:

```bash
# Основной CDN (Bunny)
VITE_BLOG_API_URL=https://autoro-main.b-cdn.net/api/blog

# Или если есть альтернативный домен:
# VITE_BLOG_API_URL=https://api-autoro-alt.tld/api/blog

# Резервный (KeyCDN) - можно переключиться вручную при необходимости
# VITE_BLOG_API_URL=https://autoro-backup.kxcdn.net/api/blog
```

### 4.2. Пересобрать фронтенд:

```bash
cd /path/to/frontend
npm run build
# или
docker-compose build frontend
docker-compose up -d frontend
```

---

## Шаг 5: Настройка автоматического переключения CDN (опционально)

Если хочешь автоматически переключаться между CDN при недоступности:

### 5.1. Создать утилиту для проверки доступности:

```typescript
// src/utils/cdnSelector.ts
const CDN_ENDPOINTS = [
  'https://autoro-main.b-cdn.net/api/blog',
  'https://autoro-backup.kxcdn.net/api/blog',
  'https://autoro.tech/api/blog', // Fallback на оригинал
]

export async function getAvailableCDN(): Promise<string> {
  for (const endpoint of CDN_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/admin/posts?page=1&limit=1`, {
        method: 'HEAD',
        mode: 'no-cors', // Просто проверяем доступность
      })
      return endpoint
    } catch (e) {
      continue
    }
  }
  return CDN_ENDPOINTS[0] // Fallback на первый
}
```

### 5.2. Использовать в компонентах:

```typescript
const [blogApiUrl, setBlogApiUrl] = useState('https://autoro-main.b-cdn.net/api/blog')

useEffect(() => {
  getAvailableCDN().then(setBlogApiUrl)
}, [])
```

---

## Решение для Core Tunnel

Если Core Tunnel блокирует загрузку файлов:

### Вариант A: Отключить Core Tunnel для CDN доменов

В Core Tunnel (если есть настройки исключений):
- Добавь в исключения: `*.b-cdn.net`, `*.kxcdn.net`, `api-autoro-alt.tld`

### Вариант B: Использовать прямой доступ через CDN

CDN домены обычно не блокируются провайдерами, так что можно работать без Core Tunnel для этих доменов.

---

## Проверка работоспособности

```bash
# Проверь доступность через CDN
curl -I https://autoro-main.b-cdn.net/api/blog/admin/posts

# Должны быть заголовки от Bunny CDN
# X-Cache: MISS или HIT
# Server: BunnyCDN
```

---

## Стоимость

- **Bunny CDN:** $1/TB (первые 10GB бесплатно)
- **KeyCDN:** ~$0.04/GB (первые 10GB бесплатно)
- **Итого:** Для небольшого трафика практически бесплатно

---

## Резюме

1. ✅ Настрой Bunny CDN (основной)
2. ✅ Настрой KeyCDN (резервный)
3. ✅ Обнови Nginx на сервере
4. ✅ Обнови переменные окружения фронтенда
5. ✅ Пересобери фронтенд
6. ✅ Используй CDN домен вместо autoro.tech

**Результат:** Доступ к сервисам будет работать даже при блокировке Cloudflare, VPN, WireGuard и прямого соединения с autoro.tech.

