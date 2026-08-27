import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BlogHeader } from '@/components/blog/BlogHeader'
import { isLocale, LOCALES, type Locale } from '@/lib/i18n'
import { getPublishedPost } from '@/lib/posts'

export const dynamic = 'force-dynamic'

type Props = { params: { locale: string; slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isLocale(params.locale)) return {}
  const locale = params.locale as Locale
  try {
    const data = await getPublishedPost(params.slug, locale)
    const title = data?.translation?.meta_title || data?.translation?.title || params.slug
    const description = data?.translation?.meta_description || data?.translation?.excerpt || ''
    return {
      title: `${title} | Autoro Blog`,
      description: description || undefined,
      alternates: {
        canonical: `https://autoro.tech/${locale}/blog/${params.slug}`,
        languages: Object.fromEntries(LOCALES.map((code) => [code, `https://autoro.tech/${code}/blog/${params.slug}`])),
      },
    }
  } catch {
    return { title: params.slug }
  }
}

export default async function BlogPostPage({ params }: Props) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale as Locale
  const data = await getPublishedPost(params.slug, locale).catch(() => null)
  if (!data?.translation) notFound()
  const { post, translation } = data

  return (
    <div>
      <BlogHeader locale={locale} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted">
          <a href={`/${locale}/blog`}>Blog</a>
        </p>
        <article className="prose-autoro mt-4">
          {post.featured_image_url ? (
            <img
              src={post.featured_image_url}
              alt=""
              width={1200}
              height={630}
              className="mb-6 w-full rounded-xl object-cover"
              fetchPriority="high"
              decoding="async"
            />
          ) : null}
          <div dangerouslySetInnerHTML={{ __html: translation.content || `<h1>${translation.title}</h1>` }} />
        </article>
        {post.source_url ? (
          <p className="mt-8 text-sm text-muted">
            Source:{' '}
            <a href={post.source_url} rel="nofollow noopener" target="_blank">
              {post.source_url}
            </a>
          </p>
        ) : null}
      </main>
    </div>
  )
}
