import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Copy, Save, Trash2, ShieldAlert, Search, Users, Upload, FileText, Link as LinkIcon, ChevronDown, ChevronRight } from 'lucide-react'

type Profile = { id: string; email: string; role: string }

type ChatAgent = {
  id: string
  owner_user_id: string
  name: string
  status: string
  default_lang: string
  data_region: string
  n8n_webhook_url: string | null
  telegram_bot_token: string | null
  whatsapp_phone_id: string | null
  created_at: string
}

type ChatAgentDomain = {
  id: number
  bot_id: string
  domain: string
  created_at: string
}

type BaseKbItem = {
  id: string
  role: string
  source_type: string
  title: string | null
  url: string | null
  storage_path: string | null
  status: string
  bytes: number
  created_at: string
}

export function AdminChatAgents() {
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [domains, setDomains] = useState<ChatAgentDomain[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])

  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null)
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const searchNorm = (search || '').trim().toLowerCase()

  const selected = useMemo(() => agents.find(a => a.id === selectedBotId) || null, [agents, selectedBotId])
  // selectedDomains removed (domains are shown at client-card level)

  const ownerEmail = useMemo(() => {
    if (!selected) return ''
    return profiles.find(p => p.id === selected.owner_user_id)?.email || selected.owner_user_id
  }, [profiles, selected])

  // domainInput removed (admin UI does not edit per-bot domains)
  const [saving, setSaving] = useState(false)
  const [baseKb, setBaseKb] = useState<BaseKbItem[]>([])
  const [baseKbUploading, setBaseKbUploading] = useState(false)
  const [baseKbUrl, setBaseKbUrl] = useState('')
  const [baseKbRole, setBaseKbRole] = useState<'support' | 'sales'>('support')
  const [botDetailsOpen, setBotDetailsOpen] = useState(false)

  const ownerEmailById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of profiles) {
      if (p?.id) m.set(p.id, p.email || p.id)
    }
    return m
  }, [profiles])

  const botsByOwner = useMemo(() => {
    const m = new Map<string, ChatAgent[]>()
    for (const a of agents) {
      const key = a.owner_user_id
      const list = m.get(key) || []
      list.push(a)
      m.set(key, list)
    }
    // sort each owner's bots by created desc
    for (const [k, list] of m) {
      list.sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
      m.set(k, list)
    }
    return m
  }, [agents])

  const domainsByBot = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const d of domains) {
      const list = m.get(d.bot_id) || []
      list.push(d.domain)
      m.set(d.bot_id, list)
    }
    for (const [k, list] of m) {
      list.sort()
      m.set(k, list)
    }
    return m
  }, [domains])

  const clients = useMemo(() => {
    // A client is identified by owner_user_id
    const owners = Array.from(botsByOwner.keys())
    const items = owners.map((ownerId) => {
      const email = ownerEmailById.get(ownerId) || ownerId
      const bots = botsByOwner.get(ownerId) || []
      const domainsFlat = bots.flatMap(b => domainsByBot.get(b.id) || [])
      const connected = bots.filter(b => !!b.n8n_webhook_url).length
      const pending = bots.length - connected
      return { ownerId, email, bots, domains: Array.from(new Set(domainsFlat)).sort(), connected, pending }
    })

    // Search filter by email/domain/bot name/bot id
    const filtered = searchNorm
      ? items.filter(c => {
          if (c.email.toLowerCase().includes(searchNorm)) return true
          if (c.ownerId.toLowerCase().includes(searchNorm)) return true
          if (c.domains.some(d => d.toLowerCase().includes(searchNorm))) return true
          if (c.bots.some(b => b.name.toLowerCase().includes(searchNorm) || b.id.toLowerCase().includes(searchNorm))) return true
          return false
        })
      : items

    filtered.sort((a, b) => a.email.localeCompare(b.email))
    return filtered
  }, [botsByOwner, domainsByBot, ownerEmailById, searchNorm])

  const selectedClient = useMemo(() => {
    if (!selectedOwnerId) return null
    return clients.find(c => c.ownerId === selectedOwnerId) || null
  }, [clients, selectedOwnerId])

  const installSnippet = useMemo(() => {
    if (!selected) return ''
    return `<script src="https://chat.autoro.tech/widget/chat-agent.js" data-bot-id="${selected.id}"></script>`
  }, [selected])

  const copySnippet = async () => {
    if (!installSnippet) return
    await navigator.clipboard.writeText(installSnippet)
    alert('Сниппет скопирован')
  }

  const fetchAll = async () => {
    setLoading(true)
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) {
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const admin = profile?.role === 'admin'
    setIsAdmin(admin)
    if (!admin) {
      setLoading(false)
      return
    }

    const { data: aData, error: aErr } = await supabase
      .from('chat_agents')
      .select('*')
      .order('created_at', { ascending: false })
    if (aErr) console.error(aErr)
    setAgents((aData || []) as any)
    // Set default selections
    if (!selectedOwnerId && aData && aData.length > 0) setSelectedOwnerId(aData[0].owner_user_id)
    if (!selectedBotId && aData && aData.length > 0) setSelectedBotId(aData[0].id)

    const { data: dData, error: dErr } = await supabase
      .from('chat_agent_domains')
      .select('*')
      .order('created_at', { ascending: false })
    if (dErr) console.error(dErr)
    setDomains((dData || []) as any)

    // Email mapping for owners (profiles is public select anyway)
    const { data: pData, error: pErr } = await supabase
      .from('profiles')
      .select('id,email,role')
      .order('created_at', { ascending: false })
    if (pErr) console.error(pErr)
    setProfiles((pData || []) as any)

    const { data: kbData, error: kbErr } = await supabase
      .from('chat_agent_base_kb')
      .select('*')
      .order('created_at', { ascending: false })
    if (kbErr) console.error(kbErr)
    setBaseKb((kbData || []) as any)

    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveSelected = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('chat_agents')
        .update({
          name: selected.name,
          status: selected.status,
          default_lang: selected.default_lang,
          data_region: selected.data_region,
          n8n_webhook_url: selected.n8n_webhook_url,
          telegram_bot_token: selected.telegram_bot_token,
          whatsapp_phone_id: selected.whatsapp_phone_id,
        })
        .eq('id', selected.id)
      if (error) throw error
      alert('Сохранено')
    } catch (e: any) {
      console.error(e)
      alert(`Ошибка сохранения: ${e.message || 'unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  const deleteBot = async (botId: string) => {
    if (!confirm('Удалить Chat Agent?')) return
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

  // Per-bot domain editing is intentionally hidden here (admins usually set domains via client-owned UI).

  const uploadBaseKbFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return alert('Сессия не найдена. Перезайдите.')

    setBaseKbUploading(true)
    try {
      const arr = Array.from(files)
      for (const file of arr) {
        const MAX_SIZE = 10 * 1024 * 1024
        if (file.size > MAX_SIZE) {
          alert(`Файл слишком большой: ${file.name}`)
          continue
        }

        const filePath = `${user.id}/chat_agent_base_kb/${baseKbRole}/uploads/${Date.now()}_${file.name}`
        const { error: upErr } = await supabase.storage.from('user_uploads').upload(filePath, file)
        if (upErr) {
          console.error(upErr)
          alert(`Не удалось загрузить: ${file.name}`)
          continue
        }

        const { data: rec, error: insErr } = await supabase
          .from('chat_agent_base_kb')
          .insert({
            role: baseKbRole,
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
          alert(`Не удалось создать запись: ${file.name}`)
          continue
        }

        setBaseKb(prev => [rec as any, ...prev])
      }
      alert('Базовые материалы добавлены (pending)')
    } finally {
      setBaseKbUploading(false)
    }
  }

  const addBaseKbUrl = async () => {
    const u = baseKbUrl.trim()
    if (!u) return
    if (u.length > 2000) return alert('Ссылка слишком длинная')
    if (!/^https?:\/\//i.test(u)) return alert('Разрешены только http/https')

    setBaseKbUploading(true)
    try {
      const { data: rec, error } = await supabase
        .from('chat_agent_base_kb')
        .insert({
          role: baseKbRole,
          source_type: 'url',
          title: u,
          url: u,
          bytes: 0,
          status: 'pending',
        })
        .select('*')
        .single()
      if (error) throw error
      setBaseKb(prev => [rec as any, ...prev])
      setBaseKbUrl('')
    } catch (e) {
      console.error(e)
      alert('Не удалось добавить ссылку')
    } finally {
      setBaseKbUploading(false)
    }
  }

  const deleteBaseKb = async (item: BaseKbItem) => {
    if (!confirm('Удалить базовый материал?')) return
    try {
      if (item.source_type === 'upload' && item.storage_path) {
        await supabase.storage.from('user_uploads').remove([item.storage_path])
      }
      const { error } = await supabase.from('chat_agent_base_kb').delete().eq('id', item.id)
      if (error) throw error
      setBaseKb(prev => prev.filter(x => x.id !== item.id))
    } catch (e) {
      console.error(e)
      alert('Не удалось удалить')
    }
  }

  if (loading) return <div className="p-4">Загрузка…</div>
  if (!isAdmin) return <div className="p-4 text-red-600 flex items-center gap-2"><ShieldAlert size={18} /> Access Denied</div>

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin: Chat Agent</h1>
        <p className="text-sm text-gray-500 mt-1">Админ‑панель клиентов: email → список ботов → домены → статус → snippet. Поиск по email/домену/боту.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Clients list */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 font-semibold text-gray-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-gray-600" />
              <span>Clients</span>
            </div>
            <button onClick={fetchAll} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>

          <div className="p-3 border-b">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input
                className="w-full border rounded-md pl-9 pr-3 py-2 text-sm"
                placeholder="Поиск: email / домен / бот / id"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="mt-2 text-xs text-gray-500">Найдено клиентов: {clients.length}</div>
          </div>

          <div className="divide-y max-h-[65vh] overflow-auto">
            {clients.length === 0 && <div className="p-4 text-sm text-gray-500">Нет клиентов по фильтру.</div>}
            {clients.map(c => (
              <button
                key={c.ownerId}
                onClick={() => {
                  setSelectedOwnerId(c.ownerId)
                  if (!c.bots.some(b => b.id === selectedBotId)) setSelectedBotId(c.bots[0]?.id || null)
                }}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                  selectedOwnerId === c.ownerId ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{c.email}</div>
                    <div className="text-xs text-gray-500 truncate">{c.bots.length} bots • {c.domains.length} domains</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-1 rounded-full bg-green-100 text-green-700">Connected: {c.connected}</span>
                    <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-700">Pending: {c.pending}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedClient && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
              Выберите клиента слева.
            </div>
          )}

          {selectedClient && (
            <>
              {/* Base KB for roles */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">Base RAG (role templates)</div>
                    <div className="text-xs text-gray-500 mt-1">Базовые материалы для роли support/sales (будут подмешиваться всем ботам соответствующей роли при индексации).</div>
                  </div>
                  <button onClick={fetchAll} className="text-xs text-blue-600 hover:underline">Refresh</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
                  <select
                    className="border rounded-md px-3 py-2 text-sm h-10"
                    value={baseKbRole}
                    onChange={(e) => setBaseKbRole(e.target.value as any)}
                  >
                    <option value="support">support</option>
                    <option value="sales">sales</option>
                  </select>

                  <label className={`cursor-pointer border rounded-md px-3 py-2 text-sm h-10 flex items-center gap-2 justify-center ${baseKbUploading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-50'}`}>
                    <Upload size={16} />
                    Upload files
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.csv,.txt,.md"
                      multiple
                      disabled={baseKbUploading}
                      onChange={(e) => uploadBaseKbFiles(e.target.files)}
                    />
                  </label>

                  <div className="flex gap-2 items-stretch">
                    <input
                      className="border rounded-md px-3 py-2 text-sm flex-1 h-10"
                      placeholder="https://example.com/guide"
                      value={baseKbUrl}
                      onChange={(e) => setBaseKbUrl(e.target.value)}
                    />
                    <button
                      onClick={addBaseKbUrl}
                      disabled={baseKbUploading}
                      className="px-3 py-2 h-10 bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-60 text-sm flex items-center gap-2 whitespace-nowrap"
                    >
                      <LinkIcon size={16} />
                      Add
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {baseKb.filter(x => x.role === baseKbRole).length === 0 && (
                    <div className="text-sm text-gray-500">Пока нет материалов для роли {baseKbRole}.</div>
                  )}
                  {baseKb
                    .filter(x => x.role === baseKbRole)
                    .map((x) => (
                      <div key={x.id} className="flex items-center justify-between bg-white border rounded-md px-3 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText size={16} className="text-blue-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm text-gray-900 truncate">{x.source_type === 'url' ? x.url : x.title}</div>
                            <div className="text-xs text-gray-500">{x.source_type} • {x.status}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => deleteBaseKb(x)}
                          className="text-red-600 hover:text-red-800 p-1"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              {/* Client card */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">{selectedClient.email}</div>
                    <div className="text-xs text-gray-500 mt-1">Owner ID: {selectedClient.ownerId}</div>
                  </div>
                  <div className="text-xs text-gray-500">
                    Bots: <span className="font-medium text-gray-800">{selectedClient.bots.length}</span> • Domains:{' '}
                    <span className="font-medium text-gray-800">{selectedClient.domains.length}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {selectedClient.bots.map((b) => {
                    const bDomains = domainsByBot.get(b.id) || []
                    const connected = !!b.n8n_webhook_url
                    return (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBotId(b.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selectedBotId === b.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 truncate">{b.name}</div>
                            <div className="text-xs text-gray-500 truncate">
                              {bDomains.length ? bDomains.join(', ') : 'Domains: none'}
                            </div>
                            <div className="text-[10px] text-gray-400 truncate">{b.id}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-1 rounded-full ${connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                              {connected ? 'Connected' : 'Pending'}
                            </span>
                            <span className={`text-[10px] px-2 py-1 rounded-full ${b.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                              {b.status}
                            </span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Selected bot details */}
              {selected && (
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-lg font-semibold text-gray-900">{selected.name}</div>
                        <div className="text-sm text-gray-600">Owner: <span className="font-medium">{ownerEmail}</span></div>
                        <div className="text-xs text-gray-500 mt-1">Bot ID: {selected.id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setBotDetailsOpen(v => !v)}
                          className="px-3 py-2 bg-white border rounded-md hover:bg-gray-50 text-sm flex items-center gap-2"
                        >
                          {botDetailsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          Details
                        </button>
                        <button
                          onClick={saveSelected}
                          disabled={saving}
                          className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60 text-sm flex items-center gap-2"
                        >
                          <Save size={16} />
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => deleteBot(selected.id)}
                          className="px-3 py-2 bg-red-50 text-red-700 rounded-md hover:bg-red-100 text-sm flex items-center gap-2"
                        >
                          <Trash2 size={16} />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  {botDetailsOpen && (
                    <div className="p-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          className="border rounded-md px-3 py-2 text-sm"
                          value={selected.name}
                          onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, name: e.target.value } : a))}
                        />

                        <select
                          className="border rounded-md px-3 py-2 text-sm"
                          value={selected.status}
                          onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, status: e.target.value } : a))}
                        >
                          <option value="active">active</option>
                          <option value="disabled">disabled</option>
                        </select>

                        <select
                          className="border rounded-md px-3 py-2 text-sm"
                          value={selected.default_lang}
                          onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, default_lang: e.target.value } : a))}
                        >
                          <option value="en">en</option>
                          <option value="ru">ru</option>
                          <option value="es">es</option>
                          <option value="it">it</option>
                          <option value="vi">vi</option>
                        </select>

                        <select
                          className="border rounded-md px-3 py-2 text-sm"
                          value={selected.data_region}
                          onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, data_region: e.target.value } : a))}
                        >
                          <option value="global">global</option>
                          <option value="ru">ru</option>
                        </select>

                        <input
                          className="border rounded-md px-3 py-2 text-sm md:col-span-2"
                          placeholder="n8n Webhook Production URL"
                          value={selected.n8n_webhook_url || ''}
                          onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, n8n_webhook_url: e.target.value } : a))}
                        />
                        <input
                          className="border rounded-md px-3 py-2 text-sm"
                          placeholder="Telegram Bot Token (Optional)"
                          value={selected.telegram_bot_token || ''}
                          onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, telegram_bot_token: e.target.value } : a))}
                        />
                        <input
                          className="border rounded-md px-3 py-2 text-sm"
                          placeholder="WhatsApp Phone ID (Optional)"
                          value={selected.whatsapp_phone_id || ''}
                          onChange={(e) => setAgents(prev => prev.map(a => a.id === selected.id ? { ...a, whatsapp_phone_id: e.target.value } : a))}
                        />
                      </div>

                      <div className="bg-gray-50 border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="text-sm font-medium text-gray-800">Install snippet</div>
                          <button
                            onClick={copySnippet}
                            className="px-3 py-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800 text-sm flex items-center gap-2"
                          >
                            <Copy size={16} />
                            Copy
                          </button>
                        </div>
                        <pre className="mt-2 text-xs bg-white border rounded-md p-3 overflow-auto">{installSnippet}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}


