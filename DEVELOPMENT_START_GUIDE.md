# 🚀 Руководство по началу разработки блога

## ✅ Что готово

1. ✅ Next.js 15 и React 19 установлены
2. ✅ Shadcn UI настроен
3. ✅ Node.js обновлен до v24.12.0
4. ✅ MCP серверы подключены
5. ✅ Docker контейнер работает

## 🔌 Доступ к Dev серверу

### Команда SSH туннеля (для доступа к dev серверу)

**На вашем Mac, в отдельном терминале:**

```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 3000:localhost:3000 -N vladx@46.250.228.229
```

**Параметры:**
- `-L 3000:localhost:3000` - проброс локального порта 3000 → сервер порт 3000
- `-N` - только туннель, не выполнять команды
- Оставьте этот терминал открытым

**Затем на сервере (в другом терминале):**

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev
```

**Откройте в браузере:** http://localhost:3000

---

## 📋 Этап 1: Улучшение списка постов

### Шаг 1: Установка компонентов

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
npx shadcn@latest add skeleton separator
```

### Шаг 2: Создание компонентов

Используйте MCP серверы для помощи:
```
@tailwindcss Покажи пример адаптивной grid сетки для карточек
@nextjs-docs Как создать компонент списка в Next.js 15?
@filesystem Покажи структуру components/ui
```

**Создать:**
- `components/blog/PostCard.tsx` - карточка поста
- `components/blog/PostCardSkeleton.tsx` - skeleton для загрузки

### Шаг 3: Обновление страницы

Обновить `app/blog/page.tsx` для использования новых компонентов.

**Подробности:** См. `BLOG_DEVELOPMENT_PHASE1.md`

---

## 🎯 Использование MCP серверов

### Примеры запросов:

```
@nextjs-docs Как использовать Server Components для списка постов?
@tailwindcss Создай адаптивную grid сетку для карточек постов
@filesystem Покажи структуру app/blog
@puppeteer Сделай скриншот страницы блога
```

### При работе с компонентами:

```
@tailwindcss Покажи пример hover эффектов для карточек
@nextjs-docs Как оптимизировать изображения в Next.js 15?
```

### При работе с формами:

```
@nextjs-docs Как использовать Server Actions для сохранения формы?
@tailwindcss Покажи пример формы с валидацией
```

---

## 📦 Компоненты Shadcn UI для блога

### Уже установлены:
- `button`, `card`, `badge`

### Для установки:
```bash
npx shadcn@latest add skeleton separator
npx shadcn@latest add form input textarea
npx shadcn@latest add dialog toast tabs
```

---

## 🔄 Workflow разработки

1. **Редактируйте код локально** (на Mac в Cursor IDE)
2. **Используйте MCP серверы** для помощи
3. **Синхронизируйте на сервер:**
   ```bash
   rsync -avz -e "ssh -i ~/.ssh/id_ed25519_autoro" \
     --exclude 'node_modules' --exclude '.next' \
     ./ vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/blog-autoro/
   ```
4. **Проверяйте изменения** через SSH туннель (http://localhost:3000)

---

## ⚠️ Решение проблем

### pquoc.com SSL 525

**Статус:** Требует настройки контейнера для pquoc.com  
**Временное решение:** Работает через Cloudflare (не критично для разработки блога)

### Dev сервер не доступен

**Используйте SSH туннель** (см. команду выше)

---

## 📚 Документация

Все инструкции в директории `website/`:
- `BLOG_DEVELOPMENT_PLAN.md` - Полный план
- `BLOG_DEVELOPMENT_PHASE1.md` - Этап 1 (детально)
- `MCP_USAGE_GUIDE.md` - MCP серверы
- `SHADCN_UI_GUIDE.md` - Shadcn UI
- `START_BLOG_DEV.md` - Запуск dev сервера

---

**Готово к разработке!** Начните с Этапа 1. 🚀

