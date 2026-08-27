import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { pathToFileURL } from 'node:url'
import { scriptPath } from '@/lib/pipeline-root'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({})) as { limit?: number; sourceId?: string }
  try {
    const mod = await import(pathToFileURL(scriptPath('ingest.mjs')).href) as {
      ingestNews: (opts: { limit?: number; sourceId?: string }) => Promise<unknown>
    }
    const result = await mod.ingestNews({
      limit: body.limit,
      sourceId: body.sourceId,
    })
    return json(result, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'ingest failed' }, { status: 500 }, request)
  }
}
