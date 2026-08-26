import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Copy, Plus, Trash2, Globe, Link as LinkIcon, Save, Upload, FileText, AlertCircle, CheckCircle, Play, Send } from 'lucide-react'

type ChatAgent = {
  id: string
  name: string
  status: string
  default_lang: string
  data_region: string
  n8n_webhook_url: string | null
  telegram_bot_token?: string | null
  telegram_bot_username?: string | null
  telegram_webhook_url?: string | null
  bot_role?: string | null
  created_at: string
}

type ChatAgentDomain = {
  id: number
  bot_id: string
  domain: string
  created_at: string
}

type ChatAgentSource = {
  id: string
  bot_id: string
  owner_user_id: string
  source_type: string
  title: string | null
  url: string | null
  storage_path: string | null
  markdown_path?: string | null
  status: string
  error?: string | null
  bytes: number
  created_at: string
}

type ChatAgentIndexJob = {
  id: string
  bot_id: string
  owner_user_id: string
  mode: string | null
  status: string
  error: string | null
  created_at: string
  started_at?: string | null
  finished_at?: string | null
}

function normalizeDomain(input: string) {
  let d = (input || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/\/.*$/, '')
  d = d.replace(/:\d+$/, '')
  return d
}

function isSafeHttpUrl(input: string) {
  try {
    const u = new URL(input)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = (u.hostname || '').toLowerCase()
    if (!host) return false
    // basic SSRF-ish client-side checks (server-side must also validate later)
    if (host === 'localhost' || host.endsWith('.localhost')) return false
    if (host === '127.0.0.1' || host === '0.0.0.0') return false
    // RFC1918 and link-local (best-effort; does not resolve DNS)
    if (/^10\./.test(host)) return false
    if (/^192\.168\./.test(host)) return false
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false
    if (/^169\.254\./.test(host)) return false
    return true
  } catch {
    return false
  }
}

type TelegramLiveStatus = {
  connected: boolean
  bot_username: string | null
  webhook_url: string | null
  last_error: string | null
}

function sourceStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'done':
      return { label: 'В RAG', className: 'bg-green-100 text-green-800' }
    case 'converting':
      return { label: 'PDF → Markdown', className: 'bg-sky-100 text-sky-800' }
    case 'error':
      return { label: 'Ошибка', className: 'bg-red-100 text-red-800' }
    case 'pending':
      return { label: 'Загружен, ждёт индексации', className: 'bg-amber-100 text-amber-800' }
    default:
      return { label: status || 'неизвестно', className: 'bg-gray-100 text-gray-700' }
  }
}

function telegramBadge(
  live: TelegramLiveStatus | null,
  agent: ChatAgent,
): { label: string; className: string } {
  const uname = live?.bot_username || agent.telegram_bot_username
  const connected = live?.connected || Boolean(agent.telegram_bot_username && agent.telegram_webhook_url)
  if (connected) {
    return {
      label: `Подключён${uname ? ` @${String(uname).replace(/^@/, '')}` : ''}`,
      className: 'bg-green-100 text-green-800',
    }
  }
  if ((agent.telegram_bot_token || '').trim()) {
    return { label: 'Токен есть, webhook не подтверждён', className: 'bg-amber-100 text-amber-800' }
  }
  return { label: 'Не подключён', className: 'bg-gray-100 text-gray-700' }
}

