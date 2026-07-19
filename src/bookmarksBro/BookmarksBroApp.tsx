import { useEffect, useMemo, useState, useCallback } from 'react'
import JSZip from 'jszip'
import type { IdeaItem, KnowledgeItem, NoteItem, ReminderItem, SearchItem, SourceKind, TaskTokenUsage, AgentAction, AgentAutonomy, AgentContext, AgentDepth, StorageMode } from './types'
import { BOOKMARKS_BRO_BUILD } from './bookmarksBroBuild'
import {
  buildKnowledgeDraft,
  exportKnowledgeBundle,
  exportKnowledgeMarkdown,
  fetchObsidianNotesBridge,
  generateIdeasFromDatabase,
  generateIdeasFromNotes,
  listIdeas,
  listKnowledgeItems,
  listTaskTokenUsage,
  listReminders,
  pullWorkspaceUiState,
  pushWorkspaceUiStateNow,
  resolveWorkspaceId,
  syncWorkspaceUiStateNow,
  saveIdeas,
  saveKnowledgeItems,
  saveReminders,
  setBookmarksBroRemotePersistEnabled,
  trackTelemetry,
  unifiedSearch,
  fetchLibraryFacets,
  upsertTaskTokenUsage,
  generateTelegramLinkCode,
  getTelegramLinkStatus,
  unlinkTelegram,
  saveTelegramCustomBotToken,
  runKeeptAgent,
  executeAgentAction,
  getStorageMode,
  setStorageMode,
  getLocalGeminiApiKey,
  setLocalGeminiApiKey,
  enrichKbFile,
  listWorkspaces,
} from './services'
import {
  listLocalBookmarks,
  listLocalNotes,
  saveLocalBookmark,
  saveLocalNote,
  exportLocalVaultToJson,
  importLocalVaultFromJson,
  clearLocalVault,
  getLocalEmbeddingFromGemini,
} from './localVectorStore'
import type { TelegramLinkStatus } from './services'
import { getUiSyncStatus, subscribeUiSyncStatus, setUiSyncStatus, uiSyncStatusLabel } from './uiSyncStatus'
import type { UiSyncStatus } from './uiSyncStatus'

type TabKey = 'search' | 'notes' | 'ideas' | 'reminders' | 'knowledge' | 'settings'

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'search', label: 'Search' },
  { key: 'notes', label: 'Notes' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'knowledge', label: 'Knowledge Base' },
  { key: 'settings', label: 'Settings' },
]

function scheduleReminder(reminder: ReminderItem): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  const fireAt = new Date(reminder.remindAt).getTime() - Date.now()
  if (fireAt <= 0) return
  window.setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification(`Keep It For Me: ${reminder.title}`, {
        body: `Reminder for idea ${reminder.ideaId}`,
      })
    }
  }, fireAt)
}

