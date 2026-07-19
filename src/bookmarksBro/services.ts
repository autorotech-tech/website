import type {
  IdeaItem,
  KnowledgeExportBundle,
  KnowledgeItem,
  NoteItem,
  ReminderItem,
  SearchItem,
  SourceKind,
  TaskTokenUsage,
  AgentAction,
  AgentAutonomy,
  AgentContext,
  AgentDepth,
  StorageMode,
} from './types'
import { bookmarksAgentApiUrl } from './agentApiBase'
import { setUiSyncStatus } from './uiSyncStatus'
import {
  searchLocalVault,
  saveLocalBookmark,
  saveLocalNote,
  listLocalNotes,
} from './localVectorStore'

const IDEAS_KEY = 'bookmarks_bro_ideas'
const REMINDERS_KEY = 'bookmarks_bro_reminders'
const KNOWLEDGE_KEY = 'bookmarks_bro_knowledge'
const TOKENS_KEY = 'bookmarks_bro_tokens'
const WORKSPACE_KEY = 'bookmarks_bro_workspace_id'
const BOOTSTRAP_TOKEN_KEY = 'bookmarks_bro_bootstrap_token'

const fallbackDataset: SearchItem[] = [
  {
    id: 'demo-obsidian-1',
    source: 'Obsidian',
    title: 'AI Agents marketing hypotheses',
    snippet: 'Summary of experiments on content funnels and GPT idea generation processes.',
    link: 'obsidian://open?vault=Autoro&file=AI%20Agents%20Marketing',
    tags: ['ai', 'marketing', 'hypothesis'],
    relevance: 0.78,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-bookmark-1',
    source: 'Bookmarks',
    title: 'Competitive analysis of knowledge-base tools',
    snippet: 'Material on knowledge ingestion + vector search architecture.',
    link: 'https://example.com/knowledge-stack',
    tags: ['kb', 'architecture'],
    relevance: 0.73,
    createdAt: new Date().toISOString(),
  },
]

const fallbackNotes: NoteItem[] = [
  {
    id: 'note-obsidian-1',
    title: 'Unified Knowledge Base Plan',
    content: 'Idempotent ingestion pipeline with captured/enriched/indexed/searchable states.',
    source: 'Obsidian',
    tags: ['knowledge-base', 'architecture'],
    updatedAt: new Date().toISOString(),
    link: 'obsidian://open?vault=Autoro&file=Unified%20Knowledge%20Base%20Plan',
  },
]

function readLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeLocal<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function getCachedWorkspaceId(): string {
  const fromStorage = localStorage.getItem(WORKSPACE_KEY)
  if (fromStorage && fromStorage.trim()) return fromStorage.trim()
  return ''
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

export async function resolveWorkspaceId(): Promise<string> {
  const cached = getCachedWorkspaceId()
  if (cached) return cached

  try {
    const ensureRes = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspaces/ensure'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
    })
    if (ensureRes.ok) {
      const ensurePayload = (await ensureRes.json()) as { workspaceId?: string }
      const ensured = String(ensurePayload.workspaceId ?? '').trim()
      if (ensured) {
        localStorage.setItem(WORKSPACE_KEY, ensured)
        return ensured
      }
    }
  } catch {
    // best effort fallback to list endpoint
  }

  try {
    const listRes = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspaces'), {
      headers: bookmarksHeaders(),
    })
    if (listRes.ok) {
      const listPayload = (await listRes.json()) as { items?: Array<{ id?: string }> }
      const firstId = String(listPayload.items?.[0]?.id ?? '').trim()
      if (firstId) {
        localStorage.setItem(WORKSPACE_KEY, firstId)
        return firstId
      }
    }
  } catch {
    // no-op
  }

  localStorage.setItem(WORKSPACE_KEY, '1')
  return '1'
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function safeNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function parseUsage(payload: Record<string, unknown>, promptText: string, completionText: string) {
  const usage = (payload.usage ?? payload.tokenUsage ?? {}) as Record<string, unknown>
  const promptTokens = safeNumber(usage.prompt_tokens ?? usage.promptTokens) || estimateTokens(promptText)
  const completionTokens =
    safeNumber(usage.completion_tokens ?? usage.completionTokens) || estimateTokens(completionText)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  }
}

