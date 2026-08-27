# 📋 План разработки блога Autoro.tech

## 🎯 Цели

1. ✅ Улучшить отображение списка постов
2. ✅ Улучшить страницы отдельных постов
3. ✅ Добавить редактирование постов в админке
4. ✅ Добавить markdown поддержку для GEO оптимизации

---

## 📝 Этап 1: Улучшение списка постов (`/blog`)

### Задачи:

1. **Использовать компоненты Shadcn UI**
   - Заменить текущие карточки на `Card` компонент
   - Добавить `Badge` для статусов
   - Использовать `Button` для "Читать далее"

2. **Улучшить дизайн**
   - Адаптивная сетка (grid)
   - Hover эффекты
   - Оптимизация изображений
   - Загрузка изображений (skeleton/shimmer)

3. **Оптимизация**
   - Lazy loading для изображений
   - Pagination или infinite scroll
   - Кэширование данных

### Используемые MCP:
- `@tailwindcss` - для стилей
- `@nextjs-docs` - для оптимизации Next.js 15
- `@filesystem` - для навигации по файлам

### Компоненты Shadcn UI:
```bash
npx shadcn@latest add skeleton
npx shadcn@latest add separator
```

### Файлы для изменения:
- `app/blog/page.tsx` - главная страница списка
- Создать компонент `components/blog/PostCard.tsx`

---

## 📝 Этап 2: Улучшение страницы поста (`/blog/[slug]`)

### Задачи:

1. **Markdown рендеринг**
   - Улучшить стили для markdown
   - Поддержка code blocks с подсветкой синтаксиса
   - Улучшить типографику

2. **SEO оптимизация**
   - Meta tags
   - Open Graph
   - Structured Data (JSON-LD)
   - Canonical URLs

3. **GEO оптимизация**
   - Hreflang tags для мультиязычности
   - Локализация дат и чисел
   - Географические теги

4. **UX улучшения**
   - Breadcrumbs
   - Related posts
   - Share buttons
   - Reading time

### Используемые MCP:
- `@nextjs-docs` - для metadata API
- `@tailwindcss` - для стилей prose

### Компоненты Shadcn UI:
```bash
npx shadcn@latest add separator
npx shadcn@latest add button
```

### Файлы для изменения:
- `app/blog/[slug]/page.tsx` - страница поста
- Создать `components/blog/PostContent.tsx`
- Создать `components/blog/Breadcrumbs.tsx`

---

## 📝 Этап 3: Редактирование постов в админке

### Задачи:

1. **Markdown редактор**
   - Интеграция WYSIWYG редактора (TipTap или аналогичный)
   - Preview режим
   - Автосохранение
   - История изменений

2. **Редактирование метаданных**
   - Title, excerpt, meta_description
   - Featured image upload
   - SEO keywords
   - Статус публикации

3. **GEO оптимизация в редакторе**
   - Выбор языка для перевода
   - Локализация контента
   - Географические теги
   - Hreflang настройки

4. **Улучшение UI админки**
   - Использовать Shadcn UI компоненты
   - Drag & drop для изображений
   - Валидация форм
   - Toast уведомления

### Используемые MCP:
- `@nextjs-docs` - для Server Actions
- `@tailwindcss` - для UI компонентов
- `@filesystem` - для работы с файлами

### Компоненты Shadcn UI:
```bash
npx shadcn@latest add form
npx shadcn@latest add textarea
npx shadcn@latest add input
npx shadcn@latest add dialog
npx shadcn@latest add toast
npx shadcn@latest add tabs
npx shadcn@latest add select
```

### Файлы для изменения:
- Создать `app/admin/blog/[id]/edit/page.tsx`
- Создать `components/admin/BlogEditor.tsx`
- Создать `components/admin/MarkdownEditor.tsx`
- Обновить `app/api/admin/posts/[id]/route.ts`

---

## 📝 Этап 4: Markdown для GEO оптимизации

### Задачи:

1. **Расширенный Markdown**
   - Поддержка custom blocks для GEO данных
   - Schema.org разметка
   - Локализация контента
   - Географические координаты