export function BookmarksBroApp() {
  const [tab, setTab] = useState<TabKey>('search')
  const [query, setQuery] = useState('')
  const [taskForIdeas, setTaskForIdeas] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceKind | 'All'>('All')
  const [searchItems, setSearchItems] = useState<SearchItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [ideas, setIdeas] = useState<IdeaItem[]>(() => listIdeas())
  const [reminders, setReminders] = useState<ReminderItem[]>(() => listReminders())
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>(() => listKnowledgeItems())
  const [knowledgeTitle, setKnowledgeTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isNotesLoading, setIsNotesLoading] = useState(false)
  const [notesQuery, setNotesQuery] = useState('')
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [tokenUsage, setTokenUsage] = useState<TaskTokenUsage[]>([])
  const [exportQuery, setExportQuery] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [isDbIdeasLoading, setIsDbIdeasLoading] = useState(false)
  const [ingestValue, setIngestValue] = useState('')
  const [isIngesting, setIsIngesting] = useState(false)
  const [error, setError] = useState('')
  const [syncStatus, setSyncStatus] = useState<UiSyncStatus>(() => getUiSyncStatus())
  const [tagFilter, setTagFilter] = useState<string>('All')
  const [categoryFilter, setCategoryFilter] = useState<string>('All')
  const [kindFilter, setKindFilter] = useState<string>('All')
  const [ragMode, setRagMode] = useState<'semantic' | 'keyword'>('semantic')
  const [facetCategories, setFacetCategories] = useState<string[]>([])
  const [facetTags, setFacetTags] = useState<string[]>([])
  const KINDS = ['bookmark', 'note', 'idea', 'plan', 'development', 'task', 'article', 'prompt', 'contact', 'link']
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([])
  const [fileEnrichWorkspaceId, setFileEnrichWorkspaceId] = useState('')
  const [fileEnrichKind, setFileEnrichKind] = useState('note')
  const [fileEnrichCategory, setFileEnrichCategory] = useState('general')
  const [fileEnrichCaption, setFileEnrichCaption] = useState('')
  const [fileEnrichTitle, setFileEnrichTitle] = useState('')
  const [fileEnrichFiles, setFileEnrichFiles] = useState<File[]>([])
  const [fileEnrichLoading, setFileEnrichLoading] = useState(false)
  const [fileEnrichMessage, setFileEnrichMessage] = useState('')
  const [tgStatus, setTgStatus] = useState<TelegramLinkStatus | null>(null)
  const [tgStatusLoading, setTgStatusLoading] = useState(false)
  const [tgLinkCode, setTgLinkCode] = useState<{ code: string; botUsername: string; expiresAt: string } | null>(null)
  const [tgLinkCodeLoading, setTgLinkCodeLoading] = useState(false)
  const [tgLinkCodeError, setTgLinkCodeError] = useState('')
  const [customBotToken, setCustomBotToken] = useState('')
  const [customBotLoading, setCustomBotLoading] = useState(false)
  const [customBotError, setCustomBotError] = useState('')
  const [customBotSuccess, setCustomBotSuccess] = useState<{ botUsername: string; webhookUrl: string } | null>(null)

  const [agentContext, setAgentContext] = useState<AgentContext>('hybrid')
  const [agentDepth, setAgentDepth] = useState<AgentDepth>('quick')
  const [agentAutonomy, setAgentAutonomy] = useState<AgentAutonomy>('suggest')
  const [agentOverview, setAgentOverview] = useState('')
  const [agentActions, setAgentActions] = useState<AgentAction[]>([])

  const [storageMode, setStorageModeState] = useState<StorageMode>(() => getStorageMode())
  const [localGeminiKey, setLocalGeminiKeyState] = useState(() => getLocalGeminiApiKey())
  const [localStats, setLocalStats] = useState({ bookmarks: 0, notes: 0 })
  const [reindexProgress, setReindexProgress] = useState<number | null>(null)
  const [reindexTotal, setReindexTotal] = useState(0)
  const [reindexCurrent, setReindexCurrent] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ws = await resolveWorkspaceId()
      if (cancelled) return
      setWorkspaceId(ws)
      const facets = await fetchLibraryFacets(ws)
      if (!cancelled) {
        setFacetCategories(facets.categories)
        setFacetTags(facets.tags)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => subscribeUiSyncStatus(setSyncStatus), [])

  const fetchLocalStats = useCallback(async () => {
    try {
      const bCount = (await listLocalBookmarks()).length
      const nCount = (await listLocalNotes()).length
      setLocalStats({ bookmarks: bCount, notes: nCount })
    } catch (err) {
      console.warn('Failed to load local IndexedDB stats:', err)
    }
  }, [])

  useEffect(() => {
    void fetchLocalStats()
  }, [fetchLocalStats])

  useEffect(() => {
    let cancelled = false
    async function hydrateFromServer() {
      setUiSyncStatus('hydrating')
      await resolveWorkspaceId()
      const remote = await pullWorkspaceUiState()
      if (cancelled) return

      const localIdeas = listIdeas()
      const localRem = listReminders()
      const localKb = listKnowledgeItems()

      if (remote) {
        const serverEmpty =
          remote.ideas.length === 0 &&
          remote.reminders.length === 0 &&
          remote.knowledgeItems.length === 0
        const localHas =
          localIdeas.length > 0 || localRem.length > 0 || localKb.length > 0

        if (serverEmpty && localHas) {
          setIdeas(localIdeas)
          setReminders(localRem)
          setKnowledgeItems(localKb)
          saveIdeas(localIdeas)
          saveReminders(localRem)
          saveKnowledgeItems(localKb)
          const ok = await pushWorkspaceUiStateNow()
          setUiSyncStatus(ok ? 'synced' : 'error')
        } else {
          setIdeas(remote.ideas)
          setReminders(remote.reminders)
          setKnowledgeItems(remote.knowledgeItems)
          saveIdeas(remote.ideas)
          saveReminders(remote.reminders)
          saveKnowledgeItems(remote.knowledgeItems)
          setUiSyncStatus('synced')
        }
      } else {
        setUiSyncStatus('offline')
      }

      if (!cancelled) {
        setBookmarksBroRemotePersistEnabled(true)
        void listTaskTokenUsage().then(setTokenUsage).catch(() => setTokenUsage([]))
      }
    }
    void hydrateFromServer()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    async function loadWs() {
      const wsId = await resolveWorkspaceId()
      setWorkspaceId(wsId)
      setFileEnrichWorkspaceId(wsId)
    }
    void loadWs()
  }, [])

  useEffect(() => {
    if (tab !== 'knowledge') return
    void listWorkspaces()
      .then((items) => {
        setWorkspaces(items)
        if (!fileEnrichWorkspaceId && items[0]?.id) {
          setFileEnrichWorkspaceId(items[0].id)
        }
      })
      .catch(() => setWorkspaces([]))
  }, [tab, fileEnrichWorkspaceId])

  const fetchTgStatus = useCallback(async () => {
    setTgStatusLoading(true)
    try {
      const status = await getTelegramLinkStatus()
      setTgStatus(status)
      setTgStatusLoading(false)
    } catch (err: any) {
      console.error(err)
      setTgStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'settings') {
      void fetchTgStatus()
    }
  }, [tab, fetchTgStatus])

  const handleGenerateCode = async () => {
    setTgLinkCodeLoading(true)
    setTgLinkCodeError('')
    try {
      const result = await generateTelegramLinkCode()
      setTgLinkCode(result)
    } catch (err: any) {
      setTgLinkCodeError(err.message || 'Failed to generate link code')
    } finally {
      setTgLinkCodeLoading(false)
    }
  }

  const handleUnlink = async () => {
    if (!window.confirm('Are you sure you want to disconnect Telegram?')) return
    try {
      await unlinkTelegram()
      setTgLinkCode(null)
      await fetchTgStatus()
    } catch (err: any) {
      alert(err.message || 'Failed to disconnect')
    }
  }

  const handleSaveCustomBot = async (e: React.FormEvent) => {
    e.preventDefault()
    setCustomBotLoading(true)
    setCustomBotError('')
    setCustomBotSuccess(null)
    try {
      const result = await saveTelegramCustomBotToken(customBotToken)
      if (result.ok) {
        setCustomBotSuccess({ botUsername: result.botUsername, webhookUrl: result.webhookUrl })
        setCustomBotToken('')
        await fetchTgStatus()
      }
    } catch (err: any) {
      setCustomBotError(err.message || 'Failed to register bot token')
    } finally {
      setCustomBotLoading(false)
    }
  }

  const handleClearCache = () => {
    if (window.confirm('Clear cached workspace and offline data?')) {
      localStorage.removeItem('bookmarks_bro_workspace_id')
      localStorage.removeItem('bookmarks_bro_bootstrap_token')
      window.location.reload()
    }
  }

  useEffect(() => {
    saveIdeas(ideas)
  }, [ideas])

  useEffect(() => {
    saveReminders(reminders)
  }, [reminders])

  useEffect(() => {
    saveKnowledgeItems(knowledgeItems)
  }, [knowledgeItems])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  const handleStorageModeChange = (mode: StorageMode) => {
    setStorageMode(mode)
    setStorageModeState(mode)
    trackTelemetry('storage_mode_changed', { mode })
    void handleSearch()
    if (mode === 'local') {
      void fetchLocalStats()
    }
  }

  const handleExportLocalVault = async () => {
    try {
      const json = await exportLocalVaultToJson()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `keept-local-vault-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      trackTelemetry('local_vault_exported', {})
    } catch (err: any) {
      alert('Failed to export vault: ' + err.message)
    }
  }

  const handleImportLocalVault = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        const jsonText = event.target?.result as string
        const res = await importLocalVaultFromJson(jsonText)
        alert(`Vault successfully imported! Loaded ${res.bookmarksLoaded} bookmarks and ${res.notesLoaded} notes.`)
        await fetchLocalStats()
        void handleSearch()
        trackTelemetry('local_vault_imported', { bookmarks: res.bookmarksLoaded, notes: res.notesLoaded })
      } catch (err: any) {
        alert('Failed to import vault: ' + err.message)
      }
    }
    reader.readAsText(file)
  }

  const handleReindexLocalVault = async () => {
    const apiKey = localGeminiKey.trim()
    if (!apiKey) {
      alert('Please provide a Gemini API key in local settings first.')
      return
    }
    setReindexProgress(0)
    setReindexCurrent(0)
    try {
      const bookmarks = await listLocalBookmarks()
      const notes = await listLocalNotes()
      
      const unindexedBookmarks = bookmarks.filter(b => !(b as any).embedding || (b as any).embedding.length === 0)
      const unindexedNotes = notes.filter(n => !(n as any).embedding || (n as any).embedding.length === 0)
      const total = unindexedBookmarks.length + unindexedNotes.length
      
      if (total === 0) {
        alert('All local items are already indexed!')
        setReindexProgress(null)
        return
      }
      
      setReindexTotal(total)
      let count = 0
      
      for (const b of unindexedBookmarks) {
        const textToEmbed = `${b.title} ${b.snippet} ${b.tags.join(' ')}`
        const emb = await getLocalEmbeddingFromGemini(textToEmbed, apiKey)
        await saveLocalBookmark({ ...b, embedding: emb })
        count++
        setReindexCurrent(count)
        setReindexProgress(Math.round((count / total) * 100))
      }
      
      for (const n of unindexedNotes) {
        const textToEmbed = `${n.title} ${n.content} ${n.tags.join(' ')}`
        const emb = await getLocalEmbeddingFromGemini(textToEmbed, apiKey)
        await saveLocalNote({ ...n, embedding: emb })
        count++
        setReindexCurrent(count)
        setReindexProgress(Math.round((count / total) * 100))
      }
      
      alert('Database re-indexing complete!')
    } catch (err: any) {
      alert('Indexing paused due to error: ' + err.message)
    } finally {
      setReindexProgress(null)
      await fetchLocalStats()
    }
  }

  const selectedSearchItems = useMemo(
    () => searchItems.filter((item) => selectedIds.includes(item.id)),
    [searchItems, selectedIds],
  )
  const totalTokens = useMemo(() => tokenUsage.reduce((sum, item) => sum + item.totalTokens, 0), [tokenUsage])
  const publishedCount = useMemo(
    () => knowledgeItems.filter((item) => item.status === 'published').length,
    [knowledgeItems],
  )

  const allTags = useMemo(() => {
    const set = new Set<string>(facetTags)
    for (const item of searchItems) {
      if (item.tags) {
        for (const t of item.tags) {
          if (t && t.trim()) set.add(t.trim())
        }
      }
    }
    return Array.from(set).sort()
  }, [searchItems, facetTags])

  const filteredSearchItems = useMemo(() => {
    return searchItems.filter((item) => {
      if (tagFilter !== 'All' && !(item.tags && item.tags.includes(tagFilter))) return false
      if (categoryFilter !== 'All' && item.category !== categoryFilter) return false
      if (kindFilter !== 'All') {
        const itemKind = item.kind || (item.source === 'Bookmarks' ? 'bookmark' : undefined)
        if (itemKind !== kindFilter && !(item.tags || []).includes(kindFilter)) return false
      }
      return true
    })
  }, [searchItems, tagFilter, categoryFilter, kindFilter])

  async function handleSearch(): Promise<void> {
    setIsLoading(true)
    setError('')
    setAgentOverview('')
    setAgentActions([])
    try {
      const result = await runKeeptAgent({
        task: query,
        context: agentContext,
        depth: agentDepth,
        autonomy: agentAutonomy,
      })
      setSearchItems(result.recommendations)
      setAgentOverview(result.overview)
      setAgentActions(result.actions)

      if (agentAutonomy === 'act' && result.actions.length > 0) {
        for (const act of result.actions) {
          try {
            await executeAgentAction(act)
            act.executed = true
          } catch (err: any) {
            console.error('Failed to auto-execute action:', err)
          }
        }
        // Refresh local lists
        setIdeas(listIdeas())
        setReminders(listReminders())
        setKnowledgeItems(listKnowledgeItems())
      }

      setSelectedIds([])
      setTagFilter('All')
      setCategoryFilter('All')
    } catch (err: any) {
      console.warn('Agent search failed, falling back to basic search:', err)
      try {
        const rows = await unifiedSearch(query, sourceFilter, {
          semantic: ragMode === 'semantic',
        })
        setSearchItems(rows)
        setSelectedIds([])
        setTagFilter('All')
        setCategoryFilter('All')
      } catch {
        setError('Failed to perform search. Check backend and data access.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function handleExecuteAction(action: AgentAction): Promise<void> {
    try {
      const ok = await executeAgentAction(action)
      if (ok) {
        setAgentActions((prev) =>
          prev.map((act) => (act.id === action.id ? { ...act, executed: true } : act))
        )
        // Refresh local lists
        setIdeas(listIdeas())
        setReminders(listReminders())
        setKnowledgeItems(listKnowledgeItems())
      }
    } catch (err: any) {
      setError(err.message || 'Failed to execute action')
    }
  }

  function toggleSelect(id: string): void {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleGenerateIdeas(): Promise<void> {
    if (!selectedSearchItems.length) {
      setError('Please select at least one search result to generate ideas.')
      return
    }
    setError('')
    const generated = await generateIdeasFromNotes({
      searchItems: selectedSearchItems,
      task: taskForIdeas || 'Generate ideas based on selected materials.',
    })
    setIdeas((prev) => [...generated.ideas, ...prev])
    const updatedUsage = await upsertTaskTokenUsage({
        taskName: taskForIdeas || 'ideas-default-task',
        promptTokens: generated.tokenUsage.promptTokens,
        completionTokens: generated.tokenUsage.completionTokens,
        totalTokens: generated.tokenUsage.totalTokens,
      })
    setTokenUsage(updatedUsage)
    setTab('ideas')
  }

  async function handleGenerateIdeasFromDb(): Promise<void> {
    setIsDbIdeasLoading(true)
    setError('')
    try {
      const generated = await generateIdeasFromDatabase(taskForIdeas || 'Generate strategic ideas from my personal knowledge base')
      setIdeas((prev) => [...generated.ideas, ...prev])
      const updatedUsage = await upsertTaskTokenUsage({
        taskName: (taskForIdeas || 'ideas-db-wide-task') + '-db',
        promptTokens: generated.tokenUsage.promptTokens,
        completionTokens: generated.tokenUsage.completionTokens,
        totalTokens: generated.tokenUsage.totalTokens,
      })
      setTokenUsage(updatedUsage)
      setTab('ideas')
    } catch {
      setError('Failed to generate ideas from the database.')
    } finally {
      setIsDbIdeasLoading(false)
    }
  }

  async function handleSyncNotes(): Promise<void> {
    setIsNotesLoading(true)
    setError('')
    try {
      const syncedNotes = await fetchObsidianNotesBridge(notesQuery)
      setNotes(syncedNotes)
      trackTelemetry('notes_synced', { query: notesQuery, count: syncedNotes.length })
    } catch {
      setError('Failed to sync notes from Obsidian bridge.')
    } finally {
      setIsNotesLoading(false)
    }
  }

  function addReminder(idea: IdeaItem): void {
    const remindAt = idea.remindAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const reminder: ReminderItem = {
      id: `rem-${Date.now()}`,
      ideaId: idea.id,
      title: idea.title,
      remindAt,
      done: false,
    }
    setReminders((prev) => [reminder, ...prev])
    scheduleReminder(reminder)
    setTab('reminders')
  }

  function createKnowledgeDraft(): void {
    if (!selectedSearchItems.length) {
      setError('Select search results to add to the knowledge base.')
      return
    }
    const draft = buildKnowledgeDraft(selectedSearchItems, knowledgeTitle)
    setKnowledgeItems((prev) => [draft, ...prev])
    trackTelemetry('kb_item_published', { draftId: draft.id, status: draft.status, refsCount: draft.refs.length, mode: 'draft' })
    setKnowledgeTitle('')
    setTab('knowledge')
  }

  function publishKnowledge(itemId: string): void {
    setKnowledgeItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, status: 'published' as const } : item)),
    )
    trackTelemetry('kb_item_published', { draftId: itemId, status: 'published', mode: 'publish' })
  }

  function downloadKnowledge(item: KnowledgeItem): void {
    const markdown = exportKnowledgeMarkdown(item)
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.title.replace(/\s+/g, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleQuickIngest(): void {
    const value = ingestValue.trim()
    if (!value) return
    setIsIngesting(true)
    const isUrl = /^https?:\/\//i.test(value)
    const newItem: SearchItem = {
      id: `ingest-${Date.now()}`,
      source: isUrl ? 'Links' : 'Obsidian',
      title: isUrl ? `Captured link: ${value}` : value.slice(0, 72),
      snippet: isUrl ? 'Quickly added via ingest bar. Add to KB or use for idea generation.' : value,
      link: isUrl ? value : undefined,
      tags: ['inbox', isUrl ? 'link' : 'note'],
      relevance: 0.66,
      createdAt: new Date().toISOString(),
    }
    setSearchItems((prev) => [newItem, ...prev])
    setSelectedIds((prev) => [newItem.id, ...prev])
    setIngestValue('')
    setIsIngesting(false)
    trackTelemetry('quick_ingest', { isUrl, source: newItem.source })
  }

  async function handleKnowledgeExport(semantic: boolean): Promise<void> {
    setIsExporting(true)
    setError('')
    try {
      const bundle = await exportKnowledgeBundle(exportQuery, { semantic, limit: 150 })
      const blob = new Blob([bundle.markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `knowledge-export-${bundle.mode}-${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
      trackTelemetry('knowledge_export', { mode: bundle.mode, itemCount: bundle.itemCount, vectorCount: bundle.vectorCount })
    } catch {
      setError('Failed to export knowledge base (Obsidian + vector).')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleKnowledgeExportZip(semantic: boolean): Promise<void> {
    setIsExporting(true)
    setError('')
    try {
      const bundle = await exportKnowledgeBundle(exportQuery, { semantic, limit: 150 })
      const zip = new JSZip()
      zip.file('knowledge.md', bundle.markdown)
      zip.file('items.json', JSON.stringify(bundle.items, null, 2))
      zip.file(
        'vectors.json',
        JSON.stringify(
          bundle.items
            .filter((item) => item.embeddingModel || item.distance !== null)
            .map((item) => ({
              knowledgeItemId: item.knowledgeItemId,
              title: item.title,
              embeddingModel: item.embeddingModel ?? null,
              distance: item.distance ?? null,
            })),
          null,
          2,
        ),
      )
      zip.file(
        'manifest.json',
        JSON.stringify(
          {
            workspaceId: bundle.workspaceId,
            query: bundle.query,
            mode: bundle.mode,
            generatedAt: bundle.generatedAt,
            itemCount: bundle.itemCount,
            vectorCount: bundle.vectorCount,
            format: 'bookmarks-bro-knowledge-export-v1',
          },
          null,
          2,
        ),
      )

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `knowledge-export-${bundle.mode}-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      trackTelemetry('knowledge_export_zip', {
        mode: bundle.mode,
        itemCount: bundle.itemCount,
        vectorCount: bundle.vectorCount,
      })
    } catch {
      setError('Failed to export knowledge base ZIP.')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleFileEnrichSubmit(): Promise<void> {
    if (!fileEnrichWorkspaceId) {
      setFileEnrichMessage('Выберите workspace (БЗ).')
      return
    }
    if (!fileEnrichFiles.length) {
      setFileEnrichMessage('Добавьте хотя бы один файл.')
      return
    }
    setFileEnrichLoading(true)
    setFileEnrichMessage('')
    setError('')
    try {
      const results = []
      for (const file of fileEnrichFiles) {
        const result = await enrichKbFile({
          workspaceId: fileEnrichWorkspaceId,
          file,
          kind: fileEnrichKind,
          category: fileEnrichCategory,
          title: fileEnrichTitle || undefined,
          caption: fileEnrichCaption || undefined,
        })
        results.push(result)
      }
      const last = results[results.length - 1]
      const flagged = results.some((r) => r.securityFlagged)
      setFileEnrichMessage(
        flagged
          ? `Загружено ${results.length} файл(ов). Один или более отправлены на модерацию.`
          : `Загружено ${results.length} файл(ов). Векторизация и Obsidian: ok. ID: ${last?.knowledgeItemId ?? '—'}`,
      )
      setFileEnrichFiles([])
      trackTelemetry('kb_file_enrich', {
        count: results.length,
        workspaceId: fileEnrichWorkspaceId,
        kind: fileEnrichKind,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'file_enrich_failed'
      setFileEnrichMessage(message)
      setError(message)
    } finally {
      setFileEnrichLoading(false)
    }
  }

  return (
    <div className="bb-shell max-w-7xl mx-auto p-6 space-y-6">
      <header className="bb-card p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="bb-kicker">Keept · build {BOOKMARKS_BRO_BUILD}</p>
            <h1 className="bb-title">Knowledge Workspace</h1>
            <p className="bb-subtitle">
              Search, ideas, reminders, and knowledge base export via agent-api (UI state persistence on the server).
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-[#807d72]">
              <span>Sync: {uiSyncStatusLabel(syncStatus)}</span>
              {syncStatus === 'error' || syncStatus === 'offline' ? (
                <button
                  type="button"
                  className="underline text-[#f54e00]"
                  onClick={() => void syncWorkspaceUiStateNow()}
                >
                  Retry
                </button>
              ) : null}
              <div className="flex items-center gap-1 bg-black/5 p-0.5 rounded-lg border border-black/5">
                <button
                  type="button"
                  onClick={() => handleStorageModeChange('cloud')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '10px',
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: '5px',
                    background: storageMode === 'cloud' ? '#ff6b00' : 'transparent',
                    color: storageMode === 'cloud' ? '#ffffff' : '#807d72',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ☁️ Cloud
                </button>
                <button
                  type="button"
                  onClick={() => handleStorageModeChange('local')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '10px',
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: '5px',
                    background: storageMode === 'local' ? '#ff6b00' : 'transparent',
                    color: storageMode === 'local' ? '#ffffff' : '#807d72',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  💻 Local
                </button>
              </div>
            </div>
          </div>
          <button type="button" className="bb-btn-primary" onClick={() => void handleSearch()}>
            {isLoading ? 'Searching…' : 'Run Search'}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bb-stat"><span>Results</span><strong>{searchItems.length}</strong></div>
          <div className="bb-stat"><span>Ideas</span><strong>{ideas.length}</strong></div>
          <div className="bb-stat"><span>Published KB</span><strong>{publishedCount}</strong></div>
          <div className="bb-stat"><span>Total tokens</span><strong>{totalTokens}</strong></div>
        </div>
        <div className="bb-ingest">
          <input
            className="bb-ingest-input"
            value={ingestValue}
            onChange={(e) => setIngestValue(e.target.value)}
            placeholder="Paste URL or type a quick note..."
          />
          <button type="button" className="bb-ingest-btn" onClick={handleQuickIngest} disabled={isIngesting}>
            {isIngesting ? '…' : '+'}
          </button>
        </div>
      </header>

      <nav className="bb-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`bb-tab ${tab === item.key ? 'bb-tab-active' : ''}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === 'search' && (
        <section className="grid xl:grid-cols-[1fr_360px] gap-4">
          <div className="bb-card p-5 space-y-4">
            <div style={{
              background: 'rgba(255, 255, 255, 0.45)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '16px',
              padding: '16px',
              boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px' }}>🧠</span>
                  <h4 style={{ margin: 0, fontWeight: 600, color: '#1e1d1a', fontSize: '15px', letterSpacing: '-0.01em' }}>Keept Grounded Brain</h4>
                </div>
                <span style={{
                  fontSize: '11px',
                  background: 'linear-gradient(135deg, #ff6b00, #ff8e53)',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '20px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>Google AI Studio</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                {/* Context Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#807d72', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.05em' }}>Context</label>
                  <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.04)', padding: '3px', borderRadius: '8px' }}>
                    {(['kb', 'hybrid', 'web'] as const).map((ctx) => (
                      <button
                        key={ctx}
                        type="button"
                        onClick={() => setAgentContext(ctx)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: '12px',
                          fontWeight: 500,
                          border: 'none',
                          borderRadius: '6px',
                          background: agentContext === ctx ? '#ffffff' : 'transparent',
                          color: agentContext === ctx ? '#ff4f00' : '#5a5852',
                          boxShadow: agentContext === ctx ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease-in-out'
                        }}
                      >
                        {ctx === 'kb' ? 'My KB' : ctx === 'hybrid' ? 'Grounded Hybrid' : 'Web Only'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Depth Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#807d72', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.05em' }}>Depth</label>
                  <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.04)', padding: '3px', borderRadius: '8px' }}>
                    {(['quick', 'deep'] as const).map((dp) => (
                      <button
                        key={dp}
                        type="button"
                        onClick={() => setAgentDepth(dp)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: '12px',
                          fontWeight: 500,
                          border: 'none',
                          borderRadius: '6px',
                          background: agentDepth === dp ? '#ffffff' : 'transparent',
                          color: agentDepth === dp ? '#ff4f00' : '#5a5852',
                          boxShadow: agentDepth === dp ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease-in-out'
                        }}
                      >
                        {dp === 'quick' ? '⚡ Quick' : '🔬 Reasoning'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Autonomy Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#807d72', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.05em' }}>Autonomy</label>
                  <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.04)', padding: '3px', borderRadius: '8px' }}>
                    {(['answer', 'suggest', 'act'] as const).map((aut) => (
                      <button
                        key={aut}
                        type="button"
                        onClick={() => setAgentAutonomy(aut)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: '12px',
                          fontWeight: 500,
                          border: 'none',
                          borderRadius: '6px',
                          background: agentAutonomy === aut ? '#ffffff' : 'transparent',
                          color: agentAutonomy === aut ? '#ff4f00' : '#5a5852',
                          boxShadow: agentAutonomy === aut ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease-in-out'
                        }}
                      >
                        {aut === 'answer' ? 'Answer' : aut === 'suggest' ? 'Suggest' : 'Act'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-7 gap-3">
              <input
                className="bb-input md:col-span-2"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes, bookmarks, ideas, plans..."
              />
              <select
                className="bb-input"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as SourceKind | 'All')}
              >
                <option value="All">All sources</option>
                <option value="Obsidian">Obsidian</option>
                <option value="Bookmarks">Bookmarks</option>
                <option value="Links">Links</option>
              </select>
              <select
                className="bb-input"
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
              >
                <option value="All">All kinds</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <select
                className="bb-input"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="All">All categories</option>
                {facetCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <select
                className="bb-input"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="All">All tags</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              <select
                className="bb-input"
                value={ragMode}
                onChange={(e) => setRagMode(e.target.value as 'semantic' | 'keyword')}
              >
                <option value="semantic">Semantic</option>
                <option value="keyword">Keyword</option>
              </select>
              <button type="button" className="bb-btn-secondary md:col-span-7" onClick={() => void handleSearch()}>
                {isLoading ? 'Searching…' : 'Search'}
              </button>
            </div>

            {agentOverview && (
              <div style={{
                background: 'rgba(255, 107, 0, 0.04)',
                borderLeft: '4px solid #ff6b00',
                borderRadius: '8px',
                padding: '16px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.01)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '16px' }}>🤖</span>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#ff4f00' }}>Agent Synthesis</h4>
                </div>
                <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6', color: '#33322e' }}>
                  {agentOverview}
                </p>
              </div>
            )}

            {agentActions.length > 0 && (
              <div style={{
                background: '#ffffff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.02)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '16px' }}>⚡</span>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#1e1d1a' }}>Suggested Actions ({agentActions.length})</h4>
                  <span style={{ fontSize: '11px', color: '#807d72', marginLeft: 'auto' }}>
                    {agentAutonomy === 'act' ? 'Auto-executed' : 'Awaiting approval'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {agentActions.map((action, idx) => (
                    <div
                      key={action.id || idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'rgba(0,0,0,0.02)',
                        border: '1px solid rgba(0,0,0,0.03)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ flex: 1, marginRight: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <span style={{
                            background: action.executed ? '#d4edda' : '#fff3cd',
                            color: action.executed ? '#155724' : '#856404',
                            fontSize: '9px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            {action.type.replace('_', ' ')}
                          </span>
                          {action.title && <strong style={{ color: '#26251e' }}>{action.title}</strong>}
                        </div>
                        <div style={{ color: '#5a5852', fontSize: '11px', lineHeight: '1.4' }}>{action.description || action.reason}</div>
                        {action.reason && action.description && (
                          <div style={{ color: '#807d72', fontSize: '10px', marginTop: '2px', fontStyle: 'italic' }}>Reason: {action.reason}</div>
                        )}
                      </div>
                      <div>
                        <button
                          type="button"
                          disabled={action.executed}
                          onClick={() => void handleExecuteAction(action)}
                          style={{
                            background: action.executed ? 'transparent' : '#ff4f00',
                            color: action.executed ? '#28a745' : '#ffffff',
                            border: action.executed ? 'none' : '1px solid #ff4f00',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontWeight: 500,
                            fontSize: '11px',
                            cursor: action.executed ? 'default' : 'pointer',
                            transition: 'all 0.15s ease-in-out'
                          }}
                        >
                          {action.executed ? '✓ Executed' : 'Approve'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ul className="space-y-3">
              {filteredSearchItems.map((item) => (
                <li key={item.id} className="bb-card p-3">
                  <label className="flex gap-3 items-start">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelect(item.id)} />
                    <span className="space-y-1 w-full">
                      <span className="block font-medium text-[#26251e]">{item.title}</span>
                      <span className="block text-sm text-[#5a5852]">{item.snippet}</span>
                      <span className="block text-xs text-[#807d72]">
                        {item.source}
                        {item.category ? ` · ${item.category}` : ''} · relevance {(item.relevance * 100).toFixed(0)}%
                      </span>
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.tags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setTagFilter(tag)}
                              className="text-[10px] bg-[#f0ede4] text-[#5a5852] px-1.5 py-0.5 rounded hover:bg-[#e8e4d8] cursor-pointer"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                      {item.link && (
                        <a className="text-xs text-[#f54e00] break-all block mt-1" href={item.link} target="_blank" rel="noreferrer">
                          {item.link}
                        </a>
                      )}
                    </span>
                  </label>
                </li>
              ))}
              {!filteredSearchItems.length && (
                <li className="text-sm text-[#807d72]">
                  {searchItems.length ? 'No results match the selected filters.' : 'Run a search to see results.'}
                </li>
              )}
            </ul>
          </div>

          <aside className="bb-card p-5 space-y-4">
            <h3 className="font-semibold text-[#26251e]">Quick actions</h3>
            <input
              className="bb-input"
              value={taskForIdeas}
              onChange={(e) => setTaskForIdeas(e.target.value)}
              placeholder="Goal for idea generation"
            />
            <button type="button" className="bb-btn-primary w-full" onClick={() => void handleGenerateIdeas()}>
              Create ideas from selection
            </button>
            <button type="button" className="bb-btn-secondary w-full" onClick={() => void handleGenerateIdeasFromDb()}>
              {isDbIdeasLoading ? 'Generating DB ideas…' : 'Generate ideas from full DB'}
            </button>
            <input
              className="bb-input"
              value={knowledgeTitle}
              onChange={(e) => setKnowledgeTitle(e.target.value)}
              placeholder="Knowledge draft title"
            />
            <button type="button" className="bb-btn-secondary w-full" onClick={createKnowledgeDraft}>
              Add selection to KB
            </button>
            <p className="text-xs text-[#807d72]">Selected: {selectedSearchItems.length}</p>
          </aside>
        </section>
      )}

      {tab === 'ideas' && (
        <section className="space-y-3">
          {!!searchItems.length && (
            <article className="bb-card p-4 space-y-3">
              <h3 className="font-medium text-[#26251e]">Synthesize from current knowledge</h3>
              <p className="text-sm text-[#5a5852]">
                Generate ideas based on current search results and notes.
              </p>
              <button
                type="button"
                className="bb-btn-primary"
                onClick={() => {
                  if (!selectedIds.length) {
                    setSelectedIds(searchItems.slice(0, 3).map((row) => row.id))
                  }
                  void handleGenerateIdeas()
                }}
              >
                Assemble Insights
              </button>
              <button type="button" className="bb-btn-secondary" onClick={() => void handleGenerateIdeasFromDb()}>
                {isDbIdeasLoading ? 'Generating…' : 'DB-wide synthesis'}
              </button>
            </article>
          )}
          {ideas.map((idea) => (
            <article key={idea.id} className="bb-card p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-[#26251e]">{idea.title}</h3>
                <span className="bb-pill">{idea.priority}</span>
              </div>
              <p className="text-sm text-[#5a5852]">{idea.context}</p>
              <div className="flex gap-2">
                <button type="button" className="bb-btn-secondary" onClick={() => addReminder({ ...idea, status: 'active' })}>
                  Set Reminder
                </button>
              </div>
            </article>
          ))}
          {!ideas.length && <p className="text-sm text-[#807d72]">No ideas yet. Run a search and generate ideas first.</p>}
        </section>
      )}

      {tab === 'notes' && (
        <section className="bb-card p-5 space-y-4">
          <div className="grid md:grid-cols-4 gap-3">
            <input
              className="bb-input md:col-span-3"
              value={notesQuery}
              onChange={(e) => setNotesQuery(e.target.value)}
              placeholder="Search and sync Obsidian notes"
            />
            <button type="button" className="bb-btn-secondary" onClick={() => void handleSyncNotes()}>
              {isNotesLoading ? 'Syncing…' : 'Sync Notes'}
            </button>
          </div>
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="bb-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-[#26251e]">{note.title}</h3>
                  <span className="bb-pill">{note.source}</span>
                </div>
                <p className="text-sm text-[#5a5852]">{note.content}</p>
                {note.link && (
                  <a className="text-xs text-[#f54e00] break-all" href={note.link} target="_blank" rel="noreferrer">
                    {note.link}
                  </a>
                )}
              </li>
            ))}
            {!notes.length && <li className="text-sm text-[#807d72]">Click Sync Notes to load notes.</li>}
          </ul>
        </section>
      )}

      {tab === 'reminders' && (
        <section className="space-y-3">
          {reminders.map((reminder) => (
            <article key={reminder.id} className="bb-card p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-[#26251e]">{reminder.title}</p>
                <p className="text-xs text-[#807d72]">{new Date(reminder.remindAt).toLocaleString()}</p>
              </div>
              <button
                type="button"
                className="bb-btn-secondary"
                onClick={() =>
                  setReminders((prev) => prev.map((item) => (item.id === reminder.id ? { ...item, done: true } : item)))
                }
              >
                {reminder.done ? 'Done' : 'Mark done'}
              </button>
            </article>
          ))}
          {!reminders.length && <p className="text-sm text-[#807d72]">No reminders yet.</p>}
        </section>
      )}

      {tab === 'knowledge' && (
        <section className="space-y-3">
          <article className="bb-card p-4 space-y-3">
            <h3 className="font-medium text-[#26251e]">Обогатить БЗ файлами</h3>
            <p className="text-sm text-[#5a5852]">
              Загрузите .txt, .md, .csv, .json, PDF (best-effort), изображения (OCR) или аудио (Whisper).
              Укажите workspace и тип записи. В Telegram: привяжите чат к workspace и отправьте файл с подписью
              <code className="mx-1">#kb #development #dev-tools</code>.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-[#807d72]">Workspace (БЗ)</span>
                <select
                  className="bb-input w-full"
                  value={fileEnrichWorkspaceId}
                  onChange={(e) => setFileEnrichWorkspaceId(e.target.value)}
                >
                  {(workspaces.length ? workspaces : [{ id: workspaceId, name: `Workspace ${workspaceId}` }])
                    .filter((w) => w.id)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.id})
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[#807d72]">Kind</span>
                <select className="bb-input w-full" value={fileEnrichKind} onChange={(e) => setFileEnrichKind(e.target.value)}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[#807d72]">Category</span>
                <input
                  className="bb-input w-full"
                  value={fileEnrichCategory}
                  onChange={(e) => setFileEnrichCategory(e.target.value)}
                  placeholder="general, ai-ml, dev-tools…"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[#807d72]">Title (optional)</span>
                <input
                  className="bb-input w-full"
                  value={fileEnrichTitle}
                  onChange={(e) => setFileEnrichTitle(e.target.value)}
                  placeholder="Заголовок заметки"
                />
              </label>
            </div>
            <label className="space-y-1 text-sm block">
              <span className="text-[#807d72]">Подпись / hints</span>
              <input
                className="bb-input w-full"
                value={fileEnrichCaption}
                onChange={(e) => setFileEnrichCaption(e.target.value)}
                placeholder="#kb #note #dev-tools описание"
              />
            </label>
            <input
              type="file"
              multiple
              className="bb-input w-full"
              onChange={(e) => setFileEnrichFiles(Array.from(e.target.files ?? []))}
            />
            {!!fileEnrichFiles.length && (
              <p className="text-xs text-[#5a5852]">
                Выбрано: {fileEnrichFiles.map((f) => f.name).join(', ')}
              </p>
            )}
            <button
              type="button"
              className="bb-btn-primary"
              disabled={fileEnrichLoading}
              onClick={() => void handleFileEnrichSubmit()}
            >
              {fileEnrichLoading ? 'Загрузка…' : 'Векторизовать и обогатить БЗ'}
            </button>
            {fileEnrichMessage && <p className="text-sm text-[#5a5852]">{fileEnrichMessage}</p>}
          </article>
          <article className="bb-card p-4 space-y-3">
            <h3 className="font-medium text-[#26251e]">Export Obsidian + vector knowledge</h3>
            <div className="grid md:grid-cols-3 gap-3">
              <input
                className="bb-input md:col-span-2"
                value={exportQuery}
                onChange={(e) => setExportQuery(e.target.value)}
                placeholder="Export query (optional, default: knowledge)"
              />
              <button type="button" className="bb-btn-primary" onClick={() => void handleKnowledgeExport(true)}>
                {isExporting ? 'Exporting…' : 'Export semantic'}
              </button>
            </div>
            <button type="button" className="bb-btn-secondary" onClick={() => void handleKnowledgeExport(false)}>
              Export text mode
            </button>
            <div className="grid md:grid-cols-2 gap-3">
              <button type="button" className="bb-btn-primary" onClick={() => void handleKnowledgeExportZip(true)}>
                {isExporting ? 'Exporting ZIP…' : 'Export ZIP semantic'}
              </button>
              <button type="button" className="bb-btn-secondary" onClick={() => void handleKnowledgeExportZip(false)}>
                Export ZIP text mode
              </button>
            </div>
          </article>
          {knowledgeItems.map((item) => (
            <article key={item.id} className="bb-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-[#26251e]">{item.title}</h3>
                <span className="bb-pill">{item.status}</span>
              </div>
              <p className="text-sm text-[#5a5852] whitespace-pre-wrap">{item.summary}</p>
              <div className="flex gap-2">
                <button type="button" className="bb-btn-primary" onClick={() => publishKnowledge(item.id)}>
                  Publish
                </button>
                <button type="button" className="bb-btn-secondary" onClick={() => downloadKnowledge(item)}>
                  Export Markdown
                </button>
              </div>
            </article>
          ))}
          {!knowledgeItems.length && <p className="text-sm text-[#807d72]">No knowledge drafts yet.</p>}
          {!!tokenUsage.length && (
            <div className="bb-card p-4 space-y-2">
              <h3 className="font-medium text-[#26251e]">Token usage by task</h3>
              <ul className="space-y-1">
                {tokenUsage.map((usage) => (
                  <li key={usage.id} className="text-xs text-[#5a5852]">
                    {usage.taskName}: total {usage.totalTokens} (prompt {usage.promptTokens}, completion {usage.completionTokens})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === 'settings' && (
        <section className="space-y-6">
          <div className="bb-card p-6 space-y-4">
            <h3 className="text-lg font-semibold text-[#26251e] border-b border-[#eae6da] pb-2">Workspace Profile</h3>
            <div className="space-y-1">
              <span className="text-xs font-semibold text-[#807d72] uppercase tracking-wider">Active Workspace ID</span>
              <div className="flex items-center space-x-2">
                <code className="bg-[#fcfbf9] px-2 py-1 border border-[#eae6da] rounded text-sm text-[#5a5852] font-mono">
                  {workspaceId || 'Loading...'}
                </code>
              </div>
            </div>
            <div className="pt-2">
              <button type="button" className="bb-btn-secondary text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200" onClick={handleClearCache}>
                Disconnect & Reset local session
              </button>
            </div>
          </div>

          <div className="bb-card p-6 space-y-6">
            <div className="border-b border-[#eae6da] pb-3">
              <h3 className="text-lg font-semibold text-[#26251e]">Local Device Storage & Cloud Backup</h3>
              <p className="text-sm text-[#807d72] mt-1">
                Configure local vector storage (IndexedDB), backup your database, and manage offline search options.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Left Column: API Settings & Statistics */}
              <div className="space-y-4">
                <div>
                  <label htmlFor="localGeminiKeyInput" className="text-xs font-semibold text-[#807d72] uppercase tracking-wider block mb-2">
                    Gemini API Key (for Local Embeddings)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="localGeminiKeyInput"
                      className="bb-input w-full font-mono text-xs"
                      type="password"
                      placeholder="AIzaSy..."
                      value={localGeminiKey}
                      onChange={(e) => {
                        setLocalGeminiKeyState(e.target.value)
                        setLocalGeminiApiKey(e.target.value)
                      }}
                    />
                    <button
                      type="button"
                      className="bb-btn-secondary text-xs py-2"
                      onClick={() => {
                        setLocalGeminiApiKey(localGeminiKey)
                        alert('API Key saved locally!')
                      }}
                    >
                      Save Key
                    </button>
                  </div>
                  <p className="text-[11px] text-[#807d72] mt-1">
                    Your key is stored securely in your browser's local storage and is only used to generate embeddings locally.
                  </p>
                </div>

                <div className="bg-[#fcfbf9] border border-[#eae6da] p-4 rounded-lg space-y-2">
                  <h4 className="text-xs font-semibold text-[#807d72] uppercase tracking-wider">IndexedDB Vault Stats</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm text-[#5a5852]">
                    <div>
                      <span className="block text-xs text-[#807d72]">Local Bookmarks</span>
                      <strong className="text-[#26251e] text-base">{localStats.bookmarks}</strong>
                    </div>
                    <div>
                      <span className="block text-xs text-[#807d72]">Local Notes</span>
                      <strong className="text-[#26251e] text-base">{localStats.notes}</strong>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[#eae6da] flex gap-2">
                    <button
                      type="button"
                      className="bb-btn-secondary text-xs py-1.5 px-3"
                      onClick={() => void fetchLocalStats()}
                    >
                      🔄 Refresh Stats
                    </button>
                    <button
                      type="button"
                      className="bb-btn-secondary text-xs py-1.5 px-3 text-red-600 hover:text-red-700 border-red-200"
                      onClick={async () => {
                        if (window.confirm('Are you sure you want to completely erase your local IndexedDB vault? All offline bookmarks and notes will be deleted!')) {
                          await clearLocalVault()
                          await fetchLocalStats()
                          alert('Local database cleared.')
                        }
                      }}
                    >
                      🗑️ Clear Vault
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Database Operations & Backups */}
              <div className="space-y-4">
                <div className="bg-[#fcfbf9] border border-[#eae6da] p-4 rounded-lg space-y-3">
                  <h4 className="text-xs font-semibold text-[#807d72] uppercase tracking-wider">Backup & Portability</h4>
                  <p className="text-xs text-[#5a5852]">
                    Export your complete local database as a JSON file, or import an existing backup. Useful for syncing across devices via Google Drive or Dropbox.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className="bb-btn-primary text-xs py-2 px-4"
                      onClick={() => void handleExportLocalVault()}
                    >
                      📤 Export Local Vault
                    </button>
                    <label className="bb-btn-secondary text-xs py-2 px-4 cursor-pointer inline-block text-center">
                      📥 Import Local Vault
                      <input
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={handleImportLocalVault}
                      />
                    </label>
                  </div>
                </div>

                <div className="bg-[#fcfbf9] border border-[#eae6da] p-4 rounded-lg space-y-3">
                  <h4 className="text-xs font-semibold text-[#807d72] uppercase tracking-wider">Vector Indexing</h4>
                  <p className="text-xs text-[#5a5852]">
                    Generate vector embeddings for all local bookmarks and notes to enable semantic search on your device.
                  </p>
                  
                  {reindexProgress !== null ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-medium text-[#ff6b00]">
                        <span>Indexing database...</span>
                        <span>{reindexCurrent} / {reindexTotal} ({reindexProgress}%)</span>
                      </div>
                      <div className="w-full bg-[#eae6da] h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-[#ff6b00] h-full transition-all duration-150"
                          style={{ width: `${reindexProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="bb-btn-secondary text-xs py-2 px-4 w-full"
                      onClick={() => void handleReindexLocalVault()}
                    >
                      ⚡ Re-index Database (Generate Embeddings)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bb-card p-6 space-y-6">
            <div className="border-b border-[#eae6da] pb-3">
              <h3 className="text-lg font-semibold text-[#26251e]">Connect Telegram (Tier A)</h3>
              <p className="text-sm text-[#807d72] mt-1">
                Link Keep It For Me to your personal Telegram account to save bookmarks and content directly via the official bot.
              </p>
            </div>

            {tgStatusLoading ? (
              <p className="text-sm text-[#807d72]">Loading Telegram status...</p>
            ) : tgStatus?.linked ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-3 bg-emerald-50 border border-emerald-100 p-4 rounded-lg">
                  <span className="flex h-3.5 w-3.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">Telegram Assistant Linked</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Connected to Chat ID: <code className="font-mono">{tgStatus.chatId}</code>
                      {tgStatus.telegramUserId && ` (User ID: ${tgStatus.telegramUserId})`}
                    </p>
                  </div>
                </div>

                <div className="bg-[#fcfbf9] border border-[#eae6da] p-4 rounded-lg space-y-2">
                  <h4 className="text-xs font-semibold text-[#807d72] uppercase tracking-wider">How to use:</h4>
                  <ul className="list-disc pl-4 text-sm text-[#5a5852] space-y-1">
                    <li>Forward links, text, or images directly to your connected Telegram bot.</li>
                    <li>The bot will automatically extract titles, categorize them, and store them in your workspace.</li>
                    <li>Ask questions from your dashboard or notes directly using RAG search features.</li>
                  </ul>
                </div>

                <button type="button" className="bb-btn-secondary text-red-600 border-red-200 hover:bg-red-50" onClick={handleUnlink}>
                  Disconnect Telegram
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[#5a5852]">
                  Your workspace is not connected to a personal Telegram assistant.
                </p>

                <div className="space-y-3">
                  <button
                    type="button"
                    className="bb-btn-primary"
                    disabled={tgLinkCodeLoading}
                    onClick={handleGenerateCode}
                  >
                    {tgLinkCodeLoading ? 'Generating...' : 'Generate Linking Code'}
                  </button>

                  {tgLinkCodeError && (
                    <p className="text-sm text-red-600 font-medium">{tgLinkCodeError}</p>
                  )}

                  {tgLinkCode && (
                    <div className="border border-[#eae6da] bg-[#fcfbf9] p-5 rounded-lg space-y-4 animate-fade-in">
                      <div className="space-y-1">
                        <span className="text-xs font-semibold text-[#807d72] uppercase tracking-wider">Your temporary linking code:</span>
                        <div className="text-2xl font-bold font-mono tracking-widest text-[#26251e]">
                          {tgLinkCode.code}
                        </div>
                        <p className="text-xs text-[#807d72]">
                          Expires in 10 minutes (expires: {new Date(tgLinkCode.expiresAt).toLocaleTimeString()})
                        </p>
                      </div>

                      <div className="space-y-2 text-sm text-[#5a5852]">
                        <p className="font-semibold">Step 2: Connect via Bot</p>
                        <ol className="list-decimal pl-4 space-y-1">
                          <li>Open Telegram and search for bot: <a href={`https://t.me/${tgLinkCode.botUsername}`} target="_blank" rel="noreferrer" className="text-amber-700 font-semibold underline">@{tgLinkCode.botUsername}</a></li>
                          <li>Start a chat with the bot and send command:</li>
                        </ol>
                        <div className="bg-[#eae6da] px-3 py-2 rounded font-mono text-sm text-[#26251e] inline-block">
                          /start {tgLinkCode.code}
                        </div>
                        <p className="text-xs text-[#807d72] mt-1">
                          Once sent, reload this page or settings tab to see your status update.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="bb-card p-6 space-y-6">
            <div className="border-b border-[#eae6da] pb-3">
              <h3 className="text-lg font-semibold text-[#26251e]">Custom Telegram Bot (Tier B)</h3>
              <p className="text-sm text-[#807d72] mt-1">
                For power users: run your own private Telegram bot instance instead of the shared pool. Paste your token from BotFather.
              </p>
            </div>

            {tgStatus?.customBot ? (
              <div className="bg-[#fcfbf9] border border-[#eae6da] p-4 rounded-lg space-y-3">
                <div className="flex items-center space-x-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                  <span className="text-sm font-semibold text-[#26251e]">Private Bot Active</span>
                </div>
                <p className="text-sm text-[#5a5852]">
                  Username: <a href={`https://t.me/${tgStatus.customBot.username}`} target="_blank" rel="noreferrer" className="text-amber-700 font-semibold underline">@{tgStatus.customBot.username}</a>
                </p>
                <p className="text-xs text-[#807d72]">
                  All messages sent to this bot will route to your workspace.
                </p>
              </div>
            ) : null}

            <form onSubmit={handleSaveCustomBot} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="botTokenInput" className="text-xs font-semibold text-[#807d72] uppercase tracking-wider block">
                  BotFather Bot Token
                </label>
                <input
                  id="botTokenInput"
                  className="bb-input w-full font-mono text-xs"
                  type="password"
                  placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..."
                  value={customBotToken}
                  onChange={(e) => setCustomBotToken(e.target.value)}
                  disabled={customBotLoading}
                />
              </div>

              {customBotError && (
                <p className="text-sm text-red-600 font-medium">{customBotError}</p>
              )}

              {customBotSuccess && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-lg space-y-1 text-sm text-emerald-900">
                  <p className="font-semibold">Custom bot registered successfully!</p>
                  <p className="text-xs">Username: @{customBotSuccess.botUsername}</p>
                  <p className="text-xs break-all text-emerald-700 mt-1">
                    Webhook URL: <code>{customBotSuccess.webhookUrl}</code>
                  </p>
                </div>
              )}

              <button
                type="submit"
                className="bb-btn-primary"
                disabled={customBotLoading || !customBotToken.trim()}
              >
                {customBotLoading ? 'Validating & Saving...' : 'Register Custom Bot'}
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  )
}