export async function listTaskTokenUsage(): Promise<TaskTokenUsage[]> {
  const localRows = readLocal<TaskTokenUsage>(TOKENS_KEY)
  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(
      bookmarksAgentApiUrl(`/api/v1/bookmarks/token-usage?workspaceId=${encodeURIComponent(workspaceId)}&limit=200`),
      {
        headers: bookmarksHeaders(),
      },
    )
    if (!response.ok) throw new Error(`token_usage_failed_${response.status}`)
    const payload = (await response.json()) as { items?: Array<Record<string, unknown>> }
    const rows = (payload.items ?? []).map((row, idx) => ({
      id: `srv-${idx}-${String(row.taskName ?? 'task')}`,
      taskName: String(row.taskName ?? 'unknown-task'),
      promptTokens: safeNumber(row.promptTokens),
      completionTokens: safeNumber(row.completionTokens),
      totalTokens: safeNumber(row.totalTokens),
      updatedAt: String(row.updatedAt ?? new Date().toISOString()),
    }))
    writeLocal(TOKENS_KEY, rows)
    return rows
  } catch {
    return localRows
  }
}

export async function upsertTaskTokenUsage(entry: Omit<TaskTokenUsage, 'id' | 'updatedAt'>): Promise<TaskTokenUsage[]> {
  const localCurrent = await listTaskTokenUsage()
  const workspaceId = await resolveWorkspaceId()
  try {
    await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/token-usage/log'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        taskName: entry.taskName,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        provider: 'bookmarks-bro-ui',
        model: 'inferred',
      }),
    })
  } catch {
    // best-effort server log
  }
  const existingLocal = localCurrent.find((row) => row.taskName === entry.taskName)
  if (existingLocal) {
    const next = localCurrent.map((row) =>
      row.taskName === entry.taskName
        ? {
            ...row,
            promptTokens: row.promptTokens + entry.promptTokens,
            completionTokens: row.completionTokens + entry.completionTokens,
            totalTokens: row.totalTokens + entry.totalTokens,
            updatedAt: new Date().toISOString(),
          }
        : row,
    )
    writeLocal(TOKENS_KEY, next)
    return next
  }

  const created: TaskTokenUsage = {
    id: `tok-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    ...entry,
  }
  const next = [created, ...localCurrent]
  writeLocal(TOKENS_KEY, next)
  return next
}

export function trackTelemetry(event: string, properties: Record<string, unknown>): void {
  const payload = {
    event,
    properties,
    ts: new Date().toISOString(),
  }
  try {
    const raw = localStorage.getItem('bookmarks_bro_telemetry')
    const events = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : []
    localStorage.setItem('bookmarks_bro_telemetry', JSON.stringify([payload, ...events].slice(0, 200)))
  } catch {
    // best-effort telemetry storage
  }
}

function mapSource(value: unknown): SourceKind {
  const source = String(value ?? '').toLowerCase()
  if (source.includes('obsidian')) return 'Obsidian'
  if (source.includes('link')) return 'Links'
  return 'Bookmarks'
}

function normalizeSearchItem(item: unknown, idx: number): SearchItem {
  const row = (item ?? {}) as Record<string, unknown>
  return {
    id: String(row.id ?? row.bookmarkId ?? `row-${idx}`),
    source: mapSource(row.source),
    title: String(row.title ?? row.url ?? 'Untitled'),
    snippet: String(row.snippet ?? row.summary ?? row.content ?? ''),
    link: typeof row.url === 'string' ? row.url : undefined,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    category: typeof row.category === 'string' ? row.category : undefined,
    relevance: Number(row.relevance ?? row.score ?? row.distance ?? 0),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
  }
}

export type LibraryFacets = {
  categories: string[]
  tags: string[]
}

export async function fetchLibraryFacets(workspaceId?: string): Promise<LibraryFacets> {
  const ws = workspaceId ?? (await resolveWorkspaceId())
  try {
    const response = await fetch(
      bookmarksAgentApiUrl(
        `/api/v1/bookmarks/library/facets?workspaceId=${encodeURIComponent(ws)}`,
      ),
      { headers: bookmarksHeaders() },
    )
    if (!response.ok) throw new Error(`facets_failed_${response.status}`)
    const payload = (await response.json()) as { categories?: unknown[]; tags?: unknown[] }
    return {
      categories: Array.isArray(payload.categories) ? payload.categories.map(String) : [],
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    }
  } catch {
    return { categories: [], tags: [] }
  }
}

export async function unifiedSearch(
  query: string,
  sourceFilter: SourceKind | 'All',
  options?: { semantic?: boolean },
): Promise<SearchItem[]> {
  const trimmed = query.trim()

  if (getStorageMode() === 'local') {
    const apiKey = getLocalGeminiApiKey()
    const localResults = await searchLocalVault({
      query: trimmed,
      sourceFilter,
      apiKey,
      limit: 20
    })
    trackTelemetry('search_success', {
      query: trimmed,
      sourceFilter,
      resultsCount: localResults.length,
      mode: 'local_indexeddb',
    })
    return localResults
  }

  const workspaceId = await resolveWorkspaceId()
  if (!trimmed) {
    return fallbackDataset.filter((row) => sourceFilter === 'All' || row.source === sourceFilter)
  }

  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/search'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        query: trimmed,
        limit: 20,
        semantic: options?.semantic ?? true,
      }),
    })
    if (!response.ok) throw new Error(`search_failed_${response.status}`)
    const payload = (await response.json()) as { items?: unknown[]; results?: unknown[] }
    const rows = payload.items ?? payload.results ?? []
    const normalized = rows.map(normalizeSearchItem)

    for (const item of normalized) {
      if (item.source === 'Bookmarks' || item.source === 'Links') {
        saveLocalBookmark(item).catch((e) => console.warn('Failed to cache bookmark:', e))
      }
    }

    const filtered = normalized.filter((row) => sourceFilter === 'All' || row.source === sourceFilter)
    trackTelemetry('search_success', {
      query: trimmed,
      sourceFilter,
      resultsCount: filtered.length,
      mode: 'semantic_or_keyword',
    })
    return filtered
  } catch {
    const local = fallbackDataset.filter((row) => {
      const hit =
        row.title.toLowerCase().includes(trimmed.toLowerCase()) ||
        row.snippet.toLowerCase().includes(trimmed.toLowerCase()) ||
        row.tags.some((tag) => tag.toLowerCase().includes(trimmed.toLowerCase()))
      return hit && (sourceFilter === 'All' || row.source === sourceFilter)
    })
    trackTelemetry('search_success', {
      query: trimmed,
      sourceFilter,
      resultsCount: local.length,
      mode: 'fallback_local',
    })
    return local
  }
}

export async function generateIdeasFromNotes(input: {
  searchItems: SearchItem[]
  task: string
}): Promise<{ ideas: IdeaItem[]; tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const ids = input.searchItems.map((item) => item.id)
  const workspaceId = await resolveWorkspaceId()
  if (!input.task.trim()) {
    return { ideas: [], tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
  }

  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/ai-recommend'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workspaceId, task: input.task, limit: 5 }),
    })
    if (!response.ok) throw new Error(`ai_recommend_failed_${response.status}`)
    const payload = (await response.json()) as { picks?: Array<Record<string, unknown>> }
    const now = new Date().toISOString()
    const ideas = (payload.picks ?? []).slice(0, 5).map((pick, index) => ({
      id: `idea-${Date.now()}-${index}`,
      title: String(pick.title ?? `Idea #${index + 1}`),
      context: String(pick.reason ?? pick.summary ?? 'Generated from related materials and notes.'),
      originRefs: ids,
      priority: 'medium' as const,
      status: 'draft' as const,
      createdAt: now,
    }))
    const usage = parseUsage(payload, input.task, ideas.map((item) => item.context).join('\n'))
    trackTelemetry('idea_created', {
      task: input.task,
      ideasCount: ideas.length,
      sourceCount: input.searchItems.length,
      mode: 'ai',
      totalTokens: usage.totalTokens,
    })
    return { ideas, tokenUsage: usage }
  } catch {
    const top = input.searchItems.slice(0, 3)
    const ideas = top.map((item, index) => ({
      id: `idea-fallback-${Date.now()}-${index}`,
      title: `Idea: ${item.title}`,
      context: `Based on ${item.source}: ${item.snippet.slice(0, 180)}`,
      originRefs: [item.id],
      priority: 'medium' as const,
      status: 'draft' as const,
      createdAt: new Date().toISOString(),
    }))
    const usage = {
      promptTokens: estimateTokens(input.task),
      completionTokens: estimateTokens(ideas.map((item) => item.context).join('\n')),
      totalTokens: estimateTokens(input.task) + estimateTokens(ideas.map((item) => item.context).join('\n')),
    }
    trackTelemetry('idea_created', {
      task: input.task,
      ideasCount: ideas.length,
      sourceCount: input.searchItems.length,
      mode: 'fallback',
      totalTokens: usage.totalTokens,
    })
    return { ideas, tokenUsage: usage }
  }
}

