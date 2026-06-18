import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ApiKeyGroupsField, normalizeApiGroupId, type ApiKeyGroup } from './ApiKeyGroupsField'
import {
  ProviderApiKeysPanel,
  buildApiKeyPoolMetaForSave,
  normalizeApiKeyPoolMeta,
  type ApiKeyPoolMeta,
  type OpenRouterModelMeta,
  type ProviderCatalogs,
} from './ProviderApiKeysPanel'
import { ModelSearchCombobox, buildOpenRouterMetaMap } from './ModelSearchCombobox'
import { formatAgentApiError } from '../lib/formatAgentApiError'
import {
  Settings, Save, Loader2, AlertCircle, X, Key, Bot,
  Copy, Eye, EyeOff, RefreshCw, Shield, ExternalLink,
  Send,
  Globe2,
} from 'lucide-react'

interface ServiceSettings {
  gemini_api_key: string
  gologin_api_token: string
  agent_api_key: string
  agent_enabled: boolean
  agent_rate_limit: number
  gemini_keys: string[]
  groq_keys: string[]
  glm_keys: string[]
  openai_keys: string[]
  openrouter_keys: string[]
  openrouter_default_model: string
  openrouter_qwen_keys: string[]
  openrouter_qwen_model: string
  /** API keys для [LMArenaBridge](https://github.com/CloudWaddie/LMArenaBridge) (OpenAI-compatible /api/v1). */
  lmarena_keys: string[]
  lmarena_base_url: string
  lmarena_default_model: string
  brave_keys: string[]
  tavily_keys: string[]
  api_key_groups: ApiKeyGroup[]
  /** jsonb: цепочки LLM для Bookmarks Bro (см. agent-api agent_llm_routing). */
  agent_llm_routing?: Record<string, unknown>
  /** Telegram: маршрутизация команд ассистента в n8n, остальное — Hermes (см. agent-api autoro-gateway). */
  telegram_gateway_routing_enabled?: boolean
  telegram_n8n_assistant_webhook_url?: string
  telegram_hermes_fallback_webhook_url?: string
  telegram_gateway_public_base?: string
  /** Ручное включение ключей по индексу (параллельно *_keys). */
  api_key_pool_meta?: ApiKeyPoolMeta
  /** ExpiredDomains.net member area (https://member.expireddomains.net/dev/) */
  expireddomains_username?: string
  expireddomains_password?: string
  expireddomains_session_cookie?: string
  expireddomains_api_base?: string
}

type KeyHealthEntry = {
  status: 'active' | 'inactive' | 'unknown'
  reason?: string
  until?: string
}

type KeyHealthByProvider = Record<string, KeyHealthEntry[]>

function parseApiKeyGroups(raw: unknown): ApiKeyGroup[] {
  if (!raw) return []
  let arr: unknown[] = []
  if (Array.isArray(raw)) arr = raw
  else if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      arr = Array.isArray(p) ? p : []
    } catch {
      return []
    }
  } else return []
  const out: ApiKeyGroup[] = []
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i]
    if (!o || typeof o !== 'object') continue
    const rec = o as Record<string, unknown>
    const id = normalizeApiGroupId(String(rec.id ?? `group_${i}`))
    const name = String(rec.name ?? id).trim() || id
    const keysRaw = rec.keys
    const keys = Array.isArray(keysRaw)
      ? keysRaw.map((k) => String(k).trim()).filter(Boolean)
      : []
    const provider = String(rec.provider ?? '').trim().toLowerCase()
    const tiersRaw = rec.tiers
    const tiers = Array.isArray(tiersRaw)
      ? tiersRaw.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : []
    const modelsRaw = rec.models
    const models = Array.isArray(modelsRaw)
      ? modelsRaw.map((x) => String(x).trim()).filter(Boolean)
      : []
    const user_email = String(rec.user_email ?? rec.email ?? '').trim()
    const priority = Number(rec.priority ?? 0) || 0
    if (!id) continue
    out.push({
      id,
      name,
      keys,
      provider: provider || '',
      tiers,
      models,
      user_email,
      priority,
    })
  }
  return out
}

/** Дефолт совпадает с agent-api `_default_agent_llm_routing` (пустой model = env/дефолт провайдера). */
const DEFAULT_AGENT_LLM_ROUTING = {
  tiers: {
    code: [
      { provider: 'openrouter', model: '' },
      { provider: 'groq', model: '' },
      { provider: 'glm', model: '' },
      { provider: 'openai', model: '' },
      { provider: 'gemini', model: '' },
    ],
    reasoning: [
      { provider: 'openrouter', model: '' },
      { provider: 'openai', model: '' },
      { provider: 'groq', model: '' },
      { provider: 'glm', model: '' },
      { provider: 'gemini', model: '' },
    ],
    fast: [
      { provider: 'groq', model: '' },
      { provider: 'glm', model: '' },
      { provider: 'openrouter', model: '' },
      { provider: 'openai', model: '' },
      { provider: 'gemini', model: '' },
    ],
    general: [
      { provider: 'openrouter', model: '' },
      { provider: 'glm', model: '' },
      { provider: 'groq', model: '' },
      { provider: 'openai', model: '' },
      { provider: 'gemini', model: '' },
    ],
  },
  fallback: [
    { provider: 'api_key_groups', model: '' },
    { provider: 'env_openai', model: '' },
  ],
  key_pool_strategy: 'fill-first',
} as const

