function swoopBase() {
  return String(process.env.SWOOP_API_BASE || 'https://swoop.autoro.tech').replace(/\/+$/, '')
}

function swoopKey() {
  return String(process.env.SWOOP_API_KEY || process.env.AUTORO_SCRAPE_API_KEY || process.env.AGENT_API_KEY || '').trim()
}

export function assertSwoopKey() {
  const key = swoopKey()
  if (!key) {
    throw new Error('SWOOP_API_KEY is required for blog-news LLM/scrape')
  }
  return key
}

export function extractJson(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('LLM response is not JSON')
  }
  return JSON.parse(body.slice(start, end + 1))
}

export async function chatCompletions({
  model,
  messages,
  temperature = 0.2,
  maxTokens = 8000,
  timeoutMs = 120000,
} = {}) {
  const key = assertSwoopKey()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${swoopBase()}/api/v1/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || undefined,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Swoop LLM HTTP ${res.status}: ${text.slice(0, 400)}`)
    }
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Swoop LLM non-JSON: ${text.slice(0, 400)}`)
    }
    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('Swoop LLM empty content')
    return { content, raw: data, model: data?.model || model }
  } finally {
    clearTimeout(timer)
  }
}

export async function chatJson(opts) {
  const result = await chatCompletions(opts)
  return { ...result, json: extractJson(result.content) }
}
