import Link from 'next/link'
import type { Locale } from '@/lib/i18n'

type Props = {
  locale: Locale
  slug: string
  title: string
  excerpt?: string | null
  imageUrl?: string | null
  date?: string | null
  priority?: boolean
}

export function PostCard({ locale, slug, title, excerpt, imageUrl, date, priority = false }: Props) {
  return (
    <article className="overflow-hidden rounded-xl border border-hairline bg-white">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          width={800}
          height={420}
          className="h-44 w-full object-cover"
          fetchPriority={priority ? 'high' : 'low'}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : null}
      <div className="space-y-2 p-4">
        {date ? (
          <time className="text-xs text-muted" dateTime={date}>
            {new Date(date).toLocaleDateString(locale)}
          </time>
        ) : null}
        <h2 className="text-xl leading-snug text-ink">
          <Link href={`/${locale}/blog/${slug}`} className="hover:text-brand">
            {title}
          </Link>
        </h2>
        {excerpt ? <p className="text-sm text-body line-clamp-3">{excerpt}</p> : null}
        <p>
          <Link href={`/${locale}/blog/${slug}`} className="text-sm text-brand">
            Read
          </Link>
        </p>
      </div>
    </article>
  )
}