const LLM_TIER_NAMES = ['code', 'reasoning', 'fast', 'general', 'vision'] as const

function parseLlmRoutingDraft(draft: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(draft) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // fall through
  }
  return { ...DEFAULT_AGENT_LLM_ROUTING }
}

function patchLlmRoutingDraft(draft: string, patch: Record<string, unknown>): string {
  const base = parseLlmRoutingDraft(draft)
  return JSON.stringify({ ...base, ...patch }, null, 2)
}

export function AdminSettings() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [settings, setSettings] = useState<ServiceSettings>({
    gemini_api_key: '',
    gologin_api_token: '',
    agent_api_key: '',
    agent_enabled: false,
    agent_rate_limit: 30,
    gemini_keys: [],
    groq_keys: [],
    glm_keys: [],
    openai_keys: [],
    openrouter_keys: [],
    openrouter_default_model: 'google/gemini-2.0-flash-001',
    openrouter_qwen_keys: [],
    openrouter_qwen_model: 'qwen/qwen3.6-plus-preview:free',
    lmarena_keys: [],
    lmarena_base_url: '',
    lmarena_default_model: '',
    brave_keys: [],
    tavily_keys: [],
    api_key_groups: [],
    telegram_gateway_routing_enabled: false,
    telegram_n8n_assistant_webhook_url: '',
    telegram_hermes_fallback_webhook_url: '',
    telegram_gateway_public_base: '',
    api_key_pool_meta: {},
    expireddomains_username: '',
    expireddomains_password: '',
    expireddomains_session_cookie: '',
    expireddomains_api_base: 'https://member.expireddomains.net',
  })

  const [showGologin, setShowGologin] = useState(false)
  const [showEdPassword, setShowEdPassword] = useState(false)
  const [showAgentKey, setShowAgentKey] = useState(false)
  const [keyHealthByProvider, setKeyHealthByProvider] = useState<KeyHealthByProvider>({})
  const [modelCatalogs, setModelCatalogs] = useState<ProviderCatalogs>({})
  const [openrouterMeta, setOpenrouterMeta] = useState<OpenRouterModelMeta[]>([])
  const [openrouterCatalogLoading, setOpenrouterCatalogLoading] = useState(false)
  const [openrouterCatalogError, setOpenrouterCatalogError] = useState<string | null>(null)
  const [verifyingKeys, setVerifyingKeys] = useState(false)
  const [llmRoutingDraft, setLlmRoutingDraft] = useState(() => JSON.stringify(DEFAULT_AGENT_LLM_ROUTING, null, 2))
  const openrouterMetaById = useMemo(() => buildOpenRouterMetaMap(openrouterMeta), [openrouterMeta])
  const openrouterModelIds = useMemo(() => openrouterMeta.map((m) => m.id), [openrouterMeta])

  const routingObj = useMemo(() => parseLlmRoutingDraft(llmRoutingDraft), [llmRoutingDraft])
  const [telegramHookBusy, setTelegramHookBusy] = useState(false)
  const [telegramHookMsg, setTelegramHookMsg] = useState<string | null>(null)

  const fetchKeyHealth = async (apiKey: string) => {
    const key = String(apiKey || '').trim()
    if (!key) {
      setKeyHealthByProvider({})
      setModelCatalogs({})
      return
    }
    try {
      const resp = await fetch('/api/v1/admin/key-health', {
        headers: {
          'X-API-Key': key,
        },
      })
      if (!resp.ok) return
      const body = await resp.json()
      const providers = body?.providers
      if (providers && typeof providers === 'object') {
        setKeyHealthByProvider(providers as KeyHealthByProvider)
      }
    } catch {
      // ignore health errors in UI
    }
  }

  const parseOpenRouterMeta = (raw: unknown): OpenRouterModelMeta[] => {
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (m): m is OpenRouterModelMeta =>
        Boolean(m && typeof m === 'object' && typeof (m as OpenRouterModelMeta).id === 'string'),
    )
  }

  const fetchOpenRouterCatalog = async (apiKey: string) => {
    const key = String(apiKey || '').trim()
    if (!key) {
      setOpenrouterMeta([])
      setOpenrouterCatalogError(null)
      return
    }
    setOpenrouterCatalogLoading(true)
    setOpenrouterCatalogError(null)
    try {
      let models: OpenRouterModelMeta[] = []
      const catalogResp = await fetch('/api/v1/openrouter/catalog', {
        headers: { 'X-API-Key': key },
      })
      if (catalogResp.ok) {
        const body = await catalogResp.json()
        models = parseOpenRouterMeta(body?.models)
      } else if (catalogResp.status === 404 || catalogResp.status === 405) {
        const legacyResp = await fetch('/api/v1/admin/provider-catalog', {
          headers: { 'X-API-Key': key },
        })
        if (!legacyResp.ok) {
          const detail = await legacyResp.text().catch(() => '')
          throw new Error(formatAgentApiError(detail, legacyResp.status))
        }
        const body = await legacyResp.json()
        models = parseOpenRouterMeta(body?.openrouter_meta)
      } else {
        const detail = await catalogResp.text().catch(() => '')
        throw new Error(formatAgentApiError(detail, catalogResp.status))
      }
      setOpenrouterMeta(models)
      if (!models.length) {
        setOpenrouterCatalogError('Каталог пуст. Проверьте, что agent-api обновлён и доступен openrouter.ai.')
      }
    } catch (e: unknown) {
      setOpenrouterCatalogError(e instanceof Error ? e.message : 'Не удалось загрузить каталог OpenRouter')
    } finally {
      setOpenrouterCatalogLoading(false)
    }
  }

  const refreshOpenRouterCatalog = async (apiKey: string, force = false) => {
    const key = String(apiKey || '').trim()
    if (!key) return
    if (force) {
      setOpenrouterCatalogLoading(true)
      setOpenrouterCatalogError(null)
      try {
        const refreshResp = await fetch('/api/v1/admin/openrouter/refresh', {
          method: 'POST',
          headers: { 'X-API-Key': key },
        })
        if (!refreshResp.ok) {
          const detail = await refreshResp.text().catch(() => '')
          throw new Error(formatAgentApiError(detail, refreshResp.status))
        }
      } catch (e: unknown) {
        setOpenrouterCatalogError(
          e instanceof Error ? e.message : 'Не удалось обновить каталог OpenRouter',
        )
        setOpenrouterCatalogLoading(false)
        return
      }
    }
    await fetchOpenRouterCatalog(key)
  }

  const fetchProviderCatalogs = async (apiKey: string) => {
    const key = String(apiKey || '').trim()
    if (!key) {
      setModelCatalogs({})
      setOpenrouterMeta([])
      return
    }
    try {
      const resp = await fetch('/api/v1/admin/provider-catalog', {
        headers: { 'X-API-Key': key },
      })
      if (!resp.ok) return
      const body = await resp.json()
      const catalogs = body?.catalogs
      if (catalogs && typeof catalogs === 'object') {
        setModelCatalogs(catalogs as ProviderCatalogs)
      }
    } catch {
      // ignore catalog errors in UI
    }
    await fetchOpenRouterCatalog(key)
  }

  const refreshAdminKeyInsights = async (apiKey: string) => {
    await Promise.all([fetchKeyHealth(apiKey), fetchProviderCatalogs(apiKey)])
  }

  const verifyAllApiKeys = async () => {
    const key = String(settings.agent_api_key || '').trim()
    if (!key) {
      setError('Сначала сохраните Agent API key (используется для проверки ключей).')
      return
    }
    setVerifyingKeys(true)
    setError(null)
    setSuccess(null)
    try {
      const resp = await fetch('/api/v1/admin/verify-keys', {
        method: 'POST',
        headers: { 'X-API-Key': key },
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        const d = (body as { detail?: unknown }).detail
        setError(typeof d === 'string' ? d : `HTTP ${resp.status}`)
        return
      }
      const results = Array.isArray((body as { results?: unknown }).results)
        ? ((body as { results: { is_valid?: boolean }[] }).results)
        : []
      const ok = results.filter((r) => r.is_valid).length
      const bad = results.length - ok
      setSuccess(`Проверка завершена: ${ok} рабочих, ${bad} с ошибкой. Статусы обновлены в key_health.`)
      await refreshAdminKeyInsights(key)
      setTimeout(() => setSuccess(null), 8000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка проверки ключей')
    } finally {
      setVerifyingKeys(false)
    }
  }

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('service_settings')
        .select('*')
        .eq('id', 1)
        .single()
      if (error) throw error
      if (data) {
        setSettings({
          gemini_api_key: data.gemini_api_key || '',
          gologin_api_token: data.gologin_api_token || '',
          agent_api_key: data.agent_api_key || '',
          agent_enabled: data.agent_enabled ?? false,
          agent_rate_limit: data.agent_rate_limit ?? 30,
          gemini_keys: (data.gemini_keys || []).filter((k: string) => k && k.trim()),
          groq_keys: (data.groq_keys || []).filter((k: string) => k && k.trim()),
          glm_keys: (data.glm_keys || []).filter((k: string) => k && k.trim()),
          openai_keys: (data.openai_keys || []).filter((k: string) => k && k.trim()),
          openrouter_keys: (data.openrouter_keys || []).filter((k: string) => k && k.trim()),
          openrouter_default_model: (data.openrouter_default_model || 'google/gemini-2.0-flash-001').trim(),
          openrouter_qwen_keys: (data.openrouter_qwen_keys || []).filter((k: string) => k && k.trim()),
          openrouter_qwen_model: (data.openrouter_qwen_model || 'qwen/qwen3.6-plus-preview:free').trim(),
          lmarena_keys: (data.lmarena_keys || []).filter((k: string) => k && k.trim()),
          lmarena_base_url: String((data as Record<string, unknown>).lmarena_base_url || '').trim(),
          lmarena_default_model: String((data as Record<string, unknown>).lmarena_default_model || '').trim(),
          brave_keys: (data.brave_keys || []).filter((k: string) => k && k.trim()),
          tavily_keys: (data.tavily_keys || []).filter((k: string) => k && k.trim()),
          api_key_groups: parseApiKeyGroups((data as Record<string, unknown>).api_key_groups),
          telegram_gateway_routing_enabled: Boolean((data as Record<string, unknown>).telegram_gateway_routing_enabled),
          telegram_n8n_assistant_webhook_url: String(
            (data as Record<string, unknown>).telegram_n8n_assistant_webhook_url || '',
          ).trim(),
          telegram_hermes_fallback_webhook_url: String(
            (data as Record<string, unknown>).telegram_hermes_fallback_webhook_url || '',
          ).trim(),
          telegram_gateway_public_base: String(
            (data as Record<string, unknown>).telegram_gateway_public_base || '',
          ).trim(),
          api_key_pool_meta: normalizeApiKeyPoolMeta(
            (data as Record<string, unknown>).api_key_pool_meta,
          ),
          expireddomains_username: String((data as Record<string, unknown>).expireddomains_username || '').trim(),
          expireddomains_password: String((data as Record<string, unknown>).expireddomains_password || ''),
          expireddomains_session_cookie: String((data as Record<string, unknown>).expireddomains_session_cookie || '').trim(),
          expireddomains_api_base: String((data as Record<string, unknown>).expireddomains_api_base || 'https://member.expireddomains.net').trim(),
        })
        const rawRouting = (data as Record<string, unknown>).agent_llm_routing
        if (rawRouting && typeof rawRouting === 'object' && !Array.isArray(rawRouting) && Object.keys(rawRouting).length > 0) {
          setLlmRoutingDraft(JSON.stringify(rawRouting, null, 2))
        } else {
          setLlmRoutingDraft(JSON.stringify(DEFAULT_AGENT_LLM_ROUTING, null, 2))
        }
        await refreshAdminKeyInsights(data.agent_api_key || '')
      }
    } catch (e: any) {
      console.error('Failed to fetch service settings', e)
    }
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        const { data: auth } = await supabase.auth.getUser()
        const user = auth?.user
        if (!user) { setLoading(false); return }
        const { data: profile } = await supabase
          .from('profiles').select('role').eq('id', user.id).single()
        const admin = profile?.role === 'admin'
        setIsAdmin(admin)
        if (admin) await fetchSettings()
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!isAdmin || !settings.agent_api_key) return
    const intervalMs = 30 * 60 * 1000
    const id = window.setInterval(() => {
      void fetchOpenRouterCatalog(settings.agent_api_key)
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [isAdmin, settings.agent_api_key])

  const saveSettings = async (patch: Partial<ServiceSettings>) => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const updated = { ...settings, ...patch, updated_at: new Date().toISOString() }
      const { error } = await supabase
        .from('service_settings')
        .upsert({ id: 1, ...updated })
      if (error) throw error
      setSettings(updated as ServiceSettings)
      await refreshAdminKeyInsights(String((updated as ServiceSettings).agent_api_key || ''))
      setSuccess('Настройки сохранены')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const generateAgentKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const buf = new Uint8Array(40)
    crypto.getRandomValues(buf)
    const body = Array.from(buf, (b) => chars[b % chars.length]).join('')
    setSettings((s) => ({ ...s, agent_api_key: `ak_${body}` }))
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setSuccess('Скопировано в буфер обмена')
      setTimeout(() => setSuccess(null), 2000)
    })
  }

  const registerAutoroTelegramWebhook = async () => {
    const key = String(settings.agent_api_key || '').trim()
    if (!key) {
      setError('Сохраните API key для agent-api выше.')
      return
    }
    setTelegramHookBusy(true)
    setTelegramHookMsg(null)
    setError(null)
    try {
      const resp = await fetch('/api/v1/telegram/webhook/setup/autoro-gateway', {
        method: 'POST',
        headers: { 'X-API-Key': key },
      })
      const body: unknown = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        const d = typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined
        const msg =
          typeof d === 'string'
            ? d
            : Array.isArray(d)
              ? d.map((x) => JSON.stringify(x)).join('; ')
              : JSON.stringify(body)
        setError(msg || `HTTP ${resp.status}`)
        return
      }
      setTelegramHookMsg(JSON.stringify(body, null, 2))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка запроса')
    } finally {
      setTelegramHookBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-700">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading…</span>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-4 text-red-600 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        <span>Access restricted to administrators only.</span>
      </div>
    )
  }

  const maskedKey = (key: string) => key ? key.slice(0, 8) + '•'.repeat(Math.min(key.length - 8, 20)) : ''

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-gray-600" />
          Service settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Global API keys are used by all services. If a specific service defines its own key, it has higher priority.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="p-3 rounded bg-green-50 text-green-700 text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Global API Keys */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-500" />
            Global API keys
          </h2>
          <button
            type="button"
            onClick={() => void verifyAllApiKeys()}
            disabled={verifyingKeys || saving}
            className="text-sm px-3 py-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {verifyingKeys ? 'Проверка ключей…' : 'Проверить все ключи'}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          These keys are used by default. If a specific service (Web Scraping, GoLogin) has its own key, it overrides the global one.
          {' '}
          <a href="#llm-routing" className="text-violet-700 underline">
            LLM routing (round-robin / tier-модели)
          </a>
        </p>
        <p className="text-[11px] text-blue-800 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
          DeerFlow на сервере подхватывает ключи из этой таблицы по расписанию (systemd timer): синхронизация{' '}
          <code className="bg-white px-1 rounded">sync_swoop_models.py</code> (в т.ч. Tavily → SWOOP_TAVILY_KEYS) и обновление контейнеров gateway/langgraph.
          См. каталог <code className="bg-white px-1 rounded">deploy/deer-flow-swoop-sync</code> в репозитории.
          Именованные группы ключей дополнительно пишутся как <code className="bg-white px-1 rounded">SWOOP_API_GROUP_&lt;id&gt;_KEYS</code> (JSON-массив строк).
        </p>

        <ProviderApiKeysPanel
          settings={settings}
          apiKeyPoolMeta={settings.api_key_pool_meta || {}}
          keyHealthByProvider={keyHealthByProvider}
          modelCatalogs={modelCatalogs}
          openrouterMeta={openrouterMeta}
          openrouterCatalogLoading={openrouterCatalogLoading}
          openrouterCatalogError={openrouterCatalogError}
          onRefreshOpenrouterCatalog={() => void refreshOpenRouterCatalog(settings.agent_api_key || '', true)}
          onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          onMetaChange={(api_key_pool_meta) => setSettings((s) => ({ ...s, api_key_pool_meta }))}
          onCopy={copyToClipboard}
        />

        <div id="llm-routing" className="border-2 border-violet-200 rounded-lg p-4 space-y-3 bg-violet-50/60 scroll-mt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">LLM routing — round-robin и tier-модели</h3>
              <p className="text-[11px] text-gray-600 mt-0.5">
                Ротация API-ключей и фиксированные OpenRouter-модели по тирам. Сохраняется вместе с остальными настройками (кнопка Save внизу).
              </p>
            </div>
            <a href="#llm-routing" className="text-[10px] text-violet-700 underline">
              якорь
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Стратегия пула ключей</label>
              <select
                value={String(routingObj.key_pool_strategy || 'fill-first')}
                onChange={(e) =>
                  setLlmRoutingDraft(patchLlmRoutingDraft(llmRoutingDraft, { key_pool_strategy: e.target.value }))
                }
                className="w-full border rounded-md px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="fill-first">fill-first — один ключ до ошибки</option>
                <option value="round-robin">round-robin — ротация на каждый запрос</option>
              </select>
            </div>
            <div className="text-[10px] text-gray-600 flex flex-col justify-end gap-1">
              {openrouterMeta.length > 0 ? (
                <span>
                  OpenRouter: {openrouterMeta.length} моделей
                  {openrouterMeta.filter((m) => m.is_free).length > 0
                    ? ` · ${openrouterMeta.filter((m) => m.is_free).length} free`
                    : ''}
                </span>
              ) : (
                <span className="text-amber-800">Сначала загрузите каталог OpenRouter (кнопка выше у провайдера)</span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">OpenRouter — модель по тиру</p>
            <div className="grid grid-cols-1 gap-3">
              {LLM_TIER_NAMES.map((tier) => {
                const tierModels = (routingObj.tier_models || {}) as Record<string, Record<string, string>>
                const openrouterTier = tierModels.openrouter || {}
                const tierValue = openrouterTier[tier] || ''
                const tierOptions = tierValue && !openrouterModelIds.includes(tierValue)
                  ? [tierValue, ...openrouterModelIds]
                  : openrouterModelIds
                return (
                  <div key={tier} className="space-y-1">
                    <label className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">{tier}</label>
                    <ModelSearchCombobox
                      value={tierValue}
                      onChange={(next) => {
                        const base = parseLlmRoutingDraft(llmRoutingDraft)
                        const allTierModels = {
                          ...(base.tier_models as Record<string, Record<string, string>> | undefined),
                        }
                        const orMap = { ...(allTierModels.openrouter || {}) }
                        if (next) orMap[tier] = next
                        else delete orMap[tier]
                        if (Object.keys(orMap).length) allTierModels.openrouter = orMap
                        else delete allTierModels.openrouter
                        const merged = parseLlmRoutingDraft(llmRoutingDraft)
                        if (Object.keys(allTierModels).length) merged.tier_models = allTierModels
                        else delete merged.tier_models
                        setLlmRoutingDraft(JSON.stringify(merged, null, 2))
                      }}
                      options={tierOptions}
                      metaById={openrouterMetaById}
                      placeholder={`Модель для tier ${tier}…`}
                      loading={openrouterCatalogLoading}
                      loadError={openrouterCatalogError}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-violet-800 font-medium">Расширенный JSON (цепочки провайдеров)</summary>
            <div className="mt-2 space-y-2">
              <textarea
                value={llmRoutingDraft}
                onChange={(e) => setLlmRoutingDraft(e.target.value)}
                spellCheck={false}
                className="w-full min-h-[180px] border rounded-md px-3 py-2 text-xs font-mono bg-white"
              />
              <button
                type="button"
                onClick={() => setLlmRoutingDraft(JSON.stringify(DEFAULT_AGENT_LLM_ROUTING, null, 2))}
                className="text-xs text-violet-700 hover:underline"
              >
                Сбросить к дефолту сервера
              </button>
            </div>
          </details>
        </div>

        <div className="border-t border-gray-100 pt-5 space-y-2">
          <h3 className="text-sm font-semibold text-gray-800">Группы API-ключей</h3>
          <ApiKeyGroupsField
            groups={settings.api_key_groups}
            onChange={(api_key_groups) => setSettings((s) => ({ ...s, api_key_groups }))}
            onCopy={copyToClipboard}
            modelCatalogs={modelCatalogs}
          />
        </div>

        {/* GoLogin API Token */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">GoLogin API Token</label>
          <p className="text-[11px] text-gray-400">Used for GoLogin Cloud Browser and automation scenarios.</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showGologin ? 'text' : 'password'}
                value={settings.gologin_api_token}
                onChange={(e) => setSettings(s => ({ ...s, gologin_api_token: e.target.value }))}
                placeholder="eyJhbGciOi..."
                className="w-full border rounded-md px-3 py-2 text-sm font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setShowGologin(!showGologin)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showGologin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {settings.gologin_api_token && (
              <button onClick={() => copyToClipboard(settings.gologin_api_token)} className="p-2 rounded hover:bg-gray-100" title="Копировать">
                <Copy className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              const firstGemini = settings.gemini_keys[0] || settings.gemini_api_key || ''
              const api_key_groups = settings.api_key_groups.map((g, i) => ({
                id: normalizeApiGroupId(g.id || `group_${i}`),
                name: (g.name || g.id || `group_${i}`).trim(),
                keys: g.keys.map((k) => k.trim()).filter(Boolean),
                provider: String(g.provider || '').trim().toLowerCase(),
                tiers: (g.tiers || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
                models: (g.models || []).map((m) => String(m).trim()).filter(Boolean),
                user_email: String(g.user_email || '').trim(),
                priority: Number(g.priority || 0) || 0,
              }))
              let agent_llm_routing: Record<string, unknown>
              try {
                agent_llm_routing = JSON.parse(llmRoutingDraft) as Record<string, unknown>
                if (!agent_llm_routing || typeof agent_llm_routing !== 'object' || Array.isArray(agent_llm_routing)) {
                  throw new Error('ожидается объект JSON')
                }
              } catch {
                setError('LLM routing: невалидный JSON. Исправьте поле или нажмите «Сбросить к дефолту сервера».')
                return
              }
              saveSettings({
                gemini_keys: settings.gemini_keys,
                groq_keys: settings.groq_keys,
                glm_keys: settings.glm_keys,
                openai_keys: settings.openai_keys,
                openrouter_keys: settings.openrouter_keys,
                openrouter_default_model: settings.openrouter_default_model.trim(),
                openrouter_qwen_keys: settings.openrouter_qwen_keys,
                openrouter_qwen_model: settings.openrouter_qwen_model.trim(),
                lmarena_keys: settings.lmarena_keys,
                lmarena_base_url: settings.lmarena_base_url.trim(),
                lmarena_default_model: settings.lmarena_default_model.trim(),
                brave_keys: settings.brave_keys,
                tavily_keys: settings.tavily_keys,
                api_key_pool_meta: buildApiKeyPoolMetaForSave(
                  settings,
                  settings.api_key_pool_meta || {},
                ),
                api_key_groups,
                gemini_api_key: firstGemini,
                gologin_api_token: settings.gologin_api_token,
                agent_llm_routing,
              })
            }}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save keys
          </button>
        </div>
      </div>

      {/* Agent API Configuration */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Bot className="w-5 h-5 text-violet-500" />
          Scraping Agent — Public API
        </h2>
        <p className="text-xs text-gray-500">
          Public scraping API without user account. You can share it with clients or publish it on marketplaces.
          Authentication is done via API key in the <code className="bg-gray-100 px-1 rounded">X-API-Key</code> header.
        </p>
        <p className="text-xs text-gray-600 border-l-2 border-violet-300 pl-2">
          Один ключ ниже — для всех вызовов agent API (скрейпинг, закладки, LLM-обогащение). Маршрутизация JSON-LLM к
          OpenRouter / GLM / Groq / OpenAI / Gemini задаётся блоком «Bookmarks Bro — маршрутизация LLM» выше; опционально
          клиент может передать <code className="bg-gray-100 px-0.5 rounded">X-LLM-Tier</code> (code | reasoning | fast | general).
          Ответ <code className="bg-gray-100 px-0.5 rounded">/api/v1/bookmarks/ai-recommend</code> добавляет заголовки{' '}
          <code className="bg-gray-100 px-0.5 rounded">X-LLM-Tier</code> и <code className="bg-gray-100 px-0.5 rounded">X-LLM-Route</code>.
        </p>

        {/* Enable/Disable */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.agent_enabled}
            onChange={(e) => {
              const v = e.target.checked
              setSettings(s => ({ ...s, agent_enabled: v }))
              saveSettings({ agent_enabled: v })
            }}
            className="rounded border-gray-300 w-5 h-5 text-violet-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900">Enable Agent API</span>
            <p className="text-[11px] text-gray-400">When disabled, all API requests return 503.</p>
          </div>
        </label>

        {/* Agent API Key */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">API key for clients</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showAgentKey ? 'text' : 'password'}
                value={settings.agent_api_key}
                onChange={(e) => setSettings(s => ({ ...s, agent_api_key: e.target.value }))}
                placeholder="ak_..."
                className="w-full border rounded-md px-3 py-2 text-sm font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setShowAgentKey(!showAgentKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showAgentKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={generateAgentKey} className="inline-flex items-center gap-1 px-3 py-2 rounded-md border text-sm hover:bg-gray-50" title="Сгенерировать ключ">
              <RefreshCw className="w-3.5 h-3.5 text-gray-500" />
              <span className="hidden md:inline text-gray-600">Generate</span>
            </button>
            {settings.agent_api_key && (
              <button onClick={() => copyToClipboard(settings.agent_api_key)} className="p-2 rounded hover:bg-gray-100" title="Копировать">
                <Copy className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>
        </div>

        {/* Rate Limit */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Rate limit (per minute)</label>
          <input
            type="number" min={1} max={1000}
            value={settings.agent_rate_limit}
            onChange={(e) => setSettings(s => ({ ...s, agent_rate_limit: Math.max(1, Math.min(1000, Number(e.target.value))) }))}
            className="w-32 border rounded-md px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-400">Maximum number of requests from one IP per minute.</p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => saveSettings({
              agent_api_key: settings.agent_api_key,
              agent_enabled: settings.agent_enabled,
              agent_rate_limit: settings.agent_rate_limit,
            })}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save agent settings
          </button>
        </div>
      </div>

      {/* Telegram Personal Assistant — Autoro gateway */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Send className="w-5 h-5 text-sky-600" />
          Telegram personal assistant gateway
        </h2>
        <p className="text-xs text-gray-600 leading-relaxed">
          Один webhook бота на <code className="bg-gray-100 px-1 rounded">/api/v1/telegram/autoro-gateway</code>: команды
          ассистента и памяти уходят в n8n (<code className="bg-gray-100 px-1">/research</code>,{' '}
          <code className="bg-gray-100 px-1">/context</code> и др.), остальное — на URL Hermes (fallback). Без этого Hermes
          отвечает «Unknown command». Секрет webhook и <code className="bg-gray-100 px-1">TELEGRAM_BOT_TOKEN</code> по-прежнему
          задаются в окружении agent-api.
        </p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.telegram_gateway_routing_enabled ?? false}
            onChange={(e) => setSettings((s) => ({ ...s, telegram_gateway_routing_enabled: e.target.checked }))}
            className="rounded border-gray-300 w-5 h-5 text-sky-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900">Включить шлюз</span>
            <p className="text-[11px] text-gray-500">
              Если в Docker не задан <code className="bg-gray-50 px-0.5 rounded">TELEGRAM_ASSISTANT_ROUTING_ENABLED</code>, решение
              только отсюда.
            </p>
          </div>
        </label>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">URL вебхука n8n (ассистент / память)</label>
          <input
            type="url"
            value={settings.telegram_n8n_assistant_webhook_url || ''}
            onChange={(e) => setSettings((s) => ({ ...s, telegram_n8n_assistant_webhook_url: e.target.value }))}
            placeholder="https://n8n.example.com/webhook/…/telegram-assistant-memory"
            className="w-full border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">URL Hermes / secondary (fallback)</label>
          <input
            type="url"
            value={settings.telegram_hermes_fallback_webhook_url || ''}
            onChange={(e) => setSettings((s) => ({ ...s, telegram_hermes_fallback_webhook_url: e.target.value }))}
            placeholder="https://… текущий webhook Hermes"
            className="w-full border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Публичный HTTPS origin agent-api</label>
          <p className="text-[11px] text-gray-500">Без пути, для Bot API setWebhook, например https://swoop.autoro.tech</p>
          <input
            type="url"
            value={settings.telegram_gateway_public_base || ''}
            onChange={(e) => setSettings((s) => ({ ...s, telegram_gateway_public_base: e.target.value.trim().replace(/\/+$/, '') }))}
            placeholder="https://swoop.autoro.tech"
            className="w-full border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="flex flex-wrap gap-2 justify-end items-center">
          <button
            type="button"
            onClick={() =>
              saveSettings({
                telegram_gateway_routing_enabled: settings.telegram_gateway_routing_enabled ?? false,
                telegram_n8n_assistant_webhook_url: (settings.telegram_n8n_assistant_webhook_url || '').trim().replace(/\/+$/, ''),
                telegram_hermes_fallback_webhook_url: (settings.telegram_hermes_fallback_webhook_url || '').trim().replace(/\/+$/, ''),
                telegram_gateway_public_base: (settings.telegram_gateway_public_base || '').trim().replace(/\/+$/, ''),
              })
            }
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Сохранить gateway
          </button>
          <button
            type="button"
            onClick={() => void registerAutoroTelegramWebhook()}
            disabled={telegramHookBusy || !settings.agent_api_key?.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-sky-300 text-sky-800 text-sm font-medium hover:bg-sky-50 disabled:opacity-50"
          >
            {telegramHookBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Зарегистрировать webhook в Telegram
          </button>
        </div>
        {telegramHookMsg && (
          <pre className="text-xs font-mono bg-gray-50 border rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{telegramHookMsg}</pre>
        )}
      </div>

      {/* ExpiredDomains.net */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Globe2 className="w-5 h-5 text-orange-600" />
          ExpiredDomains.net
        </h2>
        <p className="text-xs text-gray-600 leading-relaxed">
          Учётные данные member-зоны для модуля{' '}
          <a href="/admin/expired-domains" className="text-orange-700 underline">Expired Domains Hunter</a>.
          Документация разработки:{' '}
          <a href="https://member.expireddomains.net/dev/" target="_blank" rel="noreferrer" className="text-orange-700 underline">
            member.expireddomains.net/dev
          </a>
          . Можно указать session cookie вместо логина/пароля.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Username (email)</label>
            <input
              type="text"
              value={settings.expireddomains_username || ''}
              onChange={(e) => setSettings((s) => ({ ...s, expireddomains_username: e.target.value }))}
              className="w-full border rounded-md px-3 py-2 text-sm"
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <div className="relative">
              <input
                type={showEdPassword ? 'text' : 'password'}
                value={settings.expireddomains_password || ''}
                onChange={(e) => setSettings((s) => ({ ...s, expireddomains_password: e.target.value }))}
                className="w-full border rounded-md px-3 py-2 text-sm pr-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowEdPassword(!showEdPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showEdPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Session cookie (опционально)</label>
          <textarea
            value={settings.expireddomains_session_cookie || ''}
            onChange={(e) => setSettings((s) => ({ ...s, expireddomains_session_cookie: e.target.value }))}
            rows={2}
            placeholder="PHPSESSID=…; remember=…"
            className="w-full border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">API base URL</label>
          <input
            type="url"
            value={settings.expireddomains_api_base || 'https://member.expireddomains.net'}
            onChange={(e) => setSettings((s) => ({ ...s, expireddomains_api_base: e.target.value.trim().replace(/\/+$/, '') }))}
            className="w-full border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              saveSettings({
                expireddomains_username: (settings.expireddomains_username || '').trim(),
                expireddomains_password: settings.expireddomains_password || '',
                expireddomains_session_cookie: (settings.expireddomains_session_cookie || '').trim(),
                expireddomains_api_base: (settings.expireddomains_api_base || 'https://member.expireddomains.net').trim(),
              })
            }
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Сохранить ExpiredDomains
          </button>
        </div>
      </div>

      {/* API Documentation */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ExternalLink className="w-5 h-5 text-gray-500" />
          API Documentation
        </h2>

        <div className="bg-gray-50 rounded-lg p-4 space-y-4 text-sm font-mono">
          <div>
            <div className="text-xs font-sans font-semibold text-gray-700 mb-1.5">Create scraping job</div>
            <div className="text-emerald-700 font-medium">POST /api/v1/scrape</div>
            <pre className="mt-2 text-xs text-gray-600 bg-white border rounded p-3 overflow-x-auto">{`Headers:
  X-API-Key: ${settings.agent_api_key ? maskedKey(settings.agent_api_key) : '<your-api-key>'}
  Content-Type: application/json

Body:
{
  "url": "https://example.com",
  "mode": "fetcher",           // fetcher | stealth | dynamic | gologin
  "output_format": "markdown", // markdown | html | text
  "selector": ".content",      // CSS/XPath (optional)
  "ai_prompt": "Extract...",   // AI extraction (optional)
  "urls": ["url1", "url2"],    // batch mode (optional)
  "crawl_depth": 2,            // crawl mode (optional)
  "max_pages": 20              // crawl mode (optional)
}

Response:
{ "job_id": "uuid", "status": "queued" }`}</pre>
          </div>

          <div>
            <div className="text-xs font-sans font-semibold text-gray-700 mb-1.5">Check job status / get result</div>
            <div className="text-blue-700 font-medium">GET /api/v1/scrape/{'{job_id}'}</div>
            <pre className="mt-2 text-xs text-gray-600 bg-white border rounded p-3 overflow-x-auto">{`Headers:
  X-API-Key: <your-api-key>

Response (in progress):
{ "job_id": "uuid", "status": "running", "progress": {...} }

Response (completed):
{
  "job_id": "uuid",
  "status": "done",
  "result_preview": "...",
  "result_url": "/api/v1/scrape/<id>/download"
}`}</pre>
          </div>

          <div>
            <div className="text-xs font-sans font-semibold text-gray-700 mb-1.5">Download result</div>
            <div className="text-amber-700 font-medium">GET /api/v1/scrape/{'{job_id}'}/download</div>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Base URL: <code className="bg-gray-100 px-1.5 py-0.5 rounded">https://swoop.autoro.tech</code>
        </p>

        {/* Cascade explanation */}
        <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-3">
          <h4 className="text-sm font-medium text-blue-800 mb-1">API keys cascade</h4>
          <p className="text-xs text-blue-700 leading-relaxed">
            <strong>1.</strong> Service-level key (e.g. Web Scraping → GoLogin tab)<br />
            <strong>2.</strong> Global keys on this page<br />
            <strong>3.</strong> Environment variables (Docker env)
          </p>
        </div>
      </div>
    </div>
  )
}
