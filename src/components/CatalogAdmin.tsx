/**
 * Catalog Admin for pquoc.com places (Supabase)
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MapPin, Plus, RefreshCw, Save } from 'lucide-react'

const PQUOC_SUPABASE_URL = import.meta.env.VITE_PQUOC_SUPABASE_URL || ''
const PQUOC_SERVICE_KEY = import.meta.env.VITE_PQUOC_SUPABASE_SERVICE_KEY || ''

type Place = {
  id: string
  slug: string
  category: string
  status: string
  phone: string | null
  website: string | null
  place_translations?: Array<{ lang: string; name: string; description: string | null }>
}

async function pquocFetch(path: string, init?: RequestInit) {
  if (!PQUOC_SUPABASE_URL || !PQUOC_SERVICE_KEY) {
    throw new Error('Set VITE_PQUOC_SUPABASE_URL and VITE_PQUOC_SUPABASE_SERVICE_KEY')
  }
  const res = await fetch(`${PQUOC_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PQUOC_SERVICE_KEY,
      Authorization: `Bearer ${PQUOC_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init?.method === 'POST' ? 'return=representation' : 'return=minimal',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  if (res.status === 204) return null
  return res.json()
}

export function CatalogAdmin() {
  const [loading, setLoading] = useState(true)
  const [places, setPlaces] = useState<Place[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ slug: '', category: 'hotels', name: '', status: 'draft', phone: '' })

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const data = await pquocFetch('places?select=*,place_translations(*)&order=updated_at.desc')
      setPlaces(data || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createPlace = async () => {
    if (!form.slug || !form.name) return
    const [place] = await pquocFetch('places', {
      method: 'POST',
      body: JSON.stringify({
        slug: form.slug,
        category: form.category,
        status: form.status,
        phone: form.phone || null,
      }),
    })
    await pquocFetch('place_translations', {
      method: 'POST',
      body: JSON.stringify({
        place_id: place.id,
        lang: 'en',
        name: form.name,
        description: '',
      }),
    })
    setForm({ slug: '', category: 'hotels', name: '', status: 'draft', phone: '' })
    await load()
  }

  const updateStatus = async (id: string, status: string) => {
    await pquocFetch(`places?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    })
    await load()
  }

  const triggerDeploy = async () => {
    const hook = import.meta.env.VITE_PQUOC_DEPLOY_WEBHOOK || 'https://tech.autoro.tech/webhook/pquoc/content/publish'
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish' }) })
    alert('Deploy webhook sent')
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapPin className="w-6 h-6" /> pquoc.com Catalog
        </h1>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="px-3 py-2 border rounded-lg flex items-center gap-1">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button type="button" onClick={triggerDeploy} className="px-3 py-2 bg-orange-600 text-white rounded-lg flex items-center gap-1">
            <Save className="w-4 h-4" /> Publish site
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      <div className="mb-8 p-4 border rounded-xl bg-gray-50">
        <h2 className="font-semibold mb-3 flex items-center gap-1"><Plus className="w-4 h-4" /> Add place</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <input placeholder="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="border rounded px-3 py-2" />
          <input placeholder="name (EN)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border rounded px-3 py-2">
            {['hotels', 'restaurants', 'tours', 'spa', 'transport', 'attractions'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input placeholder="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="border rounded px-3 py-2" />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="border rounded px-3 py-2">
            <option value="draft">draft</option>
            <option value="verified">verified</option>
            <option value="published">published</option>
          </select>
          <button type="button" onClick={createPlace} className="bg-blue-600 text-white rounded-lg px-4 py-2">Create</button>
        </div>
        <p className="text-sm text-gray-500 mt-2">Bulk import: run sync-places-from-obsidian.mjs from Obsidian Places notes.</p>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul className="space-y-3">
          {places.map((p) => {
            const name = p.place_translations?.find((t) => t.lang === 'en')?.name || p.slug
            return (
              <li key={p.id} className="border rounded-lg p-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{name}</div>
                  <div className="text-sm text-gray-500">{p.category} · {p.slug}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm px-2 py-1 rounded bg-gray-100">{p.status}</span>
                  {p.status !== 'published' && (
                    <button type="button" onClick={() => updateStatus(p.id, 'published')} className="text-sm text-green-700">Publish</button>
                  )}
                  {p.status === 'published' && (
                    <button type="button" onClick={() => updateStatus(p.id, 'draft')} className="text-sm text-gray-600">Unpublish</button>
                  )}
                  <a href={`https://pquoc.com/catalog/${p.category}/${p.slug}/`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600">Preview</a>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
