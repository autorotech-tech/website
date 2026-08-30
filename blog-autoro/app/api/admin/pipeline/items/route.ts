import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { loadPipelineLib } from '@/lib/pipeline-root'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || 'all'
  const store = await loadPipelineLib<{ listItems: () => Array<Record<string, unknown>> }>('store.mjs')
  let items = store.listItems()
  if (status !== 'all') items = items.filter((row) => row.status === status)
  return json({ items, total: items.length }, {}, request)
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const store = await loadPipelineLib<{ createItem: (p: Record<string, unknown>) => Record<string, unknown> }>('store.mjs')
  const item = store.createItem(body)
  return json({ item }, { status: 201 }, request)
}
