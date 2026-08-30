import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2, Plus, Trash2, Play } from 'lucide-react'

const BLOG_API_URL = '/api/blog'
const CATEGORIES = [
  'ai_marketing', 'automation', 'models', 'business_cases', 'implementation',
  'ai_news', 'meta_ads', 'google_ads', 'reddit_social', 'insights', 'crypto',
  'manuals', 'digital_marketing',
]
const TYPES = ['rss', 'atom', 'listing', 'reddit_json']

type Source = {
  id: string
  name: string
  type: string
  url: string
  category: string
  enabled?: boolean
  linkPattern?: string
}

async function authFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const response = await fetch(`${BLOG_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

const emptyForm: Source = {
  id: '',
  name: '',
  type: 'rss',
  url: '',
  category: 'ai_news',
  enabled: true,
  linkPattern: '',
}

export function BlogNewsSources() {
  const [sources, setSources] = useState<Source[]>([])
  const [form, setForm] = useState<Source>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await authFetch('/admin/pipeline/sources')
      setSources(data.sources || [])
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load sources')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await authFetch('/admin/pipeline/sources', { method: 'POST', body: JSON.stringify(form) })
      setForm(emptyForm)
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await authFetch(`/admin/pipeline/sources/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'delete failed')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (source: Source) => {
    await authFetch(`/admin/pipeline/sources/${encodeURIComponent(source.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...source, enabled: source.enabled === false }),
    })
    await load()
  }

  const runIngest = async (sourceId?: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await authFetch('/admin/pipeline/ingest', {
        method: 'POST',
        body: JSON.stringify({ sourceId, limit: 4 }),
      })
      const stats = (result as { stats?: Record<string, number> }).stats
      setMessage(stats ? `Fetched ${stats.fetched}, created ${stats.created}, skipped relevance ${stats.skippedRelevance}` : 'Ingest finished')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'ingest failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button type="button" onClick={() => void runIngest()} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded-md inline-flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" aria-hidden="true" />}
          Run ingest
        </button>
      </div>
      {message ? <p className="text-sm text-gray-700">{message}</p> : null}

      <form onSubmit={save} className="grid gap-3 md:grid-cols-2 border rounded-xl p-4 bg-white">
        <h2 className="md:col-span-2 text-lg font-semibold">Add / update source</h2>
        <p>
          <label htmlFor="src-id" className="block text-sm mb-1">ID</label>
          <input id="src-id" required value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} className="w-full border rounded px-3 py-2" />
        </p>
        <p>
          <label htmlFor="src-name" className="block text-sm mb-1">Name</label>
          <input id="src-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded px-3 py-2" />
        </p>
        <p>
          <label htmlFor="src-url" className="block text-sm mb-1">URL</label>
          <input id="src-url" type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="w-full border rounded px-3 py-2" />
        </p>
        <p>
          <label htmlFor="src-type" className="block text-sm mb-1">Type</label>
          <select id="src-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded px-3 py-2">
            {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </p>
        <p>
          <label htmlFor="src-cat" className="block text-sm mb-1">Category</label>
          <select id="src-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border rounded px-3 py-2">
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </p>
        <p>
          <label htmlFor="src-pattern" className="block text-sm mb-1">Link pattern (listing)</label>
          <input id="src-pattern" value={form.linkPattern || ''} onChange={(e) => setForm({ ...form, linkPattern: e.target.value })} className="w-full border rounded px-3 py-2" />
        </p>
        <div className="md:col-span-2">
          <button type="submit" disabled={busy} className="px-4 py-2 bg-gray-900 text-white rounded-md inline-flex items-center gap-2">
            <Plus className="w-4 h-4" aria-hidden="true" /> Save source
          </button>
        </div>
      </form>

      {loading ? <p className="text-gray-500">Loading sources...</p> : (
        <ul className="space-y-2">
          {sources.map((source) => (
            <li key={source.id} className="border rounded-lg bg-white p-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{source.name} <span className="text-xs text-gray-500">{source.type} · {source.category}</span></p>
                <p className="text-xs text-gray-500 break-all">{source.url}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs inline-flex items-center gap-1">
                  <input type="checkbox" checked={source.enabled !== false} onChange={() => void toggle(source)} />
                  on
                </label>
                <button type="button" onClick={() => void runIngest(source.id)} className="text-xs px-2 py-1 border rounded">Run</button>
                <button type="button" onClick={() => setForm(source)} className="text-xs px-2 py-1 border rounded">Edit</button>
                <button type="button" onClick={() => void remove(source.id)} className="text-xs px-2 py-1 text-red-600" aria-label={`Delete ${source.name}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
