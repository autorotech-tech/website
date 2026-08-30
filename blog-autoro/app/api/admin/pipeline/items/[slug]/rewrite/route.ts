import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { pathToFileURL } from 'node:url'
import { scriptPath } from '@/lib/pipeline-root'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  try {
    const mod = await import(pathToFileURL(scriptPath('rewrite.mjs')).href) as {
      rewriteItem: (slug: string) => Promise<unknown>
    }
    const item = await mod.rewriteItem(params.slug)
    return json({ item }, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'rewrite failed' }, { status: 500 }, request)
  }
}
