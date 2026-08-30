import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Scale,
  Upload,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const API_BASE = '/api/v1/findefender'

interface FinDefenderSettings {
  api_base: string
  admin_api_key_set: boolean
  admin_api_key_masked: string
  telegram_bot_token_set: boolean
  telegram_bot_token_masked: string
  telegram_hitl_group_id: string
  app_public_url: string
  bot_username: string
  group_username: string
  notes: string
  webhook_url: string
}

interface KbSource {
  source: string
  chunk_count: number
  max_chunk_index?: number | null
}

const emptySettings = (): FinDefenderSettings => ({
  api_base: '',
  admin_api_key_set: false,
  admin_api_key_masked: '',
  telegram_bot_token_set: false,
  telegram_bot_token_masked: '',
  telegram_hitl_group_id: '',
  app_public_url: '',
  bot_username: '@FinDefender_bot',
  group_username: '@findefender',
  notes: '',
  webhook_url: '',
})

export function AdminFinDefender() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [agentApiKey, setAgentApiKey] = useState('')
  const [settings, setSettings] = useState<FinDefenderSettings>(emptySettings())
  const [apiBase, setApiBase] = useState('')
  const [adminApiKey, setAdminApiKey] = useState('')
  const [telegramToken, setTelegramToken] = useState('')
  const [hitlGroupId, setHitlGroupId] = useState('')
  const [appPublicUrl, setAppPublicUrl] = useState('')
  const [botUsername, setBotUsername] = useState('@FinDefender_bot')
  const [groupUsername, setGroupUsername] = useState('@findefender')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [health, setHealth] = useState<{ ok?: boolean; reachable?: boolean; detail?: string; health?: unknown } | null>(null)
  const [remoteStatus, setRemoteStatus] = useState<Record<string, unknown> | null>(null)
  const [sources, setSources] = useState<KbSource[]>([])
  const [ingestSource, setIngestSource] = useState('custom-upload.md')
  const [ingestText, setIngestText] = useState('')
  const [busyKb, setBusyKb] = useState(false)

  const apiHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'X-API-Key': agentApiKey,
    }),
    [agentApiKey],
  )

  const applySettings = (data: FinDefenderSettings) => {
    setSettings(data)
    setApiBase(data.api_base || '')
    setHitlGroupId(data.telegram_hitl_group_id || '')
    setAppPublicUrl(data.app_public_url || '')
    setBotUsername(data.bot_username || '@FinDefender_bot')
    setGroupUsername(data.group_username || '@findefender')
    setNotes(data.notes || '')
    setAdminApiKey('')
    setTelegramToken('')
  }

  const loadSettings = useCallback(async (key: string) => {
    const res = await fetch(`${API_BASE}/settings`, { headers: { 'X-API-Key': key } })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
    applySettings(data as FinDefenderSettings)
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        const { data: auth } = await supabase.auth.getUser()
        if (!auth?.user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', auth.user.id)
          .single()
        const admin = profile?.role === 'admin'
        setIsAdmin(admin)
        if (!admin) return
        const { data: row } = await supabase
          .from('service_settings')
          .select('agent_api_key')
          .eq('id', 1)
          .single()
        const key = String(row?.agent_api_key || '').trim()
        setAgentApiKey(key)
        if (key) await loadSettings(key)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [loadSettings])

  const flash = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 4000)
  }

  const saveSettings = async () => {
    if (!agentApiKey) {
      setError('Agent API key не настроен (Settings → Scraping Agent)')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        api_base: apiBase.trim().replace(/\/+$/, ''),
        telegram_hitl_group_id: hitlGroupId.trim(),
        app_public_url: appPublicUrl.trim().replace(/\/+$/, ''),
        bot_username: botUsername.trim() || '@FinDefender_bot',
        group_username: groupUsername.trim() || '@findefender',
        notes,
      }
      if (adminApiKey.trim()) body.admin_api_key = adminApiKey.trim()
      if (telegramToken.trim()) body.telegram_bot_token = telegramToken.trim()
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
      applySettings(data as FinDefenderSettings)
      flash('Настройки FinDefender сохранены')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const checkHealth = async () => {
    if (!agentApiKey) return
    setError(null)
    try {
      const [hRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/health`, { headers: { 'X-API-Key': agentApiKey } }),
        fetch(`${API_BASE}/status`, { headers: { 'X-API-Key': agentApiKey } }).catch(() => null),
      ])
      const hData = await hRes.json()
      setHealth(hData)
      if (sRes && sRes.ok) {
        setRemoteStatus(await sRes.json())
      } else {
        setRemoteStatus(null)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка health-check')
    }
  }

  const loadSources = async () => {
    if (!agentApiKey) return
    setBusyKb(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/kb/sources`, { headers: { 'X-API-Key': agentApiKey } })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
      setSources(data.sources || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить KB')
      setSources([])
    } finally {
      setBusyKb(false)
    }
  }

  const syncKbFiles = async () => {
    if (!agentApiKey) return
    setBusyKb(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/kb/sync-files`, {
        method: 'POST',
        headers: apiHeaders,
        body: '{}',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
      flash(`KB синхронизирован: ${data.chunks ?? 0} чанков, mode=${data.embed_mode || '?'}`)
      await loadSources()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка sync KB')
    } finally {
      setBusyKb(false)
    }
  }

  const ingestPaste = async () => {
    if (!agentApiKey || !ingestText.trim()) return
    setBusyKb(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/kb/ingest`, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ source: ingestSource.trim() || 'custom.md', text: ingestText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
      flash(`Загружено: ${data.source} → ${data.chunks} чанков`)
      setIngestText('')
      await loadSources()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка ingest')
    } finally {
      setBusyKb(false)
    }
  }

  const onFileUpload = async (file: File | null) => {
    if (!file || !agentApiKey) return
    setBusyKb(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API_BASE}/kb/upload`, {
        method: 'POST',
        headers: { 'X-API-Key': agentApiKey },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
      flash(`Файл ${data.source}: ${data.chunks} чанков`)
      await loadSources()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка upload')
    } finally {
      setBusyKb(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Загрузка…
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-gray-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
        Доступ только для администраторов
      </div>
    )
  }

  const tgBot = botUsername.startsWith('@') ? botUsername : `@${botUsername}`
  const tgGroup = groupUsername.startsWith('@') ? groupUsername : `@${groupUsername}`

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Scale className="w-7 h-7 text-slate-700" />
            FinDefender
            <span className="text-xs font-normal bg-slate-100 text-slate-700 rounded-full px-2 py-0.5">Банкротство</span>
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Админка бота квалификации по банкротству: Telegram, backend URL и RAG/KB.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void checkHealth()}
          className="text-sm border rounded-lg px-3 py-2 hover:bg-gray-50 flex items-center gap-1.5"
        >
          <RefreshCw className="w-4 h-4" /> Проверить статус
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-3 text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm flex gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Overview */}
      <section className="bg-white border rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Обзор</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Telegram bot</div>
            <a
              className="text-slate-800 font-medium hover:underline inline-flex items-center gap-1"
              href={`https://t.me/${tgBot.replace(/^@/, '')}`}
              target="_blank"
              rel="noreferrer"
            >
              {tgBot} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">HITL group</div>
            <a
              className="text-slate-800 font-medium hover:underline inline-flex items-center gap-1"
              href={`https://t.me/${tgGroup.replace(/^@/, '')}`}
              target="_blank"
              rel="noreferrer"
            >
              {tgGroup} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Webhook URL</div>
            <code className="text-xs text-gray-800 break-all">
              {settings.webhook_url || (appPublicUrl ? `${appPublicUrl.replace(/\/+$/, '')}/webhook/telegram` : '— задайте APP_PUBLIC_URL')}
            </code>
          </div>
        </div>
        {health && (
          <div className={`text-sm rounded-lg px-3 py-2 ${health.reachable ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
            Backend: {health.reachable ? 'доступен' : 'недоступен'}
            {health.detail ? ` — ${health.detail}` : ''}
            {remoteStatus && typeof remoteStatus.db_ready === 'boolean' ? ` · DB: ${remoteStatus.db_ready ? 'ok' : 'нет'}` : ''}
          </div>
        )}
      </section>

      {/* Settings */}
      <section className="bg-white border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Настройки</h2>
        <p className="text-xs text-gray-500">
          Значения пишутся в <code className="bg-gray-100 px-1 rounded">service_settings</code>.
          Секреты в git не попадают. На сервере FinDefender те же значения должны быть в <code className="bg-gray-100 px-1 rounded">.env</code>
          (<code className="bg-gray-100 px-1 rounded">TELEGRAM_BOT_TOKEN</code>, <code className="bg-gray-100 px-1 rounded">SWOOP_API_KEY</code>, …).
        </p>

        <label className="block text-sm">
          <span className="text-gray-700">FinDefender API base URL</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder="http://localhost:8000 или https://findefender.example.com"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-700">
            Admin API key (SWOOP_API_KEY бота)
            {settings.admin_api_key_set && (
              <span className="ml-2 text-xs text-gray-500">сохранён: {settings.admin_api_key_masked}</span>
            )}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder={settings.admin_api_key_set ? 'Оставьте пустым, чтобы не менять' : 'Ключ для /admin/* на FinDefender'}
            value={adminApiKey}
            onChange={(e) => setAdminApiKey(e.target.value)}
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-gray-700">Bot username</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2"
              value={botUsername}
              onChange={(e) => setBotUsername(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">HITL group</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2"
              value={groupUsername}
              onChange={(e) => setGroupUsername(e.target.value)}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-gray-700">
            TELEGRAM_BOT_TOKEN
            {settings.telegram_bot_token_set && (
              <span className="ml-2 text-xs text-gray-500">сохранён: {settings.telegram_bot_token_masked}</span>
            )}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder={settings.telegram_bot_token_set ? 'Оставьте пустым, чтобы не менять' : 'Токен от @BotFather'}
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-700">TELEGRAM_HITL_GROUP_ID</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder="-100…"
            value={hitlGroupId}
            onChange={(e) => setHitlGroupId(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-700">APP_PUBLIC_URL</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder="https://your-findefender-host"
            value={appPublicUrl}
            onChange={(e) => setAppPublicUrl(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-700">Заметки</span>
          <textarea
            className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[72px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Опционально: деплой, VPS, docker compose…"
          />
        </label>

        <button
          type="button"
          disabled={saving}
          onClick={() => void saveSettings()}
          className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Сохранить
        </button>
      </section>

      {/* RAG */}
      <section className="bg-white border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-gray-900">RAG / Knowledge Base</h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyKb}
              onClick={() => void loadSources()}
              className="text-sm border rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              Список источников
            </button>
            <button
              type="button"
              disabled={busyKb}
              onClick={() => void syncKbFiles()}
              className="text-sm border rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-4 h-4 ${busyKb ? 'animate-spin' : ''}`} />
              Sync KB from files
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Загрузка проксируется через agent-api на FinDefender <code className="bg-gray-100 px-1 rounded">/admin/kb/*</code>.
          Sync перечитывает <code className="bg-gray-100 px-1 rounded">kb/*.md</code> на сервере бота.
        </p>

        {sources.length > 0 && (
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Chunks</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.source} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{s.source}</td>
                    <td className="px-3 py-2">{s.chunk_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm">
            <span className="text-gray-700">Имя источника</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2"
              value={ingestSource}
              onChange={(e) => setIngestSource(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Текст (markdown / plain)</span>
            <textarea
              className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[140px] font-mono text-xs"
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              placeholder="Вставьте FAQ / правило / выдержку из закона…"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyKb || !ingestText.trim()}
              onClick={() => void ingestPaste()}
              className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              Ingest text
            </button>
            <label className="inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 hover:bg-gray-50 cursor-pointer">
              <Upload className="w-4 h-4" />
              Upload .md / .txt
              <input
                type="file"
                accept=".md,.txt,.markdown,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  void onFileUpload(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  )
}
