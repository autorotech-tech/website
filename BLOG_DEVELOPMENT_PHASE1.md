# 📝 Этап 1: Улучшение списка постов

## 🎯 Цель

Улучшить отображение списка постов на `/blog` используя компоненты Shadcn UI.

## 📋 Задачи

1. ✅ Установить необходимые компоненты Shadcn UI
2. ✅ Создать компонент `PostCard.tsx`
3. ✅ Обновить страницу списка постов
4. ✅ Добавить skeleton loading
5. ✅ Улучшить адаптивность

## 🚀 Начало работы

### Шаг 1: Установка компонентов Shadcn UI

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
npx shadcn@latest add skeleton separator
```

### Шаг 2: Создание компонента PostCard

**Файл:** `components/blog/PostCard.tsx`

```tsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import Image from "next/image"

interface PostCardProps {
  post: {
    id: string
    slug: string
    title: string
    excerpt: string
    featured_image_url?: string
    published_at?: string
    created_at: string
    blog_post_translations?: Array<{
      title: string
      excerpt: string
    }>
  }
}

export function PostCard({ post }: PostCardProps) {
  const t = post.blog_post_translations?.[0]
  const title = t?.title || 'Untitled'
  const excerpt = t?.excerpt || ''
  const date = post.published_at || post.created_at

  return (
    <Card className="group hover:shadow-lg transition-all duration-300 flex flex-col h-full">
      {post.featured_image_url && (
        <div className="relative w-full h-48 overflow-hidden rounded-t-lg">
          <img
            src={post.featured_image_url}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        </div>
      )}
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-xl line-clamp-2 group-hover:text-blue-600 transition-colors">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-grow">
        {excerpt && (
          <p className="text-muted-foreground line-clamp-3 mb-4">
            {excerpt}
          </p>
        )}
        <time className="text-sm text-muted-foreground">
          {new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </time>
      </CardContent>
      <CardFooter>
        <Button variant="outline" asChild className="w-full">
          <Link href={`/blog/${post.slug}`}>
            Читать далее →
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
```

### Шаг 3: Компонент Skeleton для загрузки

**Файл:** `components/blog/PostCardSkeleton.tsx`

```tsx
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function PostCardSkeleton() {
  return (
    <Card className="flex flex-col h-full">
      <Skeleton className="w-full h-48 rounded-t-lg" />
      <CardHeader>
        <Skeleton className="h-6 w-3/4 mb-2" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent className="flex-grow">
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-2/3 mb-4" />
        <Skeleton className="h-4 w-1/3" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-10 w-full" />
      </CardFooter>
    </Card>
  )
}
```

### Шаг 4: Обновление страницы списка

**Файл:** `app/blog/page.tsx`

Обновить, чтобы использовать:
- `PostCard` компонент
- `PostCardSkeleton` для загрузки
- Адаптивную сетку

### Шаг 5: Использование MCP серверов

При разработке используйте:[text](cause:%20%20%20ERR_INTERNAL_ERROR%3A%20context%20deadline%20exceeded)

```
@tailwindcss Создай адаптивную grid сетку для карточек постов
@nextjs-docs Как оптимизировать изображения в Next.js 15?
@filesystem Покажи структуру компонентов блога
```

---

## ✅ Критерии готовности

- [ ] Все посты отображаются в красивых карточках
- [ ] Skeleton loading при загрузке
- [ ] Адаптивный дизайн (mobile, tablet, desktop)
- [ ] Hover эффекты работают
- [ ] Изображения оптимизированы
- [ ] Ссылки ведут на правильные страницы

---

**Готово к началу разработки!**