export async function generateIdeasFromDatabase(task: string): Promise<{
  ideas: IdeaItem[]
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
}> {
  const workspaceId = await resolveWorkspaceId()
  const cleanTask = task.trim()
  if (!cleanTask) {
    return { ideas: [], tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
  }

  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/ai-recommend'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        task: cleanTask,
        retrieveLimit: 64,
        maxPicks: 12,
        searchMode: 'hybrid',
      }),
    })
    if (!response.ok) throw new Error(`db_ai_recommend_failed_${response.status}`)
    const payload = (await response.json()) as { picks?: Array<Record<string, unknown>>; usage?: Record<string, unknown> }
    const now = new Date().toISOString()
    const ideas = (payload.picks ?? []).slice(0, 12).map((pick, index) => ({
      id: `db-idea-${Date.now()}-${index}`,
      title: String(pick.title ?? `Knowledge idea #${index + 1}`),
      context: String(pick.reason ?? pick.summary ?? 'Generated from personal knowledge base vectors.'),
      originRefs: [String(pick.bookmarkId ?? pick.url ?? `db-ref-${index}`)],
      priority: 'high' as const,
      status: 'draft' as const,
      createdAt: now,
    }))
    const usage = parseUsage(payload as Record<string, unknown>, cleanTask, ideas.map((item) => item.context).join('\n'))
    trackTelemetry('idea_created', {
      task: cleanTask,
      ideasCount: ideas.length,
      sourceCount: 'database',
      mode: 'db-wide',
      totalTokens: usage.totalTokens,
    })
    return { ideas, tokenUsage: usage }
  } catch {
    const fallbackIdea: IdeaItem = {
      id: `db-idea-fallback-${Date.now()}`,
      title: 'Knowledge synthesis needed',
      context: 'Failed to generate ideas from the database. Check API access and embeddings.',
      originRefs: ['db-fallback'],
      priority: 'medium',
      status: 'draft',
      createdAt: new Date().toISOString(),
    }
    const usage = {
      promptTokens: estimateTokens(cleanTask),
      completionTokens: estimateTokens(fallbackIdea.context),
      totalTokens: estimateTokens(cleanTask) + estimateTokens(fallbackIdea.context),
    }
    return { ideas: [fallbackIdea], tokenUsage: usage }
  }
}

