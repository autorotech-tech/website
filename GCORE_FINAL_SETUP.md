# Финальная настройка Gcore CDN - Ответы на вопросы

## 1. Query String Forwarding - влияние на файлы

### ✅ Отключение НЕ влияет на загрузку файлов!

**Query String Forwarding** нужен **только** для:
- HLS видео-стриминга (playlists `.m3u8` → segments `.ts`)
- Передачи параметров между плейлистом и сегментами

**НЕ влияет на:**
- ✅ Обычные изображения (jpg, png, gif, webp)
- ✅ Аудио файлы (mp3, m4a, wav)
- ✅ Видео файлы (mp4, webm)
- ✅ Статические файлы (js, css)
- ✅ API запросы с query параметрами

**Почему?**
- У вас уже включен **"Ignore query string"** в Cache
- Это означает, что файлы кешируются без учета query параметров
- Для обычных файлов этого достаточно

**Вывод:** Отключение Query String Forwarding **безопасно** и **правильно** для вашего случая.

---

## 2. Правило "Static content" - проверка настроек

### ✅ Настройки выглядят правильно!

**Что у вас настроено:**
- Rule pattern: `/.*\.(js|css|bmp|jpg|jpeg|gif|png|svg|ico|json|ttf|ttc|otf|eot|woff|woff2|webp|zip|tgz|gz|rar|bz2|doc|docx|rtf|xls|xlsx|exe|pdf|ppt|pptx|txt|tar|mid|midi|wav|swf|flv|mp3|mp4)`
- CDN caching: ON
- Cache expiry: 4 days

### 🔧 Рекомендуемые улучшения:

1. **Добавить аудио форматы** (если их нет):
   - Добавить: `m4a`, `aac`, `ogg` в pattern
   - Или оставить как есть (mp3, wav уже есть)

2. **Увеличить TTL для статики:**
   - Изменить **Cache expiry** с "4 days" на **"1 year"** (31536000 секунд)
   - Статика редко меняется, можно кешировать дольше

3. **Origin pull protocol:**
   - Оставить **"Inherit from resource"** (если в ресурсе настроено HTTP)
   - Или выбрать **"HTTP"** (если origin на порту 80)

---

## 3. Нужно ли активировать шаблоны?

### ❌ "Let's Encrypt HTTP-01 challenge" - НЕ нужно

**Почему?**
- SSL сертификат уже настроен (видно в скриншотах: "Issuing status: Success")
- Этот шаблон нужен только для первоначальной настройки SSL
- Если SSL работает - шаблон не нужен

### ⚠️ "Image optimization" / "Image Stack" - НЕ доступно

**Почему?**
- В скриншотах видно: "Image Stack is not available on your tariff plan"
- Нужно обновить тарифный план
- Это опциональная функция для автоматической оптимизации изображений

**Альтернатива:**
- Оптимизируйте изображения вручную перед загрузкой
- Используйте WebP формат
- Сжимайте изображения локально

**Вывод:** Оба шаблона **не нужны** для текущей настройки.

---

## 4. Создание правила "Bypass API Cache"

### Нужно создать еще одно правило:

**Правило: Bypass API Cache**

1. **Create rule** → **Create blank rule**
2. **Rule name:** `Bypass API Cache`
3. **Match criteria** → **Rule pattern:**
   ```
   location ~* ^/api/
   ```
4. **Options** → **Add option** → Найдите **"CDN caching"** (в поиске введите "cach")
5. Настройки:
   - **Enable CDN caching:** OFF (или **Bypass Cache**)
   - **Enable:** ON
6. **Create rule**

**Почему важно:**
- API не должен кешироваться
- Каждый запрос должен идти на origin
- Это обеспечит актуальность данных

---

## 5. Проблема с 502 для статики

В терминале видно:
```
curl -I https://cdn.autoro.tech/static/js/main.js
HTTP/2 502
```

**Причина:** Origin сервер возвращает 503, поэтому CDN не может получить контент.

### Решение:

1. **Проверить доступность origin:**
   ```bash
   curl -I http://46.250.228.229/static/js/main.js
   ```

2. **Проверить настройки Origin в Gcore:**
   - IP: `46.250.228.229`
   - Port: `80`
   - Host header: `autoro.tech` (или `cdn.autoro.tech`)

3. **Проверить Nginx конфигурацию:**
   - Убедиться, что статика отдается правильно
   - Проверить location блоки для статики

---

## Итоговая конфигурация Rules

### Правило 1: Static content (уже создано) ✅
- Pattern: `/.*\.(js|css|...|mp3|mp4)$`
- CDN caching: ON
- Cache expiry: **Рекомендую изменить на "1 year"**

### Правило 2: Bypass API Cache (нужно создать) ⚠️
- Pattern: `location ~* ^/api/`
- CDN caching: **Bypass Cache** или **OFF**

### Правило 3: Cache Blog Pages (опционально)
- Pattern: `location ~* ^/(en|ru|es|it|fr|vi|kz)/blog`
- CDN caching: ON
- Cache expiry: 30 minutes

---

## Проверка работы после настройки

```bash
# Статика (должна кешироваться)
curl -I https://cdn.autoro.tech/static/js/main.js
# Ожидается: Cache-Control с max-age, X-Cache-Status: HIT

# API (не должен кешироваться)
curl -I "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"
# Ожидается: Cache-Control: no-cache или отсутствие кеширования

# Сжатие
curl -H "Accept-Encoding: gzip" -I https://cdn.autoro.tech/
# Ожидается: Content-Encoding: gzip
```

---

## Резюме

✅ **Query String Forwarding отключен** - правильно, не влияет на файлы
✅ **Static content правило создано** - хорошо, можно увеличить TTL до 1 year
❌ **Let's Encrypt шаблон** - не нужен (SSL уже работает)
❌ **Image Stack** - не доступен на вашем тарифе
⚠️ **Нужно создать правило Bypass API Cache** - важно для работы API

**Следующий шаг:** Создать правило "Bypass API Cache" для API endpoints.

