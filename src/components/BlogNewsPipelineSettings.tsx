import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2, Save } from 'lucide-react'

const BLOG_API_URL = '/api/blog'

type Settings = {
  rewritePrompt: string
  model: string
  fallbackModel: string
  requireAllLangs: boolean
  ingestLimit: number
  relevanceMinScore: number
  citeMode: string
  scrapeMode: string
  requireApproval: boolean
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

export function BlogNewsPipelineSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    authFetch('/admin/pipeline/settings')
      .then((data) => setSettings(data.settings as Settings))
      .catch((err) => setMessage(err instanceof Error ? err.message : 'load failed'))
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!settings) return
    setSaving(true)
    setMessage(null)
    try {
      const data = await authFetch('/admin/pipeline/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      })
      setSettings(data.settings as Settings)
      setMessage('Saved. LLM/scrape keys stay in SWOOP_API_KEY, not in this form.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return <p className="text-gray-500">Loading pipeline settings...</p>
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-3xl">
      <p className="text-sm text-gray-600">
        Pipeline uses Autoro-API (<code>SWOOP_API_KEY</code>). Do not paste Gemini keys here.
      </p>
      <p>
        <label htmlFor="model" className="block text-sm mb-1">Model</label>
        <input
          id="model"
          value={settings.model}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
          className="w-full border rounded px-3 py-2 font-mono text-sm"
        />
      </p>
      <p>
        <label htmlFor="fallback" className="block text-sm mb-1">Fallback model</label>
        <input
          id="fallback"
          value={settings.fallbackModel}
          onChange={(e) => setSettings({ ...settings, fallbackModel: e.target.value })}
          className="w-full border rounded px-3 py-2 font-mono text-sm"
        />
      </p>
      <p>
        <label htmlFor="limit" className="block text-sm mb-1">Ingest cap</label>
        <input
          id="limit"
          type="number"
          min={1}
          max={50}
          value={settings.ingestLimit}
          onChange={(e) => setSettings({ ...settings, ingestLimit: Number(e.target.value) })}
          className="w-full border rounded px-3 py-2"
        />
      </p>
      <p>
        <label htmlFor="score" className="block text-sm mb-1">Min relevance score</label>
        <input
          id="score"
          type="number"
          step="0.05"
          min={0}
          max={1}
          value={settings.relevanceMinScore}
          onChange={(e) => setSettings({ ...settings, relevanceMinScore: Number(e.target.value) })}
          className="w-full border rounded px-3 py-2"
        />
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Flags</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.requireAllLangs}
            onChange={(e) => setSettings({ ...settings, requireAllLangs: e.target.checked })}
          />
          Require all 7 languages before Ready
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.requireApproval}
            onChange={(e) => setSettings({ ...settings, requireApproval: e.target.checked })}
          />
          Require manual Approve (no auto-publish)
        </label>
      </fieldset>
      <p>
        <label htmlFor="prompt" className="block text-sm mb-1">Rewrite prompt</label>
        <textarea
          id="prompt"
          rows={14}
          value={settings.rewritePrompt}
          onChange={(e) => setSettings({ ...settings, rewritePrompt: e.target.value })}
          className="w-full border rounded px-3 py-2 font-mono text-sm"
        />
      </p>
      {message ? <p className="text-sm text-gray-700">{message}</p> : null}
      <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-md inline-flex items-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" aria-hidden="true" />}
        Save pipeline settings
      </button>
    </form>
  )
}
