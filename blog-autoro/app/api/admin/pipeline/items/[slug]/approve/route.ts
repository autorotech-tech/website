import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { loadPipelineLib } from '@/lib/pipeline-root'
import { approvePipelineItem } from '@/lib/posts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const store = await loadPipelineLib<{
    getItem: (slug: string) => Record<string, unknown> | null
    saveItem: (item: Record<string, unknown>) => Record<string, unknown>
  }>('store.mjs')
  const item = store.getItem(params.slug)
  if (!item) return json({ error: 'Not found' }, { status: 404 }, request)
  try {
    const published = await approvePipelineItem({
      slug: String(item.slug),
      sourceUrl: String(item.sourceUrl || ''),
      langs: (item.langs || {}) as Record<string, { title?: string; excerpt?: string; html?: string; metaTitle?: string; metaDescription?: string }>,
    })
    const saved = store.saveItem({
      ...item,
      status: 'ready',
      publishedAt: new Date().toISOString(),
      publishedPostId: published.id,
    })
    return json({ item: saved, post: published }, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'approve failed' }, { status: 500 }, request)
  }
}
