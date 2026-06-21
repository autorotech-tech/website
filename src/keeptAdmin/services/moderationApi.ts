import { bookmarksAgentApiUrl } from '../../bookmarksBro/agentApiBase'

const BOOTSTRAP_TOKEN_KEY = 'bookmarks_bro_bootstrap_token'

export interface ModerationItem {
  id: string
  workspaceId: string
  knowledgeItemId: string | null
  source: string
  url: string | null
  title: string | null
  redactedText: string
  redactedCategories: string[]
  promptInjection: boolean
  status: string
  createdAt: string
  resolvedAt: string | null
}

export interface WorkspaceItem {
  id: string
  name: string
}

export interface ProviderCatalogModel {
  id: string
  name: string
  provider: string
  contextLength?: number
}

function bookmarksHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  const apiKey = import.meta.env.VITE_BOOKMARKS_API_KEY?.trim()
  const bootstrapToken = localStorage.getItem(BOOTSTRAP_TOKEN_KEY)?.trim()
  if (bootstrapToken) {
    headers.Authorization = `Bearer ${bootstrapToken}`
  } else if (apiKey) {
    headers['X-API-Key'] = apiKey
  }
  return headers
}

export async function fetchWorkspaces(): Promise<WorkspaceItem[]> {
  try {
    const res = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspaces'), {
      headers: bookmarksHeaders(),
    })
    if (!res.ok) throw new Error(`workspaces_failed_${res.status}`)
    const payload = (await res.json()) as { items?: Array<{ id: string; name: string }> }
    return payload.items ?? []
  } catch (error) {
    console.error('Failed to fetch workspaces:', error)
    return []
  }
}

export async function fetchModerationItems(
  workspaceId: string,
  status: string = 'pending_approval'
): Promise<ModerationItem[]> {
  const res = await fetch(
    bookmarksAgentApiUrl(
      `/api/v1/keept/moderation/items?workspaceId=${encodeURIComponent(workspaceId)}&status=${encodeURIComponent(status)}`
    ),
    {
      headers: bookmarksHeaders(),
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch moderation items: ${res.status}`)
  }
  const data = await res.json()
  if (data && Array.isArray(data.items)) {
    return data.items
  }
  if (data && Array.isArray(data.results)) {
    return data.results
  }
  return Array.isArray(data) ? data : []
}

export async function resolveModerationItem(
  id: string,
  workspaceId: string,
  decision: 'approve' | 'reject'
): Promise<{ ok: boolean }> {
  const res = await fetch(bookmarksAgentApiUrl('/api/v1/keept/moderation/resolve'), {
    method: 'POST',
    headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id, workspaceId, decision }),
  })
  if (!res.ok) {
    throw new Error(`Failed to resolve moderation item: ${res.status}`)
  }
  return res.json()
}

export async function fetchProviderCatalog(): Promise<ProviderCatalogModel[]> {
  const res = await fetch(bookmarksAgentApiUrl('/api/v1/admin/provider-catalog'), {
    headers: bookmarksHeaders(),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch provider catalog: ${res.status}`)
  }
  const data = await res.json()
  if (data && Array.isArray(data.models)) {
    return data.models
  }
  if (data && Array.isArray(data.items)) {
    return data.items
  }
  return Array.isArray(data) ? data : []
}
