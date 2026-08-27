import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { loadPipelineLib } from '@/lib/pipeline-root'

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
  const saved = store.saveItem({ ...item, status: 'rejected' })
  return json({ item: saved }, {}, request)
}