export async function fetchObsidianNotesBridge(query: string): Promise<NoteItem[]> {
  const trimmed = query.trim()

  if (getStorageMode() === 'local') {
    const notes = await listLocalNotes()
    if (!trimmed) return notes
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(trimmed.toLowerCase()) ||
        note.content.toLowerCase().includes(trimmed.toLowerCase()) ||
        note.tags.some((tag) => tag.toLowerCase().includes(trimmed.toLowerCase())),
    )
  }

  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/knowledge/search'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workspaceId, query: trimmed || 'knowledge', limit: 20 }),
    })
    if (!response.ok) throw new Error(`notes_bridge_failed_${response.status}`)
    const payload = (await response.json()) as { items?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> }
    const rows = payload.items ?? payload.results ?? []
    const notes = rows.map((row, index) => ({
      id: String(row.id ?? `note-row-${index}`),
      title: String(row.title ?? row.url ?? 'Knowledge Note'),
      content: String(row.summary ?? row.snippet ?? row.content ?? ''),
      source: 'Obsidian' as const,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      updatedAt: String(row.updatedAt ?? row.createdAt ?? new Date().toISOString()),
      link: typeof row.url === 'string' ? row.url : undefined,
    }))

    for (const note of notes) {
      saveLocalNote(note).catch((e) => console.warn('Failed to cache local note:', e))
    }

    return notes
  } catch {
    if (!trimmed) return fallbackNotes
    return fallbackNotes.filter(
      (note) =>
        note.title.toLowerCase().includes(trimmed.toLowerCase()) ||
        note.content.toLowerCase().includes(trimmed.toLowerCase()) ||
        note.tags.some((tag) => tag.toLowerCase().includes(trimmed.toLowerCase())),
    )
  }
}

