import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  try {
    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*, blog_post_translations(*)')
      .eq('id', params.id)
      .single()
    if (error) throw error
    return json({ post: data, ...data }, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'not found' }, { status: 404 }, request)
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  try {
    const supabase = serviceClient()
    const patch: Record<string, unknown> = {}
    for (const key of ['slug', 'status', 'featured_image_url', 'audio_url', 'seo_keywords']) {
      if (key in body) patch[key] = body[key]
    }
    if (body.status === 'published') patch.published_at = new Date().toISOString()
    const { error } = await supabase.from('blog_posts').update(patch).eq('id', params.id)
    if (error) throw error
    if (Array.isArray(body.translations)) {
      await supabase.from('blog_post_translations').delete().eq('post_id', params.id)
      const rows = (body.translations as Array<Record<string, unknown>>).map((row) => ({ ...row, post_id: params.id }))
      if (rows.length) {
        const { error: trErr } = await supabase.from('blog_post_translations').insert(rows)
        if (trErr) throw trErr
      }
    }
    return json({ ok: true }, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'update failed' }, { status: 500 }, request)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  try {
    const supabase = serviceClient()
    await supabase.from('blog_post_translations').delete().eq('post_id', params.id)
    const { error } = await supabase.from('blog_posts').delete().eq('id', params.id)
    if (error) throw error
    return json({ ok: true }, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'delete failed' }, { status: 500 }, request)
  }
}
