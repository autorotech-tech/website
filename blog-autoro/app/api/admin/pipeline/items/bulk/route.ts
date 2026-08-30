import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { loadPipelineLib, scriptPath } from '@/lib/pipeline-root'
import { approvePipelineItem } from '@/lib/posts'
import { pathToFileURL } from 'node:url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({})) as { action?: string; slugs?: string[] }
  const slugs = Array.isArray(body.slugs) ? body.slugs : []
  const action = body.action
  const store = await loadPipelineLib<{
    getItem: (slug: string) => Record<string, unknown> | null
    saveItem: (item: Record<string, unknown>) => Record<string, unknown>
  }>('store.mjs')
  const rewriteMod = action === 'rewrite'
    ? await import(pathToFileURL(scriptPath('rewrite.mjs')).href) as { rewriteItem: (slug: string) => Promise<Record<string, unknown>> }
    : null
  const results = []
  for (const slug of slugs) {
    try {
      if (action === 'reject') {
        const item = store.getItem(slug)
        if (item) results.push(store.saveItem({ ...item, status: 'rejected' }))
      } else if (action === 'rewrite' && rewriteMod) {
        results.push(await rewriteMod.rewriteItem(slug))
      } else if (action === 'approve') {
        const item = store.getItem(slug)
        if (!item) continue
        const published = await approvePipelineItem({
          slug: String(item.slug),
          sourceUrl: String(item.sourceUrl || ''),
          langs: (item.langs || {}) as Record<string, { title?: string; excerpt?: string; html?: string }>,
        })
        results.push(store.saveItem({ ...item, status: 'ready', publishedAt: new Date().toISOString(), publishedPostId: published.id }))
      }
    } catch (err) {
      results.push({ slug, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return json({ results }, {}, request)
}
