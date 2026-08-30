import { LOCALES } from '@/lib/i18n'
import { listPublishedPosts } from '@/lib/posts'

export default async function sitemap() {
  const app = process.env.NEXT_PUBLIC_APP_URL || 'https://autoro.tech'
  const entries = LOCALES.map((locale) => ({
    url: `${app}/${locale}/blog`,
    lastModified: new Date(),
    alternates: {
      languages: Object.fromEntries(LOCALES.map((code) => [code, `${app}/${code}/blog`])),
    },
  }))
  try {
    const posts = await listPublishedPosts('en', 200)
    for (const post of posts) {
      entries.push({
        url: `${app}/en/blog/${post.slug}`,
        lastModified: post.published_at ? new Date(post.published_at) : new Date(),
        alternates: {
          languages: Object.fromEntries(LOCALES.map((code) => [code, `${app}/${code}/blog/${post.slug}`])),
        },
      })
    }
  } catch {
    // sitemap still lists locale indexes
  }
  return entries
}
