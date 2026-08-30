import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BlogHeader } from '@/components/blog/BlogHeader'
import { PostCard } from '@/components/blog/PostCard'
import { isLocale, LOCALES, type Locale } from '@/lib/i18n'
import { listPublishedPosts } from '@/lib/posts'

export const dynamic = 'force-dynamic'

type Props = { params: { locale: string } }

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export function generateMetadata({ params }: Props): Metadata {
  const locale = params.locale
  return {
    title: 'Blog | Autoro.tech',
    alternates: {
      canonical: `https://autoro.tech/${locale}/blog`,
      languages: Object.fromEntries(LOCALES.map((code) => [code, `https://autoro.tech/${code}/blog`])),
    },
  }
}

export default async function BlogIndexPage({ params }: Props) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale as Locale
  let posts: Awaited<ReturnType<typeof listPublishedPosts>> = []
  let loadError: string | null = null
  try {
    posts = await listPublishedPosts(locale)
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load posts'
  }

  return (
    <div>
      <BlogHeader locale={locale} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-2 text-4xl text-ink">Blog</h1>
        <p className="mb-8 max-w-2xl text-body">
          AI marketing, ads, automation, models and implementation notes.
        </p>
        {loadError ? (
          <p className="text-muted">Feed is empty or the database is not configured yet.</p>
        ) : posts.length === 0 ? (
          <p className="text-muted">No published posts yet.</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {posts.map((post, index) => (
              <PostCard
                key={post.id}
                locale={locale}
                slug={post.slug}
                title={post.translation?.title || post.slug}
                excerpt={post.translation?.excerpt}
                imageUrl={post.featured_image_url}
                date={post.published_at || post.created_at}
                priority={index === 0}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