export async function exportKnowledgeBundle(
  query: string,
  options?: { semantic?: boolean; limit?: number },
): Promise<KnowledgeExportBundle> {
  const workspaceId = await resolveWorkspaceId()
  const payload = {
    workspaceId,
    query: query.trim() || 'knowledge',
    semantic: options?.semantic ?? true,
    limit: options?.limit ?? 120,
  }

  const response = await fetch(bookmarksAgentApiUrl('/api/v1/knowledge/export'), {
    method: 'POST',
    headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`knowledge_export_failed_${response.status}`)
  }
  return (await response.json()) as KnowledgeExportBundle
}

/** After UI hydration — otherwise the first local state save will overwrite server data with an empty snapshot. */
let bookmarksBroRemotePersist = false

export function setBookmarksBroRemotePersistEnabled(value: boolean): void {
  bookmarksBroRemotePersist = value
}

let workspaceUiPersistTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleWorkspaceUiPersist(): void {
  if (!bookmarksBroRemotePersist) return
  if (workspaceUiPersistTimer != null) clearTimeout(workspaceUiPersistTimer)
  workspaceUiPersistTimer = setTimeout(() => {
    workspaceUiPersistTimer = null
    setUiSyncStatus('syncing')
    void pushWorkspaceUiStateNow().then((ok) => setUiSyncStatus(ok ? 'synced' : 'error'))
  }, 700)
}

export async function pullWorkspaceUiState(): Promise<{
  ideas: IdeaItem[]
  reminders: ReminderItem[]
  knowledgeItems: KnowledgeItem[]
  updatedAt: string | null
} | null> {
  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(
      bookmarksAgentApiUrl(`/api/v1/bookmarks/workspace-ui-state?workspaceId=${encodeURIComponent(workspaceId)}`),
      { headers: bookmarksHeaders() },
    )
    if (!response.ok) {
      setUiSyncStatus('offline')
      return null
    }
    const payload = (await response.json()) as Record<string, unknown>
    const ideas = Array.isArray(payload.ideas) ? (payload.ideas as IdeaItem[]) : []
    const reminders = Array.isArray(payload.reminders) ? (payload.reminders as ReminderItem[]) : []
    const knowledgeItems = Array.isArray(payload.knowledgeItems)
      ? (payload.knowledgeItems as KnowledgeItem[])
      : []
    const updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : null
    return { ideas, reminders, knowledgeItems, updatedAt }
  } catch {
    setUiSyncStatus('offline')
    return null
  }
}

export async function pushWorkspaceUiStateNow(): Promise<boolean> {
  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspace-ui-state'), {
      method: 'PUT',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        ideas: readLocal<IdeaItem>(IDEAS_KEY),
        reminders: readLocal<ReminderItem>(REMINDERS_KEY),
        knowledgeItems: readLocal<KnowledgeItem>(KNOWLEDGE_KEY),
      }),
    })
    if (response.ok) setUiSyncStatus('synced')
    else setUiSyncStatus('error')
    return response.ok
  } catch {
    setUiSyncStatus('error')
    return false
  }
}

/** Force synchronization (button in UI). */
export async function syncWorkspaceUiStateNow(): Promise<boolean> {
  setUiSyncStatus('syncing')
  return pushWorkspaceUiStateNow()
}

export function listIdeas(): IdeaItem[] {
  return readLocal<IdeaItem>(IDEAS_KEY)
}

export function saveIdeas(next: IdeaItem[]): void {
  writeLocal(IDEAS_KEY, next)
  scheduleWorkspaceUiPersist()
}

export function listReminders(): ReminderItem[] {
  return readLocal<ReminderItem>(REMINDERS_KEY)
}

export function saveReminders(next: ReminderItem[]): void {
  writeLocal(REMINDERS_KEY, next)
  scheduleWorkspaceUiPersist()
}

export function listKnowledgeItems(): KnowledgeItem[] {
  return readLocal<KnowledgeItem>(KNOWLEDGE_KEY)
}

export function saveKnowledgeItems(next: KnowledgeItem[]): void {
  writeLocal(KNOWLEDGE_KEY, next)
  scheduleWorkspaceUiPersist()
}

