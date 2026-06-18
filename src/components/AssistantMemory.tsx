import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CheckSquare, ExternalLink, FileText, RefreshCw, Search } from 'lucide-react'

type MemoryRow = {
  id: string
  text: string | null
  source: string | null
  chat_id: string | null
  sender_id: string | null
  created_at: string
  metadata: {
    memory_kind?: string
    memory_topic?: string
    obsidian_note_path?: string
    telegram_username?: string
    [key: string]: unknown
  } | null
}

const TASK_KINDS = new Set(['task', 'plan', 'instruction', 'research'])

function isTaskItem(row: MemoryRow): boolean {
  const kind = String(row.metadata?.memory_kind || '').toLowerCase()
  if (TASK_KINDS.has(kind)) return true
  const text = String(row.text || '').toLowerCase()
  return /(задач|todo|to do|сделать|дедлайн|выполни|план|roadmap)/i.test(text)
}

export function AssistantMemory() {
  const [items, setItems] = useState<MemoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'tasks' | 'notes'>('tasks')
  const [onlyMyChats, setOnlyMyChats] = useState(false)
  const [myChatIdsInput, setMyChatIdsInput] = useState('')
  const [obsidianVault, setObsidianVault] = useState('obsidian-mcp-local')

  const fetchMemory = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('personal_assistant_memory')
      .select('id, text, source, chat_id, sender_id, created_at, metadata')
      .order('created_at', { ascending: false })
      .limit(300)

    if (error || !data) {
      setItems([])
      setLoading(false)
      return
    }

    setItems((data as MemoryRow[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    setMyChatIdsInput(localStorage.getItem('assistantMemory.myChatIds') || '')
    setObsidianVault(localStorage.getItem('assistantMemory.obsidianVault') || 'obsidian-mcp-local')
    fetchMemory()
  }, [])

  useEffect(() => {
    localStorage.setItem('assistantMemory.myChatIds', myChatIdsInput)
  }, [myChatIdsInput])

  useEffect(() => {
    localStorage.setItem('assistantMemory.obsidianVault', obsidianVault)
  }, [obsidianVault])

  const myChatIds = useMemo(
    () =>
      new Set(
        myChatIdsInput
          .split(/[,\s]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    [myChatIdsInput],
  )

  const activeTasks = useMemo(() => {
    const taskRows = items.filter((row) => isTaskItem(row))
    const unresolved = taskRows.filter((row) => !/(готово|done|completed|выполнено)/i.test(String(row.text || '')))
    return unresolved
      .map((row) => {
        const text = String(row.text || '')
        let priority = 'normal'
        if (/(срочно|urgent|asap|дедлайн|сегодня|tomorrow|завтра)/i.test(text)) priority = 'high'
        if (/(когда-нибудь|later|backlog|maybe)/i.test(text)) priority = 'low'
        return { ...row, priority }
      })
      .slice(0, 8)
  }, [items])

  const openInObsidian = (notePath: string) => {
    const cleanPath = notePath.replace(/^\//, '').replace(/\.md$/i, '')
    const url = `obsidian://open?vault=${encodeURIComponent(obsidianVault)}&file=${encodeURIComponent(cleanPath)}`
    window.location.href = url
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const scoped = items
      .filter((row) => (tab === 'tasks' ? isTaskItem(row) : !isTaskItem(row)))
      .filter((row) => {
        if (!onlyMyChats) return true
        const chatId = String(row.chat_id || '').trim()
        return chatId !== '' && myChatIds.has(chatId)
      })
    if (!q) return scoped
    return scoped.filter((row) => {
      const blob = [
        row.text || '',
        row.source || '',
        row.metadata?.memory_kind || '',
        row.metadata?.memory_topic || '',
        row.metadata?.obsidian_note_path || '',
        row.metadata?.telegram_username || '',
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [items, tab, query])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Assistant Memory</h1>
        <button
          type="button"
          onClick={fetchMemory}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">Active Tasks Snapshot</h2>
        {activeTasks.length === 0 ? (
          <p className="text-sm text-gray-500">No active tasks found yet.</p>
        ) : (
          <div className="space-y-2">
            {activeTasks.map((row) => (
              <div key={row.id} className="p-2 rounded border border-gray-200 text-sm">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <span
                    className={`px-2 py-0.5 rounded ${
                      (row as MemoryRow & { priority: string }).priority === 'high'
                        ? 'bg-red-100 text-red-700'
                        : (row as MemoryRow & { priority: string }).priority === 'low'
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {(row as MemoryRow & { priority: string }).priority}
                  </span>
                  <span>{new Date(row.created_at).toLocaleString()}</span>
                  {row.chat_id && <span>chat: {row.chat_id}</span>}
                </div>
                <p className="text-gray-900 whitespace-pre-wrap">{String(row.text || '').slice(0, 220)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('tasks')}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
              tab === 'tasks' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <CheckSquare size={16} />
            Tasks
          </button>
          <button
            type="button"
            onClick={() => setTab('notes')}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
              tab === 'notes' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <FileText size={16} />
            Notes
          </button>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by text, topic, kind, note path..."
            className="w-full border border-gray-300 rounded-md pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={onlyMyChats}
              onChange={(e) => setOnlyMyChats(e.target.checked)}
            />
            Only my chats
          </label>
          <input
            value={myChatIdsInput}
            onChange={(e) => setMyChatIdsInput(e.target.value)}
            placeholder="My chat ids (comma-separated), e.g. 51564804,1234567"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <input
            value={obsidianVault}
            onChange={(e) => setObsidianVault(e.target.value)}
            placeholder="Obsidian vault name"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm md:col-span-2"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading memory…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No items found.</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filtered.map((row) => (
              <div key={row.id} className="p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
                  <span className="px-2 py-0.5 rounded bg-gray-100">{row.metadata?.memory_kind || 'unknown'}</span>
                  <span>{new Date(row.created_at).toLocaleString()}</span>
                  {row.chat_id && <span>chat: {row.chat_id}</span>}
                  {row.metadata?.memory_topic && <span>Topic: {row.metadata.memory_topic}</span>}
                  {row.metadata?.obsidian_note_path && (
                    <>
                      <span>Obsidian: {row.metadata.obsidian_note_path}</span>
                      <button
                        type="button"
                        onClick={() => openInObsidian(String(row.metadata?.obsidian_note_path || ''))}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                      >
                        <ExternalLink size={12} />
                        Open
                      </button>
                    </>
                  )}
                </div>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{row.text || '(empty text)'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

