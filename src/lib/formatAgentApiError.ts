/** Short user-facing message from agent-api / proxy failures (never raw HTML). */
export function formatAgentApiError(body: string, status?: number): string {
  const trimmed = String(body || '').trim()
  const code = status ?? 0

  if (trimmed.startsWith('<!') || trimmed.includes('<html') || trimmed.includes('cloudflare')) {
    if (code === 502 || code === 503 || code === 504) {
      return `${code} — agent-api недоступен через прокси. Проверьте контейнер autoro-agent-api и сеть Docker.`
    }
    return code ? `HTTP ${code} — сервер вернул HTML вместо JSON.` : 'Сервер вернул HTML вместо JSON.'
  }

  if (!trimmed) {
    return code ? `HTTP ${code}` : 'Неизвестная ошибка API'
  }

  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown; message?: unknown; error?: unknown }
    const detail = parsed.detail ?? parsed.message ?? parsed.error
    if (typeof detail === 'string' && detail.trim()) return detail.trim()
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0]
      if (typeof first === 'string') return first
      if (first && typeof first === 'object' && 'msg' in first) {
        return String((first as { msg: unknown }).msg)
      }
    }
  } catch {
    // not JSON
  }

  if (trimmed.length > 280) return `${trimmed.slice(0, 277)}…`
  return trimmed
}
