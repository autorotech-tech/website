import { serviceClient } from './supabase/api-client'
import { DEFAULT_LOCALE, type Locale } from './i18n'

export type Translation = {
  language: string
  title: string
  content?: string
  excerpt?: string | null
  meta_title?: string | null
  meta_description?: string | null
}

export type BlogPost = {
  id: string
  slug: string
  status: string
  featured_image_url?: string | null
  published_at?: string | null
  created_at?: string
  updated_at?: string
  view_count?: number
  source_url?: string | null
  pipeline_slug?: string | null
  source?: string | null
  blog_post_translations?: Translation[]
}

function pickTranslation(post: BlogPost, locale: Locale) {
  const rows = post.blog_post_translations || []
  return rows.find((row) => row.language === locale) || rows.find((row) => row.language === DEFAULT_LOCALE) || rows[0] || null
}

export async function listPublishedPosts(locale: Locale, limit = 40): Promise<Array<BlogPost & { translation: Translation | null }>> {
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, slug, status, featured_image_url, published_at, created_at, view_count, source_url, pipeline_slug, source, blog_post_translations(language, title, excerpt, meta_title, meta_description)')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return (data || []).map((post) => ({
    ...(post as BlogPost),
    translation: pickTranslation(post as BlogPost, locale),
  }))
}

export async function getPublishedPost(slug: string, locale: Locale) {
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*, blog_post_translations(*)')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    post: data as BlogPost,
    translation: pickTranslation(data as BlogPost, locale),
  }
}

export async function listAdminPosts({ page = 1, limit = 20, status }: { page?: number; limit?: number; status?: string }) {
  const supabase = serviceClient()
  let query = supabase
    .from('blog_posts')
    .select('id, slug, status, created_at, updated_at, published_at, view_count, source, pipeline_slug, source_url, blog_post_translations(id, language, title, excerpt)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)
  if (status && status !== 'all') query = query.eq('status', status)
  const { data, error, count } = await query
  if (error) throw error
  return {
    posts: data || [],
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
    },
  }
}

type PipelineItem = {
  slug: string
  sourceUrl?: string
  langs: Record<string, { title?: string; excerpt?: string; html?: string; metaTitle?: string; metaDescription?: string }>
}

export async function approvePipelineItem(item: PipelineItem) {
  const supabase = serviceClient()
  const translations = Object.entries(item.langs || {})
    .filter(([, block]) => block?.title?.trim() && block?.html?.trim())
    .map(([language, block]) => ({
      language,
      title: block.title!.trim(),
      content: block.html,
      excerpt: block.excerpt || null,
      meta_title: block.metaTitle || block.title,
      meta_description: block.metaDescription || block.excerpt || null,
    }))
  if (!translations.length) {
    throw new Error('No translations to publish')
  }

  const { data: existing } = await supabase
    .from('blog_posts')
    .select('id')
    .or(`pipeline_slug.eq.${item.slug},slug.eq.${item.slug}`)
    .maybeSingle()

  const payload: Record<string, unknown> = {
    slug: item.slug,
    status: 'published',
    published_at: new Date().toISOString(),
    source: 'pipeline',
  }

  let postId = existing?.id as string | undefined
  if (postId) {
    const { error } = await supabase.from('blog_posts').update(payload).eq('id', postId)
    if (error) throw error
  } else {
    const insertPayload = { ...payload, pipeline_slug: item.slug, source_url: item.sourceUrl || null }
    const { data, error } = await supabase.from('blog_posts').insert(insertPayload).select('id').single()
    if (error) {
      const { data: retry, error: retryErr } = await supabase.from('blog_posts').insert(payload).select('id').single()
      if (retryErr) throw error
      postId = retry.id
    } else {
      postId = data.id
    }
    if (item.sourceUrl) {
      await supabase.from('blog_posts').update({ source_url: item.sourceUrl, pipeline_slug: item.slug }).eq('id', postId)
    }
  }

  await supabase.from('blog_post_translations').delete().eq('post_id', postId)
  const rows = translations.map((row) => ({ ...row, post_id: postId }))
  const { error: trErr } = await supabase.from('blog_post_translations').insert(rows)
  if (trErr) throw trErr
  return { id: postId, slug: item.slug }
}
