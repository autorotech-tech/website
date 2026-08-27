# 🎨 Полное руководство по Shadcn UI

## 📦 Установленные компоненты

- ✅ `button` - Кнопки различных вариантов
- ✅ `card` - Карточки для контента
- ✅ `badge` - Бейджи и теги

## 🚀 Добавление новых компонентов

### Команда установки

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
npx shadcn@latest add [component-name]
```

### Популярные компоненты для блога

```bash
# Разделители
npx shadcn@latest add separator

# Аватары авторов
npx shadcn@latest add avatar

# Вкладки
npx shadcn@latest add tabs

# Выпадающие меню
npx shadcn@latest add dropdown-menu

# Модальные окна
npx shadcn@latest add dialog

# Формы
npx shadcn@latest add input
npx shadcn@latest add textarea
npx shadcn@latest add label
npx shadcn@latest add select

# Навигация
npx shadcn@latest add navigation-menu

# Уведомления
npx shadcn@latest add toast
npx shadcn@latest add alert

# Загрузка
npx shadcn@latest add skeleton
npx shadcn@latest add progress
```

### Просмотр всех доступных компонентов

```bash
npx shadcn@latest add
# Покажет интерактивное меню выбора
```

## 💻 Использование компонентов

### Базовый пример

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default function BlogPostCard({ post }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{post.title}</CardTitle>
        <Badge>{post.status}</Badge>
      </CardHeader>
      <CardContent>
        <p>{post.excerpt}</p>
        <Button>Читать далее</Button>
      </CardContent>
    </Card>
  )
}
```

### Button - Варианты

```tsx
import { Button } from "@/components/ui/button"

// Основные варианты
<Button variant="default">Default</Button>
<Button variant="destructive">Удалить</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Размеры
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon">🚀</Button>

// С иконкой
<Button>
  <Icon className="mr-2 h-4 w-4" />
  Текст
</Button>
```

### Card - Структура

```tsx
import {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>Заголовок</CardTitle>
    <CardDescription>Описание</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Контент карточки */}
  </CardContent>
  <CardFooter>
    {/* Футер карточки */}
  </CardFooter>
</Card>
```

### Badge - Варианты

```tsx
import { Badge } from "@/components/ui/badge"

<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Destructive</Badge>
<Badge variant="outline">Outline</Badge>
```

## 🎨 Кастомизация тем

### CSS переменные

Темы настраиваются через CSS переменные в `app/globals.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  /* ... другие переменные ... */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... темная тема ... */
}
```

### Кастомизация через Tailwind

```tsx
<Button className="bg-blue-500 hover:bg-blue-600">
  Кастомная кнопка
</Button>
```

## 📁 Структура файлов

```
components/
  ui/
    button.tsx      # Компонент кнопки
    card.tsx        # Компонент карточки
    badge.tsx       # Компонент бейджа
lib/
  utils.ts          # Утилита cn() для классов
```

## 🔧 Утилита cn()

Функция `cn()` объединяет классы Tailwind:

```tsx
import { cn } from "@/lib/utils"

// Условные классы
<Button className={cn(
  "base-classes",
  isActive && "active-classes",
  variant === "primary" && "primary-classes"
)}>
  Кнопка
</Button>
```

## 📝 Примеры использования в блоге

### Карточка поста

```tsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function PostCard({ post }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{post.title}</CardTitle>
          <Badge variant={post.status === 'published' ? 'default' : 'secondary'}>
            {post.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{post.excerpt}</p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" asChild>
          <a href={`/blog/${post.slug}`}>Читать →</a>
        </Button>
      </CardFooter>
    </Card>
  )
}
```

### Список постов с разделителями

```tsx
import { Separator } from "@/components/ui/separator"

{posts.map((post, index) => (
  <div key={post.id}>
    <PostCard post={post} />
    {index < posts.length - 1 && <Separator className="my-4" />}
  </div>
))}
```

## 🎯 Best Practices

1. **Импортируйте только нужные части:**
   ```tsx
   // ✅ Хорошо
   import { Card, CardHeader, CardTitle } from "@/components/ui/card"
   
   // ❌ Плохо (импортирует все)
   import * from "@/components/ui/card"
   ```

2. **Используйте asChild для кастомных элементов:**
   ```tsx
   <Button asChild>
     <Link href="/blog">К блогу</Link>
   </Button>
   ```

3. **Комбинируйте с Tailwind:**
   ```tsx
   <Card className="max-w-md mx-auto">
     {/* Кастомные стили через Tailwind */}
   </Card>
   ```

4. **Используйте variants вместо inline стилей:**
   ```tsx
   // ✅ Хорошо
   <Button variant="outline" size="sm">
   
   // ❌ Плохо
   <Button className="border outline small">
   ```

## 🔄 Обновление компонентов

```bash
# Обновить конкретный компонент
npx shadcn@latest add button --overwrite

# Обновить все компоненты (не рекомендуется)
# Лучше обновлять по одному
```

## 📚 Документация

- [Shadcn UI Docs](https://ui.shadcn.com)
- [Радикс UI (базовая библиотека)](https://www.radix-ui.com)
- [Tailwind CSS](https://tailwindcss.com)

---

**Последнее обновление:** 2026-01-06

