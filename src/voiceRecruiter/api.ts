import { bookmarksAgentApiUrl } from '../bookmarksBro/agentApiBase'
import { DEFAULT_LLM_MODEL } from './types'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    'X-API-Key': apiKey,
  }
}

export async function chatCompletion(
  apiKey: string,
  messages: LlmMessage[],
  model = DEFAULT_LLM_MODEL,
): Promise<string> {
  const res = await fetch(bookmarksAgentApiUrl('/api/v1/chat/completions'), {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.55,
      max_tokens: 1200,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LLM ${res.status}: ${detail.slice(0, 280) || res.statusText}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const text = normalizeLlmContent(data.choices?.[0]?.message?.content)
  if (!text) throw new Error('Пустой ответ LLM')
  return text
}

function extractTextFromStructuredDump(raw: string): string {
  const chunks: string[] = []
  const jsonRe = /"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g
  const pyRe = /'type'\s*:\s*'text'\s*,\s*'text'\s*:\s*'((?:\\'|[^'])*)'/g
  for (const re of [jsonRe, pyRe]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(raw))) {
      const unescaped = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
      if (unescaped.trim()) chunks.push(unescaped)
    }
  }
  return chunks.join('\n').trim()
}

/** Swoop sometimes returns content as string, [{type,text}] parts, or a stringified dump. */
export function normalizeLlmContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return normalizeLlmContent(part)
        if (part && typeof part === 'object') {
          const p = part as { type?: string; text?: string; content?: string }
          if (p.type === 'thinking') return ''
          return String(p.text || p.content || '')
        }
        return ''
      })
      .join('')
      .trim()
  }
  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (
      trimmed.includes("'type': 'text'") ||
      trimmed.includes('"type": "text"') ||
      trimmed.includes("'type': 'thinking'")
    ) {
      const extracted = extractTextFromStructuredDump(trimmed)
      if (extracted) return extracted
    }
    return trimmed
  }
  if (content && typeof content === 'object') {
    const p = content as { text?: string; content?: string; type?: string }
    if (p.type === 'thinking') return ''
    return String(p.text || p.content || '').trim()
  }
  return ''
}

export async function transcribeUpload(
  apiKey: string,
  blob: Blob,
  filename = 'answer.webm',
  language = 'ru',
): Promise<string> {
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('language', language)
  const res = await fetch(bookmarksAgentApiUrl('/api/v1/media/transcribe-upload'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`STT ${res.status}: ${detail.slice(0, 280) || res.statusText}`)
  }
  const data = (await res.json()) as { ok?: boolean; transcript?: string; error?: string }
  const text = (data.transcript || '').trim()
  if (!text) throw new Error(data.error || 'Пустая транскрипция')
  return text
}

export async function synthesizeSpeech(
  apiKey: string,
  text: string,
  voice = 'nova',
): Promise<Blob> {
  const res = await fetch(bookmarksAgentApiUrl('/api/v1/media/speech'), {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice, model: 'tts-1' }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`TTS ${res.status}: ${detail.slice(0, 280) || res.statusText}`)
  }
  return res.blob()
}

/** Play TTS via Swoop; fall back to browser speechSynthesis. */
export async function speakText(
  apiKey: string,
  text: string,
): Promise<'swoop' | 'browser'> {
  const cleaned = text.replace(/===ИТОГ===[\s\S]*/i, '').trim()
  if (!cleaned) return 'browser'

  try {
    const blob = await synthesizeSpeech(apiKey, cleaned.slice(0, 3500))
    const url = URL.createObjectURL(blob)
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(url)
      audio.onended = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('audio_playback_failed'))
      }
      void audio.play().catch(reject)
    })
    return 'swoop'
  } catch {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve('browser')
        return
      }
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(cleaned.slice(0, 1500))
      utter.lang = 'ru-RU'
      utter.onend = () => resolve('browser')
      utter.onerror = () => resolve('browser')
      window.speechSynthesis.speak(utter)
    })
  }
}