export function buildKnowledgeDraft(items: SearchItem[], title: string): KnowledgeItem {
  return {
    id: `kb-${Date.now()}`,
    title: title.trim() || 'Knowledge Draft',
    summary: items.map((item) => `- ${item.title}: ${item.snippet}`).join('\n'),
    tags: Array.from(new Set(items.flatMap((item) => item.tags))).slice(0, 12),
    refs: items.map((item) => item.link ?? item.id),
    status: 'draft',
    createdAt: new Date().toISOString(),
  }
}

export function exportKnowledgeMarkdown(item: KnowledgeItem): string {
  const frontmatter = [
    '---',
    `title: "${item.title.replace(/"/g, '\\"')}"`,
    `status: "${item.status}"`,
    `tags: [${item.tags.map((tag) => `"${tag.replace(/"/g, '\\"')}"`).join(', ')}]`,
    `created_at: "${item.createdAt}"`,
    '---',
    '',
  ].join('\n')

  const refs = item.refs.map((ref) => `- ${ref}`).join('\n')
  return `${frontmatter}# ${item.title}\n\n## Summary\n${item.summary}\n\n## References\n${refs}\n`
}

export interface TelegramLinkStatus {
  linked: boolean
  chatId: string | null
  telegramUserId: string | null
  customBot: {
    username: string
    status: string
  } | null
}

export async function generateTelegramLinkCode(): Promise<{
  code: string
  botUsername: string
  expiresAt: string
}> {
  const workspaceId = await resolveWorkspaceId()
  const response = await fetch(
    bookmarksAgentApiUrl(`/api/v1/keept/telegram/link-code?workspaceId=${encodeURIComponent(workspaceId)}`),
    {
      method: 'POST',
      headers: bookmarksHeaders(),
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to generate link code')
  }
  return response.json()
}

export async function getTelegramLinkStatus(): Promise<TelegramLinkStatus> {
  const workspaceId = await resolveWorkspaceId()
  const response = await fetch(
    bookmarksAgentApiUrl(`/api/v1/keept/telegram/status?workspaceId=${encodeURIComponent(workspaceId)}`),
    {
      headers: bookmarksHeaders(),
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get telegram status')
  }
  return response.json()
}

export async function unlinkTelegram(): Promise<boolean> {
  const workspaceId = await resolveWorkspaceId()
  const response = await fetch(
    bookmarksAgentApiUrl(`/api/v1/keept/telegram/unlink?workspaceId=${encodeURIComponent(workspaceId)}`),
    {
      method: 'DELETE',
      headers: bookmarksHeaders(),
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to unlink telegram')
  }
  const payload = await response.json()
  return !!payload.ok
}

export async function saveTelegramCustomBotToken(botToken: string): Promise<{
  ok: boolean
  botUsername: string
  webhookUrl: string
}> {
  const workspaceId = await resolveWorkspaceId()
  const response = await fetch(
    bookmarksAgentApiUrl('/api/v1/keept/telegram/bot-token'),
    {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workspaceId, botToken }),
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save bot token')
  }
  return response.json()
}

export interface KeeptAgentResult {
  overview: string
  recommendations: SearchItem[]
  actions: AgentAction[]
  retrievalMode: string
  candidateCount: number
}

export async function runKeeptAgent(input: {
  task: string
  context: AgentContext
  depth: AgentDepth
  autonomy: AgentAutonomy
}): Promise<KeeptAgentResult> {
  const workspaceId = await resolveWorkspaceId()
  const cleanTask = input.task.trim()
  if (!cleanTask) {
    return { overview: 'No task specified.', recommendations: [], actions: [], retrievalMode: 'none', candidateCount: 0 }
  }

  const searchMode = input.context === 'kb' ? 'bookmarks' : input.context

  const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/ai-recommend'), {
    method: 'POST',
    headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      workspaceId,
      task: cleanTask,
      retrieveLimit: 32,
      maxPicks: 10,
      searchMode,
      depth: input.depth,
      autonomy: input.autonomy,
    }),
  })

  if (!response.ok) {
    throw new Error(`Agent run failed with status: ${response.status}`)
  }

  const payload = (await response.json()) as {
    overview?: string
    recommendations?: any[]
    picks?: any[]
    actions?: AgentAction[]
    retrievalMode?: string
    candidateCount?: number
  }

  const recs = (payload.recommendations ?? payload.picks ?? []).map(normalizeSearchItem)
  const actions = (payload.actions ?? []).map((act: any, index: number) => ({
    ...act,
    id: `act-${Date.now()}-${index}`,
    executed: false,
  }))

  return {
    overview: String(payload.overview ?? ''),
    recommendations: recs,
    actions,
    retrievalMode: String(payload.retrievalMode ?? ''),
    candidateCount: Number(payload.candidateCount ?? 0),
  }
}

