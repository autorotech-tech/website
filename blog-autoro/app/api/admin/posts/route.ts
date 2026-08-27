import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { listAdminPosts } from '@/lib/posts'
import { serviceClient } from '@/lib/supabase/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('page') || '1')
  const limit = Number(searchParams.get('limit') || '20')
  const status = searchParams.get('status') || undefined
  try {
    const data = await listAdminPosts({ page, limit, status })
    return json(data, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'list failed', posts: [] }, { status: 500 }, request)
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({})) as {
    slug?: string
    status?: string
    featured_image_url?: string
    audio_url?: string
    seo_keywords?: string[]
    translations?: Array<Record<string, unknown>>
  }
  try {
    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('blog_posts')
      .insert({
        slug: body.slug,
        status: body.status || 'draft',
        featured_image_url: body.featured_image_url || null,
        audio_url: body.audio_url || null,
        seo_keywords: body.seo_keywords || null,
        source: 'manual',
      })
      .select('id, slug')
      .single()
    if (error) throw error
    if (Array.isArray(body.translations) && body.translations.length) {
      const rows = body.translations.map((row) => ({ ...row, post_id: data.id }))
      const { error: trErr } = await supabase.from('blog_post_translations').insert(rows)
      if (trErr) throw trErr
    }
    return json({ post: data }, { status: 201 }, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'create failed' }, { status: 500 }, request)
  }
}
