import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Check, Loader2, RefreshCw, X, Sparkles, ExternalLink } from 'lucide-react'

const BLOG_API_URL = '/api/blog'
const LANGS = ['en', 'ru', 'es', 'it', 'fr', 'vi', 'kz'] as const

type InboxItem = {
  slug: string
  status: string
  category?: string
  sourceUrl?: string
  sourceTitle?: string
  sourceId?: string
  publishedAt?: string | null
  publishedPostId?: string | null
  relevance?: { score?: number; reason?: string }
  langs?: Record<string, { title?: string; excerpt?: string; html?: string }>
  updatedAt?: string
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
  const text = await response.text()
  let body: unknown = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { error: text } }
  if (!response.ok) {
    const err = body as { error?: string }
    throw new Error(err.error || `HTTP ${response.status}`)
  }
  return body as Record<string, unknown>
}

export function BlogNewsInbox() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [status, setStatus] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await authFetch(`/admin/pipeline/items?status=${encodeURIComponent(status)}`)
      setItems((data.items as InboxItem[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [status])

  const openItem = items.find((row) => row.slug === openSlug) || null
  const selectedList = useMemo(() => items.filter((row) => selected.has(row.slug)), [items, selected])

  const act = async (slug: string, action: 'rewrite' | 'approve' | 'reject') => {
    setBusy(slug + action)
    setError(null)
    try {
      await authFetch(`/admin/pipeline/items/${encodeURIComponent(slug)}/${action}`, { method: 'POST' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : action)
    } finally {
      setBusy(null)
    }
  }

  const bulk = async (action: 'rewrite' | 'approve' | 'reject') => {
    if (!selectedList.length) return
    setBusy('bulk')
    try {
      await authFetch('/admin/pipeline/items/bulk', {
        method: 'POST',
        body: JSON.stringify({ action, slugs: selectedList.map((row) => row.slug) }),
      })
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bulk failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <search>
          <label htmlFor="inbox-status" className="block text-sm text-gray-600 mb-1">Status</label>
          <select
            id="inbox-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border rounded-md bg-white"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="ready">Ready</option>
            <option value="draft">Draft</option>
            <option value="rejected">Rejected</option>
          </select>
        </search>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void bulk('rewrite')} className="px-3 py-2 text-sm bg-purple-600 text-white rounded-md">Rewrite selected</button>
          <button type="button" onClick={() => void bulk('approve')} className="px-3 py-2 text-sm bg-green-600 text-white rounded-md">Approve selected</button>
          <button type="button" onClick={() => void bulk('reject')} className="px-3 py-2 text-sm bg-gray-700 text-white rounded-md">Reject selected</button>
          <button type="button" onClick={() => void load()} className="px-3 py-2 text-sm border rounded-md inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Reload
          </button>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading ? (
        <p className="text-gray-500 py-8 text-center">Loading inbox...</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 py-8 text-center">No pipeline drafts.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const title = item.langs?.en?.title || item.sourceTitle || item.slug
            return (
              <li key={item.slug} className="border rounded-xl bg-white p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(item.slug)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(item.slug)
                      else next.delete(item.slug)
                      setSelected(next)
                    }}
                    aria-label={`Select ${title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">{title}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {item.status} · {item.category} · score {item.relevance?.score?.toFixed?.(2) ?? '-'}
                      {item.publishedPostId ? ' · published' : ''}
                    </p>
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 inline-flex items-center gap-1 mt-1">
                        Source <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => setOpenSlug(item.slug)} className="px-2 py-1 text-xs border rounded">Open</button>
                    <button type="button" disabled={busy !== null} onClick={() => void act(item.slug, 'rewrite')} className="px-2 py-1 text-xs bg-purple-600 text-white rounded inline-flex items-center gap-1">
                      {busy === item.slug + 'rewrite' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" aria-hidden="true" />} Rewrite
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => void act(item.slug, 'approve')} className="px-2 py-1 text-xs bg-green-600 text-white rounded inline-flex items-center gap-1">
                      <Check className="w-3 h-3" aria-hidden="true" /> Approve
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => void act(item.slug, 'reject')} className="px-2 py-1 text-xs bg-gray-200 rounded inline-flex items-center gap-1">
                      <X className="w-3 h-3" aria-hidden="true" /> Reject
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {openItem ? (
        <dialog open className="fixed inset-0 z-50 m-0 max-w-none w-full h-full bg-black/50 p-4" onClick={() => setOpenSlug(null)}>
          <div className="mx-auto max-w-4xl bg-white rounded-lg p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{openItem.sourceTitle || openItem.slug}</h2>
              <button type="button" onClick={() => setOpenSlug(null)} className="px-3 py-1 border rounded">Close</button>
            </div>
            <p className="text-sm text-gray-500 mb-3">{openItem.relevance?.reason}</p>
            {LANGS.map((lang) => {
              const block = openItem.langs?.[lang]
              if (!block?.title) return null
              return (
                <section key={lang} className="mb-4">
                  <h3 className="text-sm font-semibold uppercase text-gray-500">{lang}</h3>
                  <p className="font-medium">{block.title}</p>
                  <p className="text-sm text-gray-600">{block.excerpt}</p>
                </section>
              )
            })}
          </div>
        </dialog>
      ) : null}
    </div>
  )
}
