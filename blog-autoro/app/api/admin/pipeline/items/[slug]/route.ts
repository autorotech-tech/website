import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { loadPipelineLib } from '@/lib/pipeline-root'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

async function storeLib() {
  return loadPipelineLib<{
    getItem: (slug: string) => Record<string, unknown> | null
    saveItem: (item: Record<string, unknown>) => Record<string, unknown>
    deleteItem: (slug: string) => void
  }>('store.mjs')
}

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const store = await storeLib()
  const item = store.getItem(params.slug)
  if (!item) return json({ error: 'Not found' }, { status: 404 }, request)
  return json({ item }, {}, request)
}

export async function PUT(request: Request, { params }: { params: { slug: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const store = await storeLib()
  const current = store.getItem(params.slug)
  if (!current) return json({ error: 'Not found' }, { status: 404 }, request)
  const patch = await request.json().catch(() => ({}))
  const item = store.saveItem({ ...current, ...patch, slug: params.slug })
  return json({ item }, {}, request)
}

export async function DELETE(request: Request, { params }: { params: { slug: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const store = await storeLib()
  store.deleteItem(params.slug)
  return json({ ok: true }, {}, request)
}
