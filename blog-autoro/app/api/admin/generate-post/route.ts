import { json, options } from '@/lib/cors'
import { requireAdmin } from '@/lib/auth'
import { pathToFileURL } from 'node:url'
import { pipelineRoot } from '@/lib/pipeline-root'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return options(request)
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({})) as {
    prompt?: string
    conversation?: Array<{ role?: string; parts?: Array<{ text?: string }> }>
  }
  const prompt = body.prompt || body.conversation?.at(-1)?.parts?.[0]?.text || ''
  if (!prompt.trim()) return json({ error: 'prompt is required' }, { status: 400 }, request)
  try {
    const mod = await import(pathToFileURL(path.join(pipelineRoot(), 'scripts/blog-news/lib/swoop-llm.mjs')).href) as {
      chatCompletions: (opts: Record<string, unknown>) => Promise<{ content: string }>
    }
    const model = process.env.AUTORO_BLOG_REWRITE_MODEL || 'openrouter/anthropic/claude-3.7-sonnet'
    const { content } = await mod.chatCompletions({
      model,
      messages: [
        {
          role: 'system',
          content: 'You help draft Autoro.tech blog posts about AI marketing, ads and automation. Return markdown. Do not invent facts.',
        },
        { role: 'user', content: prompt },
      ],
    })
    return json({ content, text: content }, {}, request)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'generate failed' }, { status: 500 }, request)
  }
}
