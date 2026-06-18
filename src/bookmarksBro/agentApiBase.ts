/**
 * Base URL for agent-api queries (Bookmarks Bro, knowledge export).
 * Empty → relative paths `/api/v1/*` (dev: Vite proxy; prod: nginx on the same host as the SPA).
 * Explicit URL → needed for builds where UI and API are on different origins (Tauri webview, extension, separate CDN).
 */
export function bookmarksAgentApiBase(): string {
  const raw = import.meta.env.VITE_AGENT_API_BASE
  if (raw == null || String(raw).trim() === '') return ''
  return String(raw).trim().replace(/\/$/, '')
}

export function bookmarksAgentApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const base = bookmarksAgentApiBase()
  return base ? `${base}${normalized}` : normalized
}
