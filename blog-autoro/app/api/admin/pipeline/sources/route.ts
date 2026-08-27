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
  const sources = await loadPipelineLib<{ loadSources: () => { sources: unknown[] } }>('sources.mjs')
  return json(sources.loadSources(), {}, request)
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const sources = await loadPipelineLib<{ upsertSource: (row: Record<string, unknown>) => { sources: unknown[] } }>('sources.mjs')
  const doc = sources.upsertSource(body)
  return json(doc, { status: 201 }, request)
}