2. **GEO теги в контенте**
   - Поддержка `[geo:location]` синтаксиса
   - Автоматическая генерация hreflang
   - Локализация дат и чисел
   - Валюта и единицы измерения

3. **SEO улучшения**
   - Автоматическая генерация JSON-LD
   - Структурированные данные для статей
   - BreadcrumbList schema
   - Organization schema

### Используемые MCP:
- `@nextjs-docs` - для metadata
- `@filesystem` - для работы с файлами

### Библиотеки:
```bash
npm install remark-geo remark-schema rehype-raw
```

### Файлы для изменения:
- Создать `lib/markdown/geo.ts` - обработка GEO тегов
- Создать `lib/markdown/schema.ts` - генерация Schema.org
- Обновить `app/blog/[slug]/page.tsx` - интеграция

---

## 🚀 Пошаговый план разработки

### Неделя 1: UI компоненты

**День 1-2: Список постов**
- [ ] Установить компоненты Shadcn UI (skeleton, separator)
- [ ] Создать `PostCard.tsx` компонент
- [ ] Обновить `app/blog/page.tsx`
- [ ] Тестирование и стилизация

**День 3-4: Страница поста**
- [ ] Улучшить markdown рендеринг
- [ ] Добавить Breadcrumbs
- [ ] SEO meta tags
- [ ] Структурированные данные

**День 5: Редактор (базовая версия)**
- [ ] Создать страницу редактирования
- [ ] Базовая форма редактирования
- [ ] Сохранение через API

### Неделя 2: Редактор и GEO

**День 1-3: Markdown редактор**
- [ ] Интеграция TipTap или аналогичного
- [ ] Preview режим
- [ ] Автосохранение
- [ ] Загрузка изображений

**День 4-5: GEO оптимизация**
- [ ] GEO теги в markdown
- [ ] Hreflang генерация
- [ ] Schema.org разметка
- [ ] Тестирование

---

## 📦 Зависимости для установки

```bash
# Markdown редактор
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-markdown

# Markdown обработка
npm install remark-geo remark-schema rehype-raw rehype-pretty-code

# Формы
npm install react-hook-form @hookform/resolvers zod

# Утилиты
npm install date-fns
```

---

## 🎨 Компоненты Shadcn UI для установки

```bash
# Базовые
npx shadcn@latest add skeleton
npx shadcn@latest add separator
npx shadcn@latest add tabs

# Формы
npx shadcn@latest add form
npx shadcn@latest add input
npx shadcn@latest add textarea
npx shadcn@latest add select
npx shadcn@latest add label

# UI
npx shadcn@latest add dialog
npx shadcn@latest add toast
npx shadcn@latest add alert
npx shadcn@latest add progress
```

---

## 🔧 Использование MCP серверов

### При разработке компонентов:
```
@tailwindcss Создай responsive grid для списка карточек
@nextjs-docs Как использовать Server Components для списка постов?
@filesystem Покажи структуру компонентов блога
```

### При работе с формой:
```
@nextjs-docs Как использовать Server Actions для сохранения формы?
@tailwindcss Покажи пример формы с валидацией
```

### При работе с Markdown:
```
@nextjs-docs Как обработать markdown в Server Component?
@filesystem Покажи существующий код рендеринга markdown
```

---

## ✅ Критерии готовности

### Этап 1 (Список постов):
- [ ] Используются компоненты Shadcn UI
- [ ] Адаптивный дизайн
- [ ] Оптимизация изображений
- [ ] Работает на всех устройствах

### Этап 2 (Страница поста):
- [ ] Красивый markdown рендеринг
- [ ] SEO оптимизация
- [ ] Breadcrumbs
- [ ] Related posts

### Этап 3 (Редактор):
- [ ] Markdown редактор работает
- [ ] Можно редактировать все поля
- [ ] Автосохранение
- [ ] Загрузка изображений

### Этап 4 (GEO):
- [ ] GEO теги обрабатываются
- [ ] Hreflang генерируется
- [ ] Schema.org разметка
- [ ] Тестирование на разных языках

---

**Дата создания:** 2026-01-06  
**Статус:** Готов к началу разработки

