import fs from 'node:fs'
import path from 'node:path'
import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { pipelineRoot } from '@/lib/pipeline-root'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function settingsFile() {
  return path.join(pipelineRoot(), 'data', 'blog-settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

export function OPTIONS(request: Request) {
  return options(request)
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  return json({ settings: readSettings() }, {}, request)
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const next = typeof body === 'object' && body && !Array.isArray(body)
    ? (body.settings && typeof body.settings === 'object' ? body.settings : body)
    : {}
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), `${JSON.stringify(next, null, 2)}\n`)
  return json({ settings: next }, {}, request)
}
