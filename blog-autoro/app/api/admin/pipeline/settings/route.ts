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
  const settings = await loadPipelineLib<{ loadSettings: () => Record<string, unknown> }>('settings.mjs')
  return json({ settings: settings.loadSettings() }, {}, request)
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const settings = await loadPipelineLib<{ saveSettings: (patch: Record<string, unknown>) => Record<string, unknown> }>('settings.mjs')
  const next = settings.saveSettings(body)
  return json({ settings: next }, {}, request)
}
