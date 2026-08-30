# Настройка Custom Domain в Gcore CDN

## Где ввести домен в Gcore CDN

### Шаг 1: В интерфейсе Gcore CDN

1. **Найди раздел "Custom domain (to create a CNAME record)"**
   - Он находится в разделе **General** → **Custom domain**
   - В боковом меню: **OPTIONS** → **General** → **Custom domain**

2. **Текущее состояние:**
   - В поле уже введено: `autoro.tech`
   - Справа есть кнопка **"+"**

3. **Два варианта:**

---

### Вариант A: Использовать `autoro.tech` (уже введен)

**✅ Проще, но меняет основной домен**

1. Оставь `autoro.tech` как есть в поле
2. Нажми кнопку **"+"** (если нужно сохранить)
3. Gcore покажет CNAME: `cl-glc03b3ef4.gcdn.co`
4. В Cloudflare:
   - Найди **A-запись** для `autoro.tech`
   - Измени на **CNAME**:
     ```
     Type: CNAME
     Name: @
     Target: cl-glc03b3ef4.gcdn.co
     Proxy: 🟠 Proxied
     ```

**⚠️ Внимание:** Это заменит текущую A-запись для основного домена!

---

### Вариант B: Использовать `cdn.autoro.tech` (РЕКОМЕНДУЕТСЯ)

**✅ Безопаснее, не трогает основной домен**

1. **Кликни на поле** с `autoro.tech`
2. **Удали** `autoro.tech`
3. **Введи:** `cdn.autoro.tech`
4. Нажми **"+"** (если нужно добавить)
5. Сохрани изменения

6. В Cloudflare:
   - **DNS** → **Records** → **Add record**
   - Создай **CNAME**:
     ```
     Type: CNAME
     Name: cdn
     Target: cl-glc03b3ef4.gcdn.co
     Proxy: 🟠 Proxied
     TTL: Auto
     ```

7. Подожди 1-2 минуты для распространения DNS

8. Gcore автоматически создаст SSL сертификат для `cdn.autoro.tech`

---

## Пошаговая инструкция для Варианта B (cdn.autoro.tech)

### В Gcore CDN:

1. Перейди в **CDN resource** → **autoro.tech**
2. В боковом меню: **OPTIONS** → **General** → **Custom domain**
3. Найди поле с текстом `autoro.tech`
4. Кликни на поле → выдели весь текст → удали
5. Введи: `cdn.autoro.tech` (без http:// или https://)
6. Нажми **"+"** справа от поля (или кнопку сохранения)
7. Должно появиться сообщение об успешном добавлении

### В Cloudflare:

1. Зайди в **Cloudflare Dashboard** → домен **autoro.tech**
2. Перейди в **DNS** → **Records**
3. Нажми **Add record**
4. Заполни:
   ```
   Type: CNAME
   Name: cdn
   Target: cl-glc03b3ef4.gcdn.co
   Proxy status: 🟠 Proxied (важно!)
   TTL: Auto
   ```
5. Нажми **Save**

### Проверка:

Через 1-2 минуты проверь:

```bash
# В терминале
dig cdn.autoro.tech

# Должно показать CNAME на cl-glc03b3ef4.gcdn.co
```

Или в браузере:
- Перейди на `https://cdn.autoro.tech` (SSL будет автоматически)

---

## Если поле не редактируется

Если поле `autoro.tech` не редактируется:

1. **Удали существующий домен:**
   - Найди кнопку удаления (крестик или "-") рядом с `autoro.tech`
   - Удали его

2. **Добавь новый:**
   - Кликни на пустое поле или кнопку **"+"**
   - Введи `cdn.autoro.tech`
   - Сохрани

---

## Важно: Proxy status в Cloudflare

**🟠 Proxied (оранжевое облако) - ОБЯЗАТЕЛЬНО включено!**

Почему:
- Cloudflare проксирует запросы через свой CDN
- SSL сертификат автоматически
- Работает вместе с Gcore CDN
- Дополнительная защита

**❌ DNS only (серое облако) - НЕ используй!**

---

## Итоговая настройка

После настройки CNAME:

1. ✅ **Gcore CDN:** Custom domain = `cdn.autoro.tech`
2. ✅ **Cloudflare:** CNAME `cdn` → `cl-glc03b3ef4.gcdn.co` (Proxied)
3. ✅ **Nginx:** Уже поддерживает `cdn.autoro.tech`
4. ✅ **Frontend:** Обновить `.env.production`:
   ```bash
   VITE_BLOG_API_URL=https://cdn.autoro.tech/api/blog
   ```

---

## Проверка работы

После настройки подожди 2-3 минуты, затем:

1. **Проверь DNS:**
   ```bash
   dig cdn.autoro.tech
   ```

2. **Проверь доступность:**
   ```bash
   curl -I https://cdn.autoro.tech/api/blog
   ```

3. **В админке:**
   - Обнови `VITE_BLOG_API_URL`
   - Пересобери фронтенд
   - Проверь работу блога

