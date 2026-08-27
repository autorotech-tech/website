import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { loadPipelineLib } from '@/lib/pipeline-root'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const sources = await loadPipelineLib<{ upsertSource: (row: Record<string, unknown>) => { sources: unknown[] } }>('sources.mjs')
  const doc = sources.upsertSource({ ...body, id: params.id })
  return json(doc, {}, request)
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const sources = await loadPipelineLib<{ deleteSource: (id: string) => { sources: unknown[] } }>('sources.mjs')
  const doc = sources.deleteSource(params.id)
  return json(doc, {}, request)
}
