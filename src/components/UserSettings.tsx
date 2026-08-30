import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, Copy, Trash2, Plus, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'

type ApiKeyRow = {
  id: number
  name: string
  key_prefix: string
  scopes: string[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string | null
  active: boolean
}

const BASE_URL = 'https://swoop.autoro.tech/api/v1'

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Нужна авторизация. Войдите заново.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export function UserSettings() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [maxKeys, setMaxKeys] = useState(5)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('replit')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [freshKey, setFreshKey] = useState<string | null>(null)

  const loadKeys = useCallback(async () => {
    setError(null)
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/v1/account/api-keys', { headers })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`
        throw new Error(detail)
      }
      setKeys(Array.isArray(body.keys) ? body.keys : [])
      if (typeof body.max_keys === 'number') setMaxKeys(body.max_keys)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить ключи')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const createKey = async () => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    setFreshKey(null)
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/v1/account/api-keys', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name.trim() || 'default' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`
        throw new Error(detail)
      }
      setFreshKey(String(body.api_key || ''))
      setSuccess('Ключ создан. Скопируйте его сейчас - повторно показать нельзя.')
      await loadKeys()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось создать ключ')
    } finally {
      setBusy(false)
    }
  }

  const revokeKey = async (id: number) => {
    if (!confirm('Отозвать этот API-ключ? Клиенты с ним перестанут работать.')) return
    setBusy(true)
    setError(null)
    try {
      const headers = await authHeaders()
      const res = await fetch(`/api/v1/account/api-keys/${id}`, {
        method: 'DELETE',
        headers,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`
        throw new Error(detail)
      }
      setSuccess('Ключ отозван')
      await loadKeys()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось отозвать ключ')
    } finally {
      setBusy(false)
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setSuccess('Скопировано')
      setTimeout(() => setSuccess(null), 2000)
    } catch {
      setError('Не удалось скопировать')
    }
  }

  const activeCount = keys.filter((k) => k.active).length

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-700">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Загрузка…</span>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-gray-600" />
          API Keys
        </h1>
        <p className="text-gray-600 mt-2 text-sm">
          Персональный токен для{' '}
          <code className="bg-gray-100 px-1 rounded">{BASE_URL}</code>
          {' '}(Replit, Google AI Studio, OpenAI SDK). Не путать с сервисным ключом Admin → Settings.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm flex gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {freshKey && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
          <p className="text-sm font-medium text-amber-900">Новый ключ (покажите один раз):</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 text-xs break-all bg-white border border-amber-200 rounded px-2 py-2">
              {freshKey}
            </code>
            <button
              type="button"
              onClick={() => void copyText(freshKey)}
              className="px-3 py-2 bg-amber-800 text-white rounded text-sm flex items-center gap-1"
            >
              <Copy size={14} /> Copy
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">Создать ключ</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя (replit, ai-studio…)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-gray-300"
            maxLength={80}
          />
          <button
            type="button"
            disabled={busy || activeCount >= maxKeys}
            onClick={() => void createKey()}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-black disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus size={16} />}
            Generate
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Активных: {activeCount} / {maxKeys}. Формат ключа: <code className="bg-gray-100 px-1 rounded">auk_…</code>
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Ваши ключи</div>
        {keys.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Пока нет ключей. Создайте первый выше.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {keys.map((k) => (
              <li key={k.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                <div>
                  <div className="font-medium text-gray-900">
                    {k.name}{' '}
                    {!k.active && (
                      <span className="text-xs text-red-600 font-normal">(отозван)</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{k.key_prefix}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    создан {k.created_at ? new Date(k.created_at).toLocaleString() : '—'}
                    {k.last_used_at
                      ? ` · последний раз ${new Date(k.last_used_at).toLocaleString()}`
                      : ''}
                  </div>
                </div>
                {k.active && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revokeKey(k.id)}
                    className="text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded flex items-center gap-1 self-start"
                  >
                    <Trash2 size={14} /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700 space-y-2">
        <p className="font-semibold text-slate-900">Как использовать</p>
        <p>
          Base URL: <code className="bg-white px-1 rounded border">{BASE_URL}</code>
        </p>
        <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded overflow-x-auto">{`curl -sS ${BASE_URL}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: auk_…" \\
  -d '{"model":"google/gemini-2.5-flash","messages":[{"role":"user","content":"ping"}],"max_tokens":5}'`}</pre>
        <p>
          Replit / AI Studio: провайдер Autoro Swoop, ключ в поле API Key, модель в формате{' '}
          <code className="bg-white px-1 rounded border">provider/model</code>.
        </p>
        <a
          href="https://swoop.autoro.tech/login?mode=signup&next=/chat-agent&google=1"
          className="inline-flex items-center gap-1 text-blue-700 hover:underline"
        >
          Регистрация <ExternalLink size={12} />
        </a>
      </div>
    </div>
  )
}