export function ChatAgents() {
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [domains, setDomains] = useState<ChatAgentDomain[]>([])
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLang, setNewLang] = useState('en')
  const [newWebhookUrl, setNewWebhookUrl] = useState('')

  const [domainInput, setDomainInput] = useState('')
  const [savingBot, setSavingBot] = useState(false)
  const [sources, setSources] = useState<ChatAgentSource[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<Record<string, 'pending' | 'success' | 'error'>>({})
  const [urlInput, setUrlInput] = useState('')
  const [addingUrl, setAddingUrl] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [jobs, setJobs] = useState<ChatAgentIndexJob[]>([])
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [telegramMsg, setTelegramMsg] = useState<string | null>(null)
  const [telegramLive, setTelegramLive] = useState<TelegramLiveStatus | null>(null)

  const selected = useMemo(() => agents.find(a => a.id === selectedBotId) || null, [agents, selectedBotId])
  const selectedDomains = useMemo(() => domains.filter(d => d.bot_id === selectedBotId), [domains, selectedBotId])
  const selectedSources = useMemo(() => (selected ? sources.filter(s => s.bot_id === selected.id) : []), [sources, selected])
  const telegramBadgeView = selected ? telegramBadge(telegramLive, selected) : null
  const selectedLastJob = useMemo(() => {
    if (!selected) return null
    const list = jobs.filter(j => j.bot_id === selected.id)
    if (!list.length) return null
    return list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  }, [jobs, selected])

  const fetchAll = async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true)

    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      setIsAdmin(profile?.role === 'admin')
    } else {
      setIsAdmin(false)
    }

    const { data: aData, error: aErr } = await supabase
      .from('chat_agents')
      .select('*')
      .order('created_at', { ascending: false })

    if (aErr) console.error(aErr)
    let list = (aData || []) as ChatAgent[]
    if (!aErr && list.length === 0 && user) {
      const { data: created, error: createErr } = await supabase
        .from('chat_agents')
        .insert({
          owner_user_id: user.id,
          name: 'Sales consultant',
          status: 'active',
          default_lang: 'ru',
          data_region: 'global',
          bot_role: 'sales',
        })
        .select('*')
        .single()
      if (createErr) console.error(createErr)
      else if (created) list = [created as ChatAgent]
    }
    setAgents(list)
    if (!selectedBotId && list.length > 0) setSelectedBotId(list[0].id)

    const { data: dData, error: dErr } = await supabase
      .from('chat_agent_domains')
      .select('*')
      .order('created_at', { ascending: false })
    if (dErr) console.error(dErr)
    setDomains((dData || []) as any)

    const { data: sData, error: sErr } = await supabase
      .from('chat_agent_sources')
      .select('*')
      .order('created_at', { ascending: false })
    if (sErr) console.error(sErr)
    setSources((sData || []) as any)

    const { data: jData, error: jErr } = await supabase
      .from('chat_agent_index_jobs')
      .select('*')
      .order('created_at', { ascending: false })
    if (jErr) console.error(jErr)
    setJobs((jData || []) as any)

    if (!opts?.quiet) setLoading(false)
  }

  const fetchTelegramStatus = async (botId: string) => {
    try {
      const res = await fetch(
        `https://chat.autoro.tech/v1/chat-agent/telegram/status?bot_id=${encodeURIComponent(botId)}`,
      )
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        setTelegramLive({ connected: false, bot_username: null, webhook_url: null, last_error: data?.error || `HTTP ${res.status}` })
        return
      }
      setTelegramLive({
        connected: Boolean(data.connected),
        bot_username: data.bot_username || null,
        webhook_url: data.webhook_url || null,
        last_error: data.last_error || null,
      })
    } catch (e: unknown) {
      setTelegramLive({
        connected: false,
        bot_username: null,
        webhook_url: null,
        last_error: e instanceof Error ? e.message : 'не удалось проверить Telegram',
      })
    }
  }

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedBotId) {
      setTelegramLive(null)
      return
    }
    void fetchTelegramStatus(selectedBotId)
  }, [selectedBotId])

  useEffect(() => {
    if (!selectedLastJob) return
    if (selectedLastJob.status !== 'queued' && selectedLastJob.status !== 'running') return
    const timer = window.setInterval(() => {
      void fetchAll({ quiet: true })
    }, 3000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLastJob?.id, selectedLastJob?.status])

  const installSnippet = useMemo(() => {
    if (!selected) return ''
    return `<script src="https://chat.autoro.tech/widget/chat-agent.js" data-bot-id="${selected.id}"></script>`
  }, [selected])

  const copySnippet = async () => {
    if (!installSnippet) return
    await navigator.clipboard.writeText(installSnippet)
    alert('Сниппет скопирован')
  }

  const createAgent = async () => {
    const name = newName.trim()
    if (!name) return alert('Введите имя Chat Agent')

    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return alert('Сессия не найдена. Перезайдите.')

    setCreating(true)
    try {
      const { data, error } = await supabase
        .from('chat_agents')
        .insert({
          owner_user_id: user.id,
          name,
          status: 'active',
          default_lang: newLang,
          data_region: 'global',
          bot_role: 'sales',
          // Клиент не должен знать про n8n: webhook назначается админом позже.
          n8n_webhook_url: isAdmin ? (newWebhookUrl.trim() || null) : null,
        })
        .select('*')
        .single()

      if (error) throw error
      setAgents(prev => [data as any, ...prev])
      setSelectedBotId((data as any).id)
      setNewName('')
      setNewWebhookUrl('')
      alert('Chat Agent создан')
    } catch (e: any) {
      console.error(e)
      alert(`Не удалось создать Chat Agent: ${e.message || e.error_description || 'unknown error'}`)
    } finally {
      setCreating(false)
    }
  }

  const saveSelected = async () => {
    if (!selected) return
    setSavingBot(true)
    try {
      const { error } = await supabase
        .from('chat_agents')
        .update({
          ...(isAdmin ? { n8n_webhook_url: selected.n8n_webhook_url } : {}),
          default_lang: selected.default_lang,
          status: selected.status,
          bot_role: selected.bot_role || 'support',
          telegram_bot_token: selected.telegram_bot_token || null,
        })
        .eq('id', selected.id)
      if (error) throw error
      alert('Сохранено')
    } catch (e: any) {
      console.error(e)
      alert(`Не удалось сохранить: ${e.message || 'unknown error'}`)
    } finally {
      setSavingBot(false)
    }
  }

  const connectTelegram = async () => {
    if (!selected) return
    const token = (selected.telegram_bot_token || '').trim()
    if (!token) return alert('Сначала вставьте токен от @BotFather и нажмите Save')
    setTelegramBusy(true)
    setTelegramMsg(null)
    try {
      const { error } = await supabase
        .from('chat_agents')
        .update({ telegram_bot_token: token })
        .eq('id', selected.id)
      if (error) throw error
      const res = await fetch(
        `https://chat.autoro.tech/v1/chat-agent/telegram/setup?bot_id=${encodeURIComponent(selected.id)}`,
        { method: 'POST' },
      )
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        setTelegramMsg(data?.error || data?.description || `HTTP ${res.status}`)
        return
      }
      const uname = data.bot_username ? `@${data.bot_username}` : 'бот'
      setTelegramMsg(`Подключено: ${uname}`)
      setTelegramLive({
        connected: Boolean(data.connected ?? data.ok),
        bot_username: data.bot_username || null,
        webhook_url: data.webhook_url || null,
        last_error: data.description || null,
      })
      setAgents(prev => prev.map(a => a.id === selected.id
        ? { ...a, telegram_bot_username: data.bot_username || a.telegram_bot_username, telegram_webhook_url: data.webhook_url || a.telegram_webhook_url }
        : a))
      await fetchTelegramStatus(selected.id)
    } catch (e: any) {
      setTelegramMsg(e.message || 'не удалось подключить Telegram')
    } finally {
      setTelegramBusy(false)
    }
  }

  const deleteAgent = async (botId: string) => {
    if (!confirm('Удалить Chat Agent? Домены тоже удалятся.')) return
    const { error } = await supabase.from('chat_agents').delete().eq('id', botId)
    if (error) {
      console.error(error)
      alert('Не удалось удалить')
      return
    }
    setAgents(prev => prev.filter(a => a.id !== botId))
    setDomains(prev => prev.filter(d => d.bot_id !== botId))
    if (selectedBotId === botId) setSelectedBotId(null)
  }

  const addDomain = async () => {
    if (!selected) return
    const d = normalizeDomain(domainInput)
    if (!d) return alert('Введите домен (например example.com)')
    setDomainInput('')
    const { data, error } = await supabase
      .from('chat_agent_domains')
      .insert({ bot_id: selected.id, domain: d })
      .select('*')
      .single()
    if (error) {
      console.error(error)
      alert('Не удалось добавить домен (возможно уже существует)')
      return
    }
    setDomains(prev => [data as any, ...prev])
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!selected) return
    if (!files || files.length === 0) return
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return alert('Сессия не найдена. Перезайдите.')

    setUploading(true)
    try {
      const arr = Array.from(files)
      const MAX_SOURCES = 10
      const remainingSlots = MAX_SOURCES - selectedSources.length
      if (remainingSlots <= 0) {
        alert('Лимит источников RAG: 10 на бота. Удалите что-то или создайте нового бота.')
        return
      }

      if (arr.length > remainingSlots) {
        alert(`Лимит источников RAG: 10. Можно добавить ещё: ${remainingSlots}. Вы выбрали файлов: ${arr.length}. Будут загружены только первые ${remainingSlots}.`)
      }

      for (const file of arr) {
        if (sources.filter(s => s.bot_id === selected.id).length >= MAX_SOURCES) break

        const key = file.name
        setUploadStatus(prev => ({ ...prev, [key]: 'pending' }))

        // basic limits (MVP)
        const MAX_SIZE = 10 * 1024 * 1024
        if (file.size > MAX_SIZE) {
          setUploadStatus(prev => ({ ...prev, [key]: 'error' }))
          continue
        }

        const filePath = `${user.id}/chat_agents/${selected.id}/uploads/${Date.now()}_${file.name}`
        const { error: upErr } = await supabase.storage.from('user_uploads').upload(filePath, file)
        if (upErr) {
          console.error(upErr)
          setUploadStatus(prev => ({ ...prev, [key]: 'error' }))
          continue
        }

        const { data: rec, error: insErr } = await supabase
          .from('chat_agent_sources')
          .insert({
            bot_id: selected.id,
            owner_user_id: user.id,
            source_type: 'upload',
            title: file.name,
            storage_path: filePath,
            bytes: file.size,
            status: 'pending',
          })
          .select('*')
          .single()

        if (insErr) {
          console.error(insErr)
          setUploadStatus(prev => ({ ...prev, [key]: 'error' }))
          continue
        }

        setSources(prev => [rec as any, ...prev])
        setUploadStatus(prev => ({ ...prev, [key]: 'success' }))
      }
      await indexNow({ silent: true })
    } finally {
      setUploading(false)
    }
  }

  const addUrlSource = async () => {
    if (!selected) return
    const MAX_SOURCES = 10
    if (selectedSources.length >= MAX_SOURCES) {
      alert('Лимит источников RAG: 10 на бота. Удалите что-то или создайте нового бота.')
      return
    }
    const u = urlInput.trim()
    if (!isSafeHttpUrl(u)) return alert('Неверная или небезопасная ссылка. Разрешены только http/https, без localhost/private IP.')
    if (u.length > 2000) return alert('Ссылка слишком длинная')
    if (/\.pdf($|\?)/i.test(u)) return alert('PDF по ссылке не поддерживаем — пожалуйста загрузите PDF файлом.')

    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return alert('Сессия не найдена. Перезайдите.')

    setAddingUrl(true)
    try {
      const { data: rec, error } = await supabase
        .from('chat_agent_sources')
        .insert({
          bot_id: selected.id,
          owner_user_id: user.id,
          source_type: 'url',
          title: u,
          url: u,
          bytes: 0,
          status: 'pending',
        })
        .select('*')
        .single()
      if (error) throw error
      setSources(prev => [rec as any, ...prev])
      setUrlInput('')
      await indexNow({ silent: true })
    } catch (e: any) {
      console.error(e)
      alert('Не удалось добавить ссылку')
    } finally {
      setAddingUrl(false)
    }
  }

  const deleteSource = async (source: ChatAgentSource) => {
    if (!selected) return
    if (!confirm('Удалить источник?')) return
    try {
      if (source.source_type === 'upload' && source.storage_path) {
        await supabase.storage.from('user_uploads').remove([source.storage_path])
      }
      const { error } = await supabase.from('chat_agent_sources').delete().eq('id', source.id)
      if (error) throw error
      setSources(prev => prev.filter(s => s.id !== source.id))
    } catch (e) {
      console.error(e)
      alert('Не удалось удалить')
    }
  }

  const indexNow = async (opts?: { silent?: boolean }) => {
    if (!selected) return
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return alert('Сессия не найдена. Перезайдите.')

    if (selectedSources.length === 0 && !opts?.silent) {
      alert('Сначала добавьте хотя бы один источник (файл или ссылка).')
      return
    }

    setIndexing(true)
    try {
      const { data: job, error } = await supabase
        .from('chat_agent_index_jobs')
        .insert({
          bot_id: selected.id,
          owner_user_id: user.id,
          mode: 'full',
          status: 'queued',
        })
        .select('*')
        .single()
      if (error) throw error
      setJobs(prev => [job as any, ...prev])
      if (!opts?.silent) alert('Индексация поставлена в очередь. PDF конвертируется в Markdown локально, без LLM-токенов.')
    } catch (e) {
      console.error(e)
      if (!opts?.silent) alert('Не удалось создать задачу индексации')
    } finally {
      setIndexing(false)
    }
  }

  const deleteDomain = async (domainId: number) => {
    const { error } = await supabase.from('chat_agent_domains').delete().eq('id', domainId)
    if (error) {
      console.error(error)
      alert('Не удалось удалить домен')
      return
    }
    setDomains(prev => prev.filter(d => d.id !== domainId))
  }

  if (loading) return <div className="p-4">Загрузка…</div>

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chat Agent</h1>
          <p className="text-sm text-gray-500 mt-1">
            Клиент создаёт бота и домены, вставляет сниппет на сайт. Webhook для n8n назначается админом и не показывается клиенту.
          </p>
        </div>
      </div>

      {/* Create */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={18} className="text-blue-600" />
          <div className="font-semibold text-gray-900">Create bot</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <div className="text-xs text-gray-500 mb-1">Bot name</div>
            <input
              className="border rounded-md px-3 py-2 text-sm w-full"
              placeholder="Например: Support Assistant"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Default language</div>
            <select className="border rounded-md px-3 py-2 text-sm w-full" value={newLang} onChange={(e) => setNewLang(e.target.value)}>
              <option value="en">en</option>
              <option value="ru">ru</option>
              <option value="es">es</option>
              <option value="it">it</option>
              <option value="vi">vi</option>
            </select>
          </div>
          {isAdmin ? (
            <div className="md:col-span-2">
              <div className="text-xs text-gray-500 mb-1">n8n Webhook Production URL (admin)</div>
              <input
                className="border rounded-md px-3 py-2 text-sm w-full"
                placeholder="https://tech.autoro.tech/webhook/..."
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
              />
            </div>
          ) : (
            <div className="md:col-span-2 text-xs text-gray-500 border rounded-md px-3 py-2 bg-gray-50">
              Webhook назначит админ после создания бота.
            </div>
          )}
        </div>
        <div className="mt-3">
          <button
            onClick={createAgent}
            disabled={creating}
            className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-60 text-sm"
          >
            {creating ? 'Creating…' : 'Create Chat Agent'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 font-semibold text-gray-900 flex items-center gap-2">
            <Globe size={16} className="text-gray-600" />
            Bots
          </div>
          <div className="divide-y">
            {agents.length === 0 && <div className="p-4 text-sm text-gray-500">Пока нет ботов. Создайте первого.</div>}
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => setSelectedBotId(a.id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                  selectedBotId === a.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{a.name}</div>
                    <div className="text-xs text-gray-500 truncate">ID: {a.id}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    a.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {a.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="lg:col-span-2 space-y-6">
          {!selected && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
              Выберите бота слева.
            </div>
          )}

          {selected && (
            <>
              <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">{selected.name}</div>
                    <div className="text-xs text-gray-500">Region (Регион данных): <span className="font-medium">{selected.data_region}</span> {selected.data_region === 'ru' ? '(данные хранятся в РФ)' : '(глобальное хранилище)'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveSelected}
                      disabled={savingBot}
                      className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60 text-sm flex items-center gap-2"
                    >
                      <Save size={16} />
                      {savingBot ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => deleteAgent(selected.id)}
                      className="px-3 py-2 bg-red-50 text-red-700 rounded-md hover:bg-red-100 text-sm flex items-center gap-2"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Language (Язык)</div>
                    <select
                      className="border rounded-md px-3 py-2 text-sm w-full"
                      value={selected.default_lang}
                      onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, default_lang: e.target.value } : a))}
                    >
                      <option value="en">en (English)</option>
                      <option value="ru">ru (Русский)</option>
                      <option value="es">es (Español)</option>
                      <option value="it">it (Italiano)</option>
                      <option value="vi">vi (Tiếng Việt)</option>
                    </select>
                    <div className="text-xs text-gray-400 mt-1">Язык интерфейса чата по умолчанию</div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 mb-1">Status (Статус)</div>
                    <select
                      className="border rounded-md px-3 py-2 text-sm w-full"
                      value={selected.status}
                      onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, status: e.target.value } : a))}
                    >
                      <option value="active">active (активен)</option>
                      <option value="disabled">disabled (отключен)</option>
                    </select>
                    <div className="text-xs text-gray-400 mt-1">Активен: чат работает. Отключен: чат не отвечает</div>
                  </div>

                  <div className="md:col-span-3">
                    <div className="text-xs text-gray-500 mb-1">Bot role (Роль бота)</div>
                    <select
                      className="border rounded-md px-3 py-2 text-sm w-full"
                      value={selected.bot_role || 'support'}
                      onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, bot_role: e.target.value } : a))}
                    >
                      <option value="support">support (поддержка) — отвечает на вопросы пользователей</option>
                      <option value="sales">sales (продажник) — помогает с покупками и консультациями</option>
                    </select>
                    <div className="text-xs text-gray-400 mt-1">Роль определяет, какие базовые материалы (Base RAG) будут использоваться при индексации</div>
                  </div>

                  {isAdmin ? (
                    <div className="md:col-span-3">
                      <div className="text-xs text-gray-500 mb-1">n8n Webhook Production URL (admin only)</div>
                      <input
                        className="border rounded-md px-3 py-2 text-sm w-full"
                        placeholder="https://tech.autoro.tech/webhook/..."
                        value={selected.n8n_webhook_url || ''}
                        onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, n8n_webhook_url: e.target.value } : a))}
                      />
                    </div>
                  ) : (
                    <div className="md:col-span-3 text-xs border rounded-md px-3 py-2 bg-gray-50 text-gray-600">
                      Сайт-виджет работает через Chat Agent. Для Telegram админ не нужен — статус ниже.
                    </div>
                  )}

                  <div className="md:col-span-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-xs text-gray-500">Telegram</div>
                      {telegramBadgeView && (
                        <span className={`text-xs px-2 py-1 rounded-full ${telegramBadgeView.className}`}>
                          {telegramBadgeView.label}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">Токен от @BotFather</div>
                    <input
                      className="border rounded-md px-3 py-2 text-sm w-full"
                      type="password"
                      autoComplete="off"
                      placeholder="123456:ABC... токен от @BotFather"
                      value={selected.telegram_bot_token || ''}
                      onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, telegram_bot_token: e.target.value } : a))}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={connectTelegram}
                        disabled={telegramBusy || !(selected.telegram_bot_token || '').trim()}
                        className="px-3 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-60 text-sm flex items-center gap-2"
                      >
                        <Send size={16} />
                        {telegramBusy ? 'Подключаю…' : 'Подключить Telegram'}
                      </button>
                      <div className="text-xs text-gray-400">
                        Бот отвечает в личке всегда; в группе - только на @mention или reply на своё сообщение.
                      </div>
                    </div>
                    {telegramMsg && (
                      <pre className="text-xs font-mono bg-gray-50 border rounded-md p-2 overflow-x-auto whitespace-pre-wrap">{telegramMsg}</pre>
                    )}
                    {telegramLive?.last_error && !telegramLive.connected && (
                      <div className="text-xs text-red-600">Telegram: {telegramLive.last_error}</div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        <LinkIcon size={16} className="text-gray-600" />
                        Install snippet
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Вставьте этот код на ваш сайт для подключения виджета чата</div>
                    </div>
                    <button
                      onClick={copySnippet}
                      className="px-3 py-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800 text-sm flex items-center gap-2 whitespace-nowrap"
                    >
                      <Copy size={16} />
                      Copy
                    </button>
                  </div>
                  <pre className="text-xs bg-white border rounded-md p-3 overflow-auto">{installSnippet}</pre>
                </div>
              </div>

              {/* Knowledge (RAG) */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="font-semibold text-gray-900">Knowledge (RAG)</div>
                    <div className="text-xs text-gray-500 mt-1">База знаний для ответов бота. Загрузите документы или добавьте ссылки, затем запустите индексацию.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedLastJob && (
                      <div className="text-xs text-gray-500">
                        <div>
                          Индексация:{' '}
                          <span className={`font-medium ${
                            selectedLastJob.status === 'done' ? 'text-green-600' :
                            selectedLastJob.status === 'error' ? 'text-red-600' :
                            selectedLastJob.status === 'running' ? 'text-sky-700' :
                            'text-amber-700'
                          }`}>
                            {selectedLastJob.status === 'queued' ? 'в очереди' :
                              selectedLastJob.status === 'running' ? 'идёт (PDF → Markdown → RAG)' :
                              selectedLastJob.status === 'done' ? 'готово' :
                              selectedLastJob.status === 'error' ? 'ошибка' :
                              selectedLastJob.status}
                          </span>
                        </div>
                        {selectedLastJob.error && <div className="text-red-600 mt-1">{selectedLastJob.error}</div>}
                      </div>
                    )}
                    <button
                      onClick={() => { void indexNow() }}
                      disabled={indexing || selectedSources.length === 0}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-sm flex items-center gap-2"
                      title={selectedSources.length === 0 ? 'Сначала добавьте хотя бы один источник (файл или ссылку)' : 'Запустить индексацию всех источников'}
                    >
                      <Play size={16} />
                      {indexing ? 'Indexing…' : 'Index now'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Upload document</div>
                    <label className={`cursor-pointer border rounded-md px-3 py-2 text-sm flex items-center gap-2 justify-center ${uploading || selectedSources.length >= 10 ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-50'}`}>
                    <Upload size={16} />
                    Upload files (max 10 sources, 10MB/file)
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.csv,.txt,.md"
                      multiple
                      disabled={uploading || selectedSources.length >= 10}
                      onChange={(e) => uploadFiles(e.target.files)}
                    />
                  </label>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 mb-1">Add URL (HTML only)</div>
                    <div className="flex gap-2">
                      <input
                        className="border rounded-md px-3 py-2 text-sm flex-1"
                        placeholder="https://example.com/page"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                      />
                      <button
                        onClick={addUrlSource}
                        disabled={addingUrl || selectedSources.length >= 10}
                        className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-60 text-sm flex items-center gap-2 whitespace-nowrap"
                      >
                        <LinkIcon size={16} />
                        Add URL
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
                  <div className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <AlertCircle size={16} className="text-blue-600" />
                    Правила загрузки и использования Knowledge Base (RAG)
                  </div>
                  <ul className="list-disc ml-5 space-y-2 text-sm text-gray-700">
                    <li><span className="font-medium">Лимиты</span>: максимум <span className="font-semibold">10 источников</span> на бота, максимум <span className="font-semibold">10MB</span> на один файл. При достижении лимита кнопки загрузки будут отключены.</li>
                    <li><span className="font-medium">Типы файлов</span>: поддерживаются <span className="font-semibold">PDF, CSV, TXT, MD</span>. PDF по ссылке не поддерживается — загружайте PDF файлом через "Upload files".</li>
                    <li><span className="font-medium">Ссылки (URL)</span>: разрешены только <span className="font-semibold">http/https</span> и только <span className="font-semibold">HTML-страницы</span>. Запрещены: localhost, приватные IP-адреса (127.0.0.1, 192.168.x.x и т.д.).</li>
                    <li><span className="font-medium">PDF</span>: файл конвертируется в Markdown локально (pdftotext), без LLM-токенов, затем чанки попадают в RAG.</li>
                    <li><span className="font-medium">Индексация</span>: после загрузки стартует автоматически. Статус каждого файла: загружен / PDF→Markdown / в RAG / ошибка.</li>
                    <li><span className="font-medium">Безопасность</span>: ссылки <span className="font-semibold">не исполняются как код</span>, JavaScript не выполняется. Мы извлекаем только текстовое содержимое HTML-страниц безопасным способом.</li>
                    <li><span className="font-medium">Base RAG</span>: администратор может загрузить базовые материалы для ролей (support/sales), которые автоматически подмешиваются при индексации всем ботам соответствующей роли.</li>
                  </ul>
                </div>

                {Object.keys(uploadStatus).length > 0 && (
                  <div className="mt-3 space-y-2">
                    {Object.entries(uploadStatus).map(([name, st]) => (
                      <div key={name} className="flex items-center justify-between text-xs bg-gray-50 border rounded-md px-3 py-2">
                        <div className="truncate">{name}</div>
                        <div className="flex items-center gap-2">
                          {st === 'pending' && <span className="text-gray-500">uploading…</span>}
                          {st === 'success' && <CheckCircle size={14} className="text-green-600" />}
                          {st === 'error' && <AlertCircle size={14} className="text-red-600" />}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {sources.filter(s => s.bot_id === selected.id).length === 0 && (
                    <div className="text-sm text-gray-500">Пока нет источников.</div>
                  )}
                  {sources
                    .filter(s => s.bot_id === selected.id)
                    .map((s) => {
                      const badge = sourceStatusBadge(s.status)
                      return (
                      <div key={s.id} className="flex items-center justify-between bg-white border rounded-md px-3 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText size={16} className="text-blue-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm text-gray-900 truncate">
                              {s.source_type === 'url' ? s.url : s.title}
                            </div>
                            <div className="text-xs text-gray-500">
                              {s.source_type === 'upload' ? 'файл' : 'ссылка'}
                              {s.markdown_path ? ' • Markdown сохранён' : ''}
                              {s.error ? ` • ${s.error}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>{badge.label}</span>
                          <button
                            onClick={() => deleteSource(s)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Delete source"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      )
                    })}
                </div>
              </div>

              {/* Domains */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="font-semibold text-gray-900">Allowed domains</div>
                    <div className="text-xs text-gray-500 mt-1">Домены, с которых разрешено использовать виджет чата</div>
                  </div>
                </div>
                <div className="mb-2">
                  <div className="text-xs text-gray-500 mb-1">Domain</div>
                  <div className="flex gap-2">
                    <input
                      className="border rounded-md px-3 py-2 text-sm flex-1"
                      placeholder="example.com (поддомены тоже разрешатся)"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                    />
                    <button
                      onClick={addDomain}
                      className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 text-sm whitespace-nowrap"
                    >
                      Add
                    </button>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Пример: example.com (www.example.com и другие поддомены тоже будут разрешены)</div>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedDomains.length === 0 && <div className="text-sm text-gray-500">Пока нет доменов. Добавьте хотя бы один.</div>}
                  {selectedDomains.map(d => (
                    <div key={d.id} className="flex items-center justify-between bg-gray-50 border rounded-md px-3 py-2">
                      <div className="text-sm text-gray-900">{d.domain}</div>
                      <button
                        onClick={() => deleteDomain(d.id)}
                        className="text-red-600 hover:text-red-800 p-1"
                        title="Delete domain"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