export async function executeAgentAction(action: AgentAction): Promise<boolean> {
  if (action.executed) return true
  const workspaceId = await resolveWorkspaceId()

  if (action.type === 'create_task') {
    const currentIdeas = listIdeas()
    const newIdea: IdeaItem = {
      id: `idea-${Date.now()}`,
      title: action.title || 'Agent Suggested Task',
      context: action.description || 'No description provided.',
      originRefs: [],
      priority: 'medium',
      status: 'draft',
      createdAt: new Date().toISOString(),
    }
    saveIdeas([newIdea, ...currentIdeas])
    return true
  }

  if (action.type === 'create_knowledge') {
    const currentKB = listKnowledgeItems()
    const newKB: KnowledgeItem = {
      id: `kb-${Date.now()}`,
      title: action.title || 'Agent Knowledge Draft',
      summary: action.description || 'No summary provided.',
      tags: action.tags || [],
      refs: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
    }
    saveKnowledgeItems([newKB, ...currentKB])
    return true
  }

  if (action.type === 'create_reminder') {
    const currentReminders = listReminders()
    const remindAt = new Date(Date.now() + (action.minutesDelay || 60) * 60 * 1000).toISOString()
    const newReminder: ReminderItem = {
      id: `rem-${Date.now()}`,
      ideaId: `idea-agent-${Date.now()}`,
      title: action.title || 'Agent Reminder',
      remindAt,
      done: false,
    }
    saveReminders([newReminder, ...currentReminders])
    return true
  }

  if (action.type === 'modify_tags') {
    if (!action.bookmarkId || !action.tags) return false
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/modify-tags'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        bookmarkId: action.bookmarkId,
        tags: action.tags,
      }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to modify bookmark tags on backend')
    }
    return true
  }

  return false
}

export function getStorageMode(): StorageMode {
  return (localStorage.getItem('bookmarks_bro_storage_mode') as StorageMode) || 'cloud'
}

export function setStorageMode(mode: StorageMode): void {
  localStorage.setItem('bookmarks_bro_storage_mode', mode)
}

export function getLocalGeminiApiKey(): string {
  return localStorage.getItem('bookmarks_bro_local_gemini_api_key') || ''
}

export function setLocalGeminiApiKey(key: string): void {
  localStorage.setItem('bookmarks_bro_local_gemini_api_key', key)
}

export type WorkspaceOption = { id: string; name: string }

export async function listWorkspaces(): Promise<WorkspaceOption[]> {
  const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspaces'), {
    headers: bookmarksHeaders(),
  })
  if (!response.ok) {
    throw new Error(`workspaces_list_failed_${response.status}`)
  }
  const payload = (await response.json()) as { items?: Array<{ id?: string; name?: string }> }
  return (payload.items ?? []).map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? `Workspace ${row.id ?? ''}`),
  })).filter((row) => row.id)
}

export type KbFileEnrichResult = {
  ok?: boolean
  knowledgeItemId?: number
  kind?: string
  category?: string
  title?: string
  notePath?: string
  securityFlagged?: boolean
  extraction?: { method?: string; textLength?: number }
  obsidian?: { ok?: boolean }
}

export async function enrichKbFile(input: {
  workspaceId: string
  file: File
  kind?: string
  category?: string
  title?: string
  caption?: string
}): Promise<KbFileEnrichResult> {
  const form = new FormData()
  form.append('workspaceId', input.workspaceId)
  form.append('file', input.file)
  if (input.kind) form.append('kind', input.kind)
  if (input.category) form.append('category', input.category)
  if (input.title) form.append('title', input.title)
  if (input.caption) form.append('caption', input.caption)

  const response = await fetch(bookmarksAgentApiUrl('/api/v1/knowledge/files/enrich'), {
    method: 'POST',
    headers: bookmarksHeaders(),
    body: form,
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(String((err as { detail?: string }).detail || `file_enrich_failed_${response.status}`))
  }
  return (await response.json()) as KbFileEnrichResult
}

