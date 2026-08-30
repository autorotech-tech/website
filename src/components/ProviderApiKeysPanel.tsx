import { useMemo, useRef, useState } from 'react'
import { Copy, X } from 'lucide-react'
import {
  ModelSearchCombobox,
  buildOpenRouterMetaMap,
  type OpenRouterModelMeta,
} from './ModelSearchCombobox'

export type { OpenRouterModelMeta }

export type OpenModelAdminStatus = {
  configured?: boolean
  api_base?: string
  balance_ok?: boolean
  balance?: {
    balance_usd?: number | null
    frozen_usd?: number | null
    available_usd?: number | null
    currency?: string
    email?: string | null
  } | null
  balance_error?: string | null
  balance_requires_console?: boolean
  balance_error_code?: string | null
  models_total?: number
  model_ids?: string[]
  updated_at?: string
}

export type SerpApiAdminStatus = {
  configured?: boolean
  default_engine?: string
  engines?: string[]
  account_ok?: boolean
  account?: {
    plan_name?: string | null
    plan_id?: string | null
    account_status?: string | null
    account_email?: string | null
    searches_per_month?: number | null
    plan_searches_left?: number | null
    total_searches_left?: number | null
    this_month_usage?: number | null
    plan_renewal_date?: string | null
  } | null
  account_error?: string | null
  updated_at?: string
}

export type ApifyAdminStatus = {
  configured?: boolean
  configured_user_id?: string | null
  account_ok?: boolean
  account?: {
    userId?: string | null
    username?: string | null
    email?: string | null
    plan?: string | null
    maxMemoryMbytes?: number | null
    maxConcurrentActorRuns?: number | null
    currentActorMemoryMbytes?: number | null
    currentConcurrentActorRuns?: number | null
  } | null
  account_error?: string | null
  keys_count?: number
  updated_at?: string
}

export type ScrapingBeeAdminStatus = {
  configured?: boolean
  usage_ok?: boolean
  usage?: {
    used_api_credit?: number | null
    max_api_credit?: number | null
    remaining_credits?: number | null
    renewal_cost?: number | null
  } | null
  usage_error?: string | null
  keys_count?: number
  updated_at?: string
}

export type ApiKeyPoolMetaEntry = { enabled?: boolean }
export type ApiKeyPoolMeta = Record<string, ApiKeyPoolMetaEntry[]>

type KeyHealthEntry = {
  status: 'active' | 'inactive' | 'unknown'
  reason?: string
  until?: string
}

export type ProviderCatalogs = Record<string, string[]>

export type ProviderKeyConfig = {
  id: string
  label: string
  shortLabel: string
  category: 'llm' | 'search' | 'parsing'
  description: string
  keysField: keyof ProviderKeysState
  healthKey: string
  newKeyPlaceholder: string
  catalogKey?: string
  modelField?: keyof ProviderKeysState
  modelLabel?: string
  modelPlaceholder?: string
  modelHint?: string
  extraFields?: Array<{
    field: keyof ProviderKeysState
    label: string
    placeholder: string
    hint?: string
  }>
}

export type ProviderKeysState = {
  gemini_keys: string[]
  groq_keys: string[]
  glm_keys: string[]
  openai_keys: string[]
  openrouter_keys: string[]
  openrouter_default_model: string
  openrouter_qwen_keys: string[]
  openrouter_qwen_model: string
  lmarena_keys: string[]
  lmarena_base_url: string
  lmarena_default_model: string
  mimo_keys: string[]
  mimo_base_url: string
  mimo_default_model: string
  /** API keys для [Kimi (Moonshot)](https://platform.kimi.ai/docs/api/overview). */
  kimi_keys: string[]
  kimi_base_url: string
  kimi_default_model: string
  /** API keys для [SeekAI (seekai.cc / seekapi.ai)](https://seekai.cc). */
  seekai_keys: string[]
  seekai_base_url: string
  seekai_default_model: string
  openmodel_keys: string[]
  openmodel_base_url: string
  openmodel_default_model: string
  brave_keys: string[]
  tavily_keys: string[]
  serpapi_keys: string[]
  serpapi_default_engine: string
  google_cse_keys: string[]
  google_cse_cx: string
  bing_webmaster_keys: string[]
  bing_webmaster_site_url: string
  apify_keys: string[]
  apify_user_id: string
  apify_default_actor: string
  brightdata_keys: string[]
  brightdata_zone: string
  brightdata_base_url: string
  omkar_keys: string[]
  omkar_base_url: string
  scrapingbee_keys: string[]
}

const MODEL_PRESETS: Record<string, string[]> = {
  openrouter: [
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'google/gemini-2.5-pro',
    'google/gemini-2.0-flash-001',
  ],
  openrouter_qwen: [
    'qwen/qwen3.6-plus-preview:free',
    'qwen/qwen-2.5-72b-instruct',
    'qwen/qwq-32b-preview',
  ],
  lmarena: ['default'],
  mimo: ['mimo-v2.5-pro', 'mimo-v2.5-flash'],
  kimi: ['kimi-k2-turbo-preview', 'kimi-k2-0711-preview', 'moonshot-v1-8k'],
  seekai: ['deepseek-chat', 'deepseek-reasoner', 'claude-3-7-sonnet', 'gpt-4o', 'gemini-2.5-pro'],
  openmodel: ['deepseek-v4-flash', 'claude-sonnet-4-6', 'gpt-5.4', 'gemini-3.5-flash'],
  serpapi: ['google', 'bing', 'duckduckgo', 'google_maps', 'google_trends', 'youtube', 'google_short_videos'],
}

export const PROVIDER_CATEGORIES = [
  { id: 'llm' as const, label: 'LLM / Chat' },
  { id: 'search' as const, label: 'Поиск' },
  { id: 'parsing' as const, label: 'Парсинг' },
]

export const PROVIDER_KEY_CONFIGS: ProviderKeyConfig[] = [
  {
    id: 'gemini_keys',
    label: 'Gemini',
    shortLabel: 'Gemini',
    category: 'llm',
    description: 'Порядок важен: при ошибке одного ключа берётся следующий (ротация в воркерах и DeerFlow).',
    keysField: 'gemini_keys',
    healthKey: 'gemini_keys',
    newKeyPlaceholder: 'Новый ключ Gemini',
    catalogKey: 'gemini',
    modelHint: 'Модель по умолчанию задаётся в «Bookmarks Bro — маршрутизация LLM» (шаг provider: gemini).',
  },
  {
    id: 'groq_keys',
    label: 'Groq',
    shortLabel: 'Groq',
    category: 'llm',
    description: 'Используются воркерами и DeerFlow; ротация по списку.',
    keysField: 'groq_keys',
    healthKey: 'groq_keys',
    newKeyPlaceholder: 'Новый ключ Groq',
    catalogKey: 'groq',
    modelHint: 'Модель задаётся в routing (provider: groq) или в запросе.',
  },
  {
    id: 'glm_keys',
    label: 'GLM (BigModel)',
    shortLabel: 'GLM',
    category: 'llm',
    description: 'Один ключ на строку при массовой вставке; дубликаты пропускаются.',
    keysField: 'glm_keys',
    healthKey: 'glm_keys',
    newKeyPlaceholder: 'Новый ключ GLM',
    catalogKey: 'glm',
    modelHint: 'Пример модели: glm-5.1 — в routing (provider: glm) или env.',
  },
  {
    id: 'openai_keys',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    category: 'llm',
    description: 'Ключи OpenAI API для совместимых сервисов и DeerFlow.',
    keysField: 'openai_keys',
    healthKey: 'openai_keys',
    newKeyPlaceholder: 'Новый ключ OpenAI',
    catalogKey: 'openai',
    modelHint: 'Модель задаётся в routing (provider: openai).',
  },
  {
    id: 'openrouter_keys',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    category: 'llm',
    description: 'Доступ к моделям через OpenRouter; несколько ключей — для ротации и лимитов.',
    keysField: 'openrouter_keys',
    healthKey: 'openrouter_keys',
    newKeyPlaceholder: 'Новый ключ OpenRouter',
    catalogKey: 'openrouter',
    modelField: 'openrouter_default_model',
    modelLabel: 'Модель по умолчанию',
    modelPlaceholder: 'google/gemini-2.5-flash',
    modelHint: 'Полный slug provider/model для сервисов без явной модели.',
  },
  {
    id: 'openrouter_qwen_keys',
    label: 'OpenRouter Qwen',
    shortLabel: 'OR Qwen',
    category: 'llm',
    description: 'Отдельный пул для DeerFlow Qwen. Если пусто — используется общий OpenRouter пул.',
    keysField: 'openrouter_qwen_keys',
    healthKey: 'openrouter_qwen_keys',
    newKeyPlaceholder: 'Новый ключ OpenRouter (Qwen)',
    catalogKey: 'openrouter_qwen',
    modelField: 'openrouter_qwen_model',
    modelLabel: 'Модель Qwen',
    modelPlaceholder: 'qwen/qwen3.6-plus-preview:free',
  },
  {
    id: 'lmarena_keys',
    label: 'LMArena Bridge',
    shortLabel: 'LMArena',
    category: 'llm',
    description:
      'Ключи из dashboard LMArenaBridge. Модель в запросе: lmarena/<slug> или шаг routing provider lmarena.',
    keysField: 'lmarena_keys',
    healthKey: 'lmarena_keys',
    newKeyPlaceholder: 'Ключ из LMArenaBridge dashboard',
    catalogKey: 'lmarena',
    modelField: 'lmarena_default_model',
    modelLabel: 'Модель по умолчанию',
    modelPlaceholder: 'default',
    extraFields: [
      {
        field: 'lmarena_base_url',
        label: 'API base URL',
        placeholder: 'http://127.0.0.1:8000/api/v1',
        hint: 'Без завершающего слэша. Пусто — env BOOKMARKS_LMARENA_API_BASE.',
      },
    ],
  },
  {
    id: 'mimo_keys',
    label: 'Xiaomi MiMo',
    shortLabel: 'MiMo',
    category: 'llm',
    description:
      'Ключи Xiaomi MiMo API (sk-… pay-as-you-go или tp-… Token Plan). Модель в запросе: mimo/<slug> или routing provider mimo.',
    keysField: 'mimo_keys',
    healthKey: 'mimo_keys',
    newKeyPlaceholder: 'sk-… или tp-… из platform.xiaomimimo.com',
    catalogKey: 'mimo',
    modelField: 'mimo_default_model',
    modelLabel: 'Модель по умолчанию',
    modelPlaceholder: 'mimo-v2.5-pro',
    modelHint: 'Документация: mimo.mi.com. V2 series deprecated — используйте V2.5.',
    extraFields: [
      {
        field: 'mimo_base_url',
        label: 'API base URL',
        placeholder: 'https://api.xiaomimimo.com/v1',
        hint: 'Pay-as-you-go: https://api.xiaomimimo.com/v1 · Token Plan: https://token-plan-cn.xiaomimimo.com/v1 · Пусто — env BOOKMARKS_MIMO_API_BASE.',
      },
    ],
  },
  {
    id: 'kimi_keys',
    label: 'Kimi (Moonshot)',
    shortLabel: 'Kimi',
    category: 'llm',
    description:
      'Kimi Open Platform — OpenAI-compatible API. Модель в запросе: kimi/<slug> или routing provider kimi.',
    keysField: 'kimi_keys',
    healthKey: 'kimi_keys',
    newKeyPlaceholder: 'Ключ из platform.kimi.ai/console/api-keys',
    catalogKey: 'kimi',
    modelField: 'kimi_default_model',
    modelLabel: 'Модель по умолчанию',
    modelPlaceholder: 'kimi-k2-turbo-preview',
    modelHint: 'Bearer auth. Список моделей подтягивается из GET /v1/models.',
    extraFields: [
      {
        field: 'kimi_base_url',
        label: 'API base URL',
        placeholder: 'https://api.moonshot.ai/v1',
        hint: 'Пусто — env BOOKMARKS_KIMI_API_BASE (по умолчанию https://api.moonshot.ai/v1).',
      },
    ],
  },
  {
    id: 'seekai_keys',
    label: 'SeekAI',
    shortLabel: 'SeekAI',
    category: 'llm',
    description:
      'SeekAI (seekai.cc / seekapi.ai) — OpenAI-compatible API gateway. Модель в запросе: seekai/<slug> или routing provider seekai.',
    keysField: 'seekai_keys',
    healthKey: 'seekai_keys',
    newKeyPlaceholder: 'Ключ из seekai.cc / seekapi.ai console',
    catalogKey: 'seekai',
    modelField: 'seekai_default_model',
    modelLabel: 'Модель по умолчанию',
    modelPlaceholder: 'deepseek-chat',
    modelHint: 'Bearer auth. Модели подтягиваются из GET /v1/models (deepseek-chat, deepseek-reasoner, claude-3-7-sonnet и др.).',
    extraFields: [
      {
        field: 'seekai_base_url',
        label: 'API base URL',
        placeholder: 'https://api.seekapi.ai/v1',
        hint: 'Пусто — env BOOKMARKS_SEEKAI_API_BASE (по умолчанию https://api.seekapi.ai/v1).',
      },
    ],
  },
  {
    id: 'openmodel_keys',
    label: 'OpenModel',
    shortLabel: 'OpenModel',
    category: 'llm',
    description:
      'Multi-model gateway (OpenAI / Anthropic / Gemini / DeepSeek через один API). Ключ om-… из console.openmodel.ai. Модель: openmodel/<slug> или routing provider openmodel.',
    keysField: 'openmodel_keys',
    healthKey: 'openmodel_keys',
    newKeyPlaceholder: 'om-… из console.openmodel.ai → API Keys',
    catalogKey: 'openmodel',
    modelField: 'openmodel_default_model',
    modelLabel: 'Модель по умолчанию',
    modelPlaceholder: 'deepseek-v4-flash',
    modelHint:
      'Список из GET /v1/models. Chat — POST /v1/messages (Anthropic format). Документация: docs.openmodel.ai.',
    extraFields: [
      {
        field: 'openmodel_base_url',
        label: 'API base URL',
        placeholder: 'https://api.openmodel.ai',
        hint: 'Пусто — env BOOKMARKS_OPENMODEL_API_BASE (по умолчанию https://api.openmodel.ai).',
      },
    ],
  },
  {
    id: 'brave_keys',
    label: 'Brave Search',
    shortLabel: 'Brave',
    category: 'search',
    description: 'Поисковые API; несколько ключей для распределения квот.',
    keysField: 'brave_keys',
    healthKey: 'brave_keys',
    newKeyPlaceholder: 'Новый ключ Brave',
  },
  {
    id: 'tavily_keys',
    label: 'Tavily',
    shortLabel: 'Tavily',
    category: 'search',
    description:
      'Веб-поиск в DeerFlow. При ошибке ключа используется следующий; если все недоступны — Brave.',
    keysField: 'tavily_keys',
    healthKey: 'tavily_keys',
    newKeyPlaceholder: 'tvly-...',
  },
  {
    id: 'serpapi_keys',
    label: 'SerpApi',
    shortLabel: 'SerpApi',
    category: 'search',
    description:
      'Multi-engine SERP (Google, Bing, DuckDuckGo и др.). Free plan — 250 searches/month. Ключ из serpapi.com/manage-api-key.',
    keysField: 'serpapi_keys',
    healthKey: 'serpapi_keys',
    newKeyPlaceholder: 'SerpApi private key',
    catalogKey: 'serpapi',
    modelField: 'serpapi_default_engine',
    modelLabel: 'Engine по умолчанию',
    modelPlaceholder: 'google',
    modelHint: 'Presets или свой engine slug (см. serpapi.com/search-engine-apis). Проверка ключа — account.json (бесплатно).',
  },
  {
    id: 'google_cse_keys',
    label: 'Google Custom Search',
    shortLabel: 'Google CSE',
    category: 'search',
    description:
      'Custom Search JSON API (не OAuth-клиент для входа). Нужны API key из GCP Credentials и cx из Programmable Search Engine. 100 запросов/день бесплатно у существующих клиентов; API закрыт для новых и снимается 1 янв 2027.',
    keysField: 'google_cse_keys',
    healthKey: 'google_cse_keys',
    newKeyPlaceholder: 'AIza… ключ Custom Search API',
    extraFields: [
      {
        field: 'google_cse_cx',
        label: 'Search engine ID (cx)',
        placeholder: 'xxxxxxxxxxxxxxxxx:yyyyyyyyyyy',
        hint: 'programmablesearchengine.google.com → ваш движок → Search engine ID. Без cx проверка вернёт google_cse_cx_not_configured.',
      },
    ],
  },
  {
    id: 'bing_webmaster_keys',
    label: 'Bing Webmaster',
    shortLabel: 'Bing WM',
    category: 'search',
    description:
      'JSON API Bing Webmaster Tools (GetUserSites, GetQueryStats, SubmitUrl). Ключ из Bing Webmaster → Settings → API Access. SOAP/POX снимаются 31 авг 2026; JSON + apikey остаются.',
    keysField: 'bing_webmaster_keys',
    healthKey: 'bing_webmaster_keys',
    newKeyPlaceholder: 'Bing Webmaster API key',
    extraFields: [
      {
        field: 'bing_webmaster_site_url',
        label: 'Verified site URL',
        placeholder: 'https://autoro.tech',
        hint: 'Сайт должен быть verified в Bing Webmaster Tools. Без trailing slash.',
      },
    ],
  },
  {
    id: 'apify_keys',
    label: 'Apify',
    shortLabel: 'Apify',
    category: 'parsing',
    description:
      'Пул ключей Apify для Google Maps, Booking, Trip.com (pquoc.com) и crawler news. Ротация по лимитам и памяти (1024MB); проверка — GET /v2/users/me.',
    keysField: 'apify_keys',
    healthKey: 'apify_keys',
    newKeyPlaceholder: 'apify_api_…',
    modelField: 'apify_default_actor',
    modelLabel: 'Actor по умолчанию',
    modelPlaceholder: 'compass/crawler-google-places',
    modelHint: 'Slug actor для Best Places / hotels pipeline или news crawler.',
    extraFields: [
      {
        field: 'apify_user_id',
        label: 'User ID (опционально)',
        placeholder: 'w64... или username',
        hint: 'ID пользователя Apify из Account Settings (заполняется автоматически при verify).',
      },
    ],
  },
  {
    id: 'brightdata_keys',
    label: 'Bright Data',
    shortLabel: 'Bright Data',
    category: 'parsing',
    description:
      'Web Unlocker + Datasets API (Google Hotels, Booking, Trip.com). Нужны ключ и zone из dashboard Bright Data.',
    keysField: 'brightdata_keys',
    healthKey: 'brightdata_keys',
    newKeyPlaceholder: 'Bright Data API token',
    extraFields: [
      {
        field: 'brightdata_zone',
        label: 'Web Unlocker zone',
        placeholder: 'web_unlocker1',
        hint: 'Имя zone из Bright Data → Proxies & Scraping. Без zone verify вернёт brightdata_zone_not_configured.',
      },
      {
        field: 'brightdata_base_url',
        label: 'API base URL',
        placeholder: 'https://api.brightdata.com',
        hint: 'Пусто — https://api.brightdata.com',
      },
    ],
  },
  {
    id: 'omkar_keys',
    label: 'Omkar.cloud (Tripadvisor)',
    shortLabel: 'Omkar',
    category: 'parsing',
    description:
      'REST Tripadvisor scraper (autorotech-tech/tripadvisor-scraper). Header API-Key; verify — hotels/list ping.',
    keysField: 'omkar_keys',
    healthKey: 'omkar_keys',
    newKeyPlaceholder: 'ok_… из omkar.cloud',
    extraFields: [
      {
        field: 'omkar_base_url',
        label: 'List endpoint URL',
        placeholder: 'https://tripadvisor-scraper-api.omkar.cloud/tripadvisor/hotels/list',
        hint: 'Пусто — дефолтный list endpoint omkar.cloud.',
      },
    ],
  },
  {
    id: 'scrapingbee_keys',
    label: 'ScrapingBee',
    shortLabel: 'ScrapingBee',
    category: 'parsing',
    description:
      'HTML/JS render API для Booking snippets и fallback chain pquoc.com. Проверка — GET /api/v1/usage.',
    keysField: 'scrapingbee_keys',
    healthKey: 'scrapingbee_keys',
    newKeyPlaceholder: 'Ключ из app.scrapingbee.com',
  },
]

function maskKey(key: string) {
  return key ? key.slice(0, 8) + '•'.repeat(Math.min(Math.max(key.length - 8, 0), 20)) : ''
}

function summarizeProvider(
  keys: string[],
  metaEntries: ApiKeyPoolMetaEntry[],
  keyHealth: KeyHealthEntry[],
) {
  let active = 0
  let inactive = 0
  let unknown = 0
  let disabled = 0
  keys.forEach((_, idx) => {
    if (metaEntries[idx]?.enabled === false) {
      disabled += 1
      return
    }
    const status = keyHealth[idx]?.status
    if (status === 'active') active += 1
    else if (status === 'inactive') inactive += 1
    else unknown += 1
  })
  return { active, inactive, unknown, disabled, total: keys.length }
}

function healthStatusLabel(health?: KeyHealthEntry) {
  const reason = (health?.reason || '').toLowerCase()
  if (reason.includes('proxy_blocked') || reason.includes('cloudflare') || reason.includes('1010')) {
    return 'proxy'
  }
  if (health?.status === 'active') return 'ok'
  if (health?.status === 'inactive') return 'fail'
  return '?'
}

function healthDotClassExtended(health?: KeyHealthEntry) {
  const label = healthStatusLabel(health)
  if (label === 'ok') return 'bg-emerald-500'
  if (label === 'proxy') return 'bg-amber-500'
  if (label === 'fail') return 'bg-rose-500'
  return 'bg-gray-300'
}

function buildModelOptions(catalogKey: string | undefined, catalogs: ProviderCatalogs, current: string) {
  const live = catalogKey ? catalogs[catalogKey] || [] : []
  const skipPresets = catalogKey === 'openrouter' || catalogKey === 'openrouter_qwen'
  const presets = catalogKey && !skipPresets ? MODEL_PRESETS[catalogKey] || [] : []
  const merged = [...live, ...presets]
  const options: string[] = []
  const seen = new Set<string>()
  for (const m of merged) {
    const v = String(m || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    options.push(v)
  }
  const cur = String(current || '').trim()
  if (cur && !seen.has(cur)) options.unshift(cur)
  return options
}

export function normalizeApiKeyPoolMeta(raw: unknown): ApiKeyPoolMeta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ApiKeyPoolMeta = {}
  for (const [field, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue
    out[field] = entries.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>
        return { enabled: rec.enabled !== false }
      }
      return { enabled: true }
    })
  }
  return out
}

export function syncMetaForKeys(field: string, keys: string[], meta: ApiKeyPoolMeta): ApiKeyPoolMeta {
  const prev = meta[field] || []
  const next = keys.map((_, i) => ({ enabled: prev[i]?.enabled !== false }))
  return { ...meta, [field]: next }
}

export function buildApiKeyPoolMetaForSave(
  state: ProviderKeysState,
  meta: ApiKeyPoolMeta,
): ApiKeyPoolMeta {
  const out: ApiKeyPoolMeta = { ...meta }
  for (const cfg of PROVIDER_KEY_CONFIGS) {
    const keys = state[cfg.keysField] as string[]
    out[cfg.id] = syncMetaForKeys(cfg.id, keys, out)[cfg.id]
  }
  return out
}

type ProviderApiKeysPanelProps = {
  settings: ProviderKeysState
  apiKeyPoolMeta: ApiKeyPoolMeta
  keyHealthByProvider: Record<string, KeyHealthEntry[]>
  modelCatalogs?: ProviderCatalogs
  openrouterMeta?: OpenRouterModelMeta[]
  openrouterCatalogLoading?: boolean
  openrouterCatalogError?: string | null
  onRefreshOpenrouterCatalog?: () => void
  openmodelStatus?: OpenModelAdminStatus | null
  openmodelStatusLoading?: boolean
  openmodelStatusError?: string | null
  onRefreshOpenmodelStatus?: () => void
  serpapiStatus?: SerpApiAdminStatus | null
  serpapiStatusLoading?: boolean
  serpapiStatusError?: string | null
  onRefreshSerpapiStatus?: () => void
  apifyStatus?: ApifyAdminStatus | null
  apifyStatusLoading?: boolean
  apifyStatusError?: string | null
  onRefreshApifyStatus?: () => void
  onSettingsChange: (patch: Partial<ProviderKeysState>) => void
  onMetaChange: (meta: ApiKeyPoolMeta) => void
  onCopy?: (text: string) => void
}

function ProviderSummaryPill({
  summary,
}: {
  summary: ReturnType<typeof summarizeProvider>
}) {
  if (summary.total === 0) {
    return <span className="text-[10px] text-gray-400">нет ключей</span>
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-600">
      {summary.active > 0 && (
        <span className="inline-flex items-center gap-0.5 text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {summary.active}
        </span>
      )}
      {summary.inactive > 0 && (
        <span className="inline-flex items-center gap-0.5 text-rose-700">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {summary.inactive}
        </span>
      )}
      {summary.unknown > 0 && (
        <span className="inline-flex items-center gap-0.5 text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
          {summary.unknown}
        </span>
      )}
      {summary.disabled > 0 && (
        <span className="text-gray-400">· off {summary.disabled}</span>
      )}
    </span>
  )
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export function ProviderApiKeysPanel({
  settings,
  apiKeyPoolMeta,
  keyHealthByProvider,
  modelCatalogs = {},
  openrouterMeta = [],
  openrouterCatalogLoading = false,
  openrouterCatalogError = null,
  onRefreshOpenrouterCatalog,
  openmodelStatus = null,
  openmodelStatusLoading = false,
  openmodelStatusError = null,
  onRefreshOpenmodelStatus,
  serpapiStatus = null,
  serpapiStatusLoading = false,
  serpapiStatusError = null,
  onRefreshSerpapiStatus,
  apifyStatus = null,
  apifyStatusLoading = false,
  apifyStatusError = null,
  onRefreshApifyStatus,
  onSettingsChange,
  onMetaChange,
  onCopy,
}: ProviderApiKeysPanelProps) {
  const [selectedId, setSelectedId] = useState(PROVIDER_KEY_CONFIGS[0]?.id ?? 'gemini_keys')
  const inputRef = useRef<HTMLInputElement>(null)
  const bulkRef = useRef<HTMLTextAreaElement>(null)

  const config = useMemo(
    () => PROVIDER_KEY_CONFIGS.find((c) => c.id === selectedId) ?? PROVIDER_KEY_CONFIGS[0],
    [selectedId],
  )

  const keys = (settings[config.keysField] as string[]) || []
  const metaEntries = apiKeyPoolMeta[config.id] || []
  const keyHealth = keyHealthByProvider[config.healthKey] || []
  const summary = summarizeProvider(keys, metaEntries, keyHealth)

  const modelOptions = useMemo(() => {
    if (!config.modelField) return []
    const current = String(settings[config.modelField] ?? '')
    return buildModelOptions(config.catalogKey, modelCatalogs, current)
  }, [config.catalogKey, config.modelField, modelCatalogs, settings])

  const openrouterMetaById = useMemo(() => buildOpenRouterMetaMap(openrouterMeta), [openrouterMeta])

  const isOpenRouterPicker =
    config.catalogKey === 'openrouter' || config.catalogKey === 'openrouter_qwen'

  const openrouterPickerOptions = useMemo(() => {
    if (!isOpenRouterPicker || !config.modelField) return []
    const current = String(settings[config.modelField] ?? '')
    const fromMeta = openrouterMeta.map((m) => m.id).filter(Boolean)
    if (fromMeta.length) {
      const seen = new Set<string>()
      const out: string[] = []
      if (current) {
        seen.add(current)
        out.push(current)
      }
      for (const id of fromMeta) {
        if (!seen.has(id)) {
          seen.add(id)
          out.push(id)
        }
      }
      return out
    }
    return current ? [current] : []
  }, [config.modelField, isOpenRouterPicker, openrouterMeta, settings])

  const setKeys = (nextKeys: string[]) => {
    onSettingsChange({ [config.keysField]: nextKeys } as Partial<ProviderKeysState>)
    onMetaChange(syncMetaForKeys(config.id, nextKeys, apiKeyPoolMeta))
  }

  const setEnabled = (idx: number, enabled: boolean) => {
    const next = [...(apiKeyPoolMeta[config.id] || [])]
    while (next.length < keys.length) next.push({ enabled: true })
    next[idx] = { ...next[idx], enabled }
    onMetaChange({ ...apiKeyPoolMeta, [config.id]: next.slice(0, keys.length) })
  }

  const addSingle = () => {
    const value = inputRef.current?.value.trim() ?? ''
    if (!value) return
    setKeys([...keys, value])
    if (inputRef.current) inputRef.current.value = ''
  }

  const addBulk = () => {
    const raw = bulkRef.current?.value ?? ''
    const parsed = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parsed.length) return
    const next = [...keys]
    const set = new Set(next)
    for (const k of parsed) {
      if (!set.has(k)) {
        set.add(k)
        next.push(k)
      }
    }
    setKeys(next)
    if (bulkRef.current) bulkRef.current.value = ''
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80">
        <p className="text-[11px] text-amber-800">
          Снятие галочки исключает ключ из ротации. Цветные точки — результат проверки API (health).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <aside className="border-b lg:border-b-0 lg:border-r border-gray-100 p-3 space-y-4 bg-gray-50/40">
          {PROVIDER_CATEGORIES.map((cat) => {
            const items = PROVIDER_KEY_CONFIGS.filter((c) => c.category === cat.id)
            if (!items.length) return null
            return (
              <div key={cat.id} className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 px-1">
                  {cat.label}
                </p>
                <div className="space-y-1">
                  {items.map((c) => {
                    const cKeys = (settings[c.keysField] as string[]) || []
                    const cMeta = apiKeyPoolMeta[c.id] || []
                    const cHealth = keyHealthByProvider[c.healthKey] || []
                    const cSummary = summarizeProvider(cKeys, cMeta, cHealth)
                    const selected = c.id === selectedId
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={`w-full text-left rounded-md border px-2.5 py-2 transition-colors ${
                          selected
                            ? 'border-amber-300 bg-amber-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-800 truncate">{c.shortLabel}</span>
                          <span className="text-[10px] text-gray-500 shrink-0">{cKeys.length}</span>
                        </div>
                        <div className="mt-1">
                          <ProviderSummaryPill summary={cSummary} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </aside>

        <div className="p-4 space-y-3 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{config.label}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">{config.description}</p>
            </div>
            <div className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1">
              {summary.total} ключ(ей) · ok {summary.active} · fail {summary.inactive}
              {summary.disabled > 0 ? ` · off ${summary.disabled}` : ''}
            </div>
          </div>

          {config.id === 'openmodel_keys' && (
            <div className="rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-sky-900">Account balance</p>
                  <p className="text-[10px] text-sky-700">
                    <a
                      href="https://console.openmodel.ai/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-sky-900"
                    >
                      console.openmodel.ai
                    </a>
                    {openmodelStatus?.api_base ? (
                      <>
                        {' '}
                        · API{' '}
                        <span className="font-mono">{openmodelStatus.api_base}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                {onRefreshOpenmodelStatus ? (
                  <button
                    type="button"
                    onClick={() => onRefreshOpenmodelStatus()}
                    disabled={openmodelStatusLoading}
                    className="text-[10px] px-2 py-0.5 rounded border border-sky-300 bg-white hover:bg-sky-50 disabled:opacity-50"
                  >
                    {openmodelStatusLoading ? 'Загрузка…' : 'Обновить баланс и модели'}
                  </button>
                ) : null}
              </div>
              {openmodelStatusError ? (
                <p className="text-[10px] text-rose-700">{openmodelStatusError}</p>
              ) : openmodelStatusLoading && !openmodelStatus ? (
                <p className="text-[10px] text-sky-700">Загружаем баланс и каталог моделей…</p>
              ) : !openmodelStatus?.configured && keys.length === 0 ? (
                <p className="text-[10px] text-sky-700">Добавьте ключ om-… и сохраните настройки.</p>
              ) : openmodelStatus?.balance_ok && openmodelStatus.balance ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-sky-950">
                  <span>
                    <span className="text-[10px] uppercase tracking-wide text-sky-700">Balance</span>{' '}
                    <span className="font-semibold tabular-nums">
                      {formatUsd(openmodelStatus.balance.balance_usd)}
                    </span>{' '}
                    {openmodelStatus.balance.currency || 'USD'}
                  </span>
                  {openmodelStatus.balance.available_usd != null ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-sky-700">Available</span>{' '}
                      <span className="font-medium tabular-nums">
                        {formatUsd(openmodelStatus.balance.available_usd)}
                      </span>
                    </span>
                  ) : null}
                  {openmodelStatus.balance.frozen_usd != null && openmodelStatus.balance.frozen_usd > 0 ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-sky-700">Frozen</span>{' '}
                      <span className="font-medium tabular-nums">
                        {formatUsd(openmodelStatus.balance.frozen_usd)}
                      </span>
                    </span>
                  ) : null}
                  {openmodelStatus.models_total != null ? (
                    <span className="text-[10px] text-sky-700">
                      Моделей в каталоге: {openmodelStatus.models_total}
                    </span>
                  ) : null}
                </div>
              ) : openmodelStatus?.balance_requires_console ? (
                <p className="text-[10px] text-amber-800">
                  Баланс аккаунта смотрите в{' '}
                  <a
                    href="https://console.openmodel.ai/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-950"
                  >
                    console.openmodel.ai
                  </a>
                  . API <span className="font-mono">/web/v1/self</span> принимает console access token (JWT после
                  входа), а не ключ <span className="font-mono">om-…</span>. Ключ om-… работает для inference и
                  каталога моделей
                  {openmodelStatus.models_total != null ? ` (${openmodelStatus.models_total})` : ''}.
                </p>
              ) : openmodelStatus?.balance_error ? (
                <p className="text-[10px] text-amber-800">
                  Баланс недоступен: {openmodelStatus.balance_error}. Каталог моделей может загрузиться отдельно.
                </p>
              ) : (
                <p className="text-[10px] text-sky-700">
                  Сохраните ключ и нажмите «Обновить баланс и модели».
                </p>
              )}
            </div>
          )}

          {config.id === 'serpapi_keys' && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-emerald-900">Account status</p>
                  <p className="text-[10px] text-emerald-700">
                    <a
                      href="https://serpapi.com/manage-api-key"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-emerald-900"
                    >
                      serpapi.com/manage-api-key
                    </a>
                    {' · '}
                    <a
                      href="https://serpapi.com/search-engine-apis"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-emerald-900"
                    >
                      engines
                    </a>
                  </p>
                </div>
                {onRefreshSerpapiStatus ? (
                  <button
                    type="button"
                    onClick={() => onRefreshSerpapiStatus()}
                    disabled={serpapiStatusLoading}
                    className="text-[10px] px-2 py-0.5 rounded border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {serpapiStatusLoading ? 'Загрузка…' : 'Обновить account.json'}
                  </button>
                ) : null}
              </div>
              {serpapiStatusError ? (
                <p className="text-[10px] text-rose-700">{serpapiStatusError}</p>
              ) : serpapiStatusLoading && !serpapiStatus ? (
                <p className="text-[10px] text-emerald-700">Загружаем account.json…</p>
              ) : !serpapiStatus?.configured && keys.length === 0 ? (
                <p className="text-[10px] text-emerald-700">Добавьте SerpApi key и сохраните настройки.</p>
              ) : serpapiStatus?.account_ok && serpapiStatus.account ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-950">
                  <span>
                    <span className="text-[10px] uppercase tracking-wide text-emerald-700">Plan</span>{' '}
                    <span className="font-semibold">{serpapiStatus.account.plan_name || serpapiStatus.account.plan_id || '—'}</span>
                  </span>
                  {serpapiStatus.account.plan_searches_left != null ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-emerald-700">Left</span>{' '}
                      <span className="font-semibold tabular-nums">{serpapiStatus.account.plan_searches_left}</span>
                      {serpapiStatus.account.searches_per_month != null
                        ? ` / ${serpapiStatus.account.searches_per_month}`
                        : ''}
                    </span>
                  ) : serpapiStatus.account.total_searches_left != null ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-emerald-700">Credits left</span>{' '}
                      <span className="font-semibold tabular-nums">{serpapiStatus.account.total_searches_left}</span>
                    </span>
                  ) : null}
                  {serpapiStatus.account.this_month_usage != null ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-emerald-700">Used this month</span>{' '}
                      <span className="font-medium tabular-nums">{serpapiStatus.account.this_month_usage}</span>
                    </span>
                  ) : null}
                  {serpapiStatus.account.account_status ? (
                    <span className="text-[10px] text-emerald-700">{serpapiStatus.account.account_status}</span>
                  ) : null}
                </div>
              ) : serpapiStatus?.account_error ? (
                <p className="text-[10px] text-amber-800">
                  Account API: {serpapiStatus.account_error}. Проверьте ключ на serpapi.com.
                </p>
              ) : (
                <p className="text-[10px] text-emerald-700">
                  Сохраните ключ и нажмите «Обновить account.json».
                </p>
              )}
            </div>
          )}

          {config.id === 'apify_keys' && (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-amber-900">Apify Account & Limits</p>
                  <p className="text-[10px] text-amber-700">
                    <a
                      href="https://console.apify.com/account#/integrations"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-amber-900"
                    >
                      console.apify.com/account
                    </a>
                    {' · '}
                    <a
                      href="https://console.apify.com/billing/subscription"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-amber-900"
                    >
                      limits & billing
                    </a>
                  </p>
                </div>
                {onRefreshApifyStatus ? (
                  <button
                    type="button"
                    onClick={() => onRefreshApifyStatus()}
                    disabled={apifyStatusLoading}
                    className="text-[10px] px-2 py-0.5 rounded border border-amber-300 bg-white hover:bg-amber-50 disabled:opacity-50"
                  >
                    {apifyStatusLoading ? 'Загрузка…' : 'Обновить статус Apify'}
                  </button>
                ) : null}
              </div>
              {apifyStatusError ? (
                <p className="text-[10px] text-rose-700">{apifyStatusError}</p>
              ) : apifyStatusLoading && !apifyStatus ? (
                <p className="text-[10px] text-amber-700">Загружаем данные аккаунта Apify…</p>
              ) : !apifyStatus?.configured && keys.length === 0 ? (
                <p className="text-[10px] text-amber-700">Добавьте Apify API token и сохраните настройки.</p>
              ) : apifyStatus?.account_ok && apifyStatus.account ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-950">
                  {apifyStatus.account.userId ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-amber-700">User ID</span>{' '}
                      <span className="font-mono font-semibold">{apifyStatus.account.userId}</span>
                    </span>
                  ) : null}
                  {apifyStatus.account.username ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-amber-700">Username</span>{' '}
                      <span className="font-semibold">{apifyStatus.account.username}</span>
                    </span>
                  ) : null}
                  {apifyStatus.account.plan ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-amber-700">Plan</span>{' '}
                      <span className="font-semibold">{apifyStatus.account.plan}</span>
                    </span>
                  ) : null}
                  {apifyStatus.account.maxMemoryMbytes != null ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-amber-700">Max Memory</span>{' '}
                      <span className="font-semibold tabular-nums">
                        {Math.round(apifyStatus.account.maxMemoryMbytes / 1024)} GB
                      </span>
                    </span>
                  ) : null}
                  {apifyStatus.account.maxConcurrentActorRuns != null ? (
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-amber-700">Max Runs</span>{' '}
                      <span className="font-semibold tabular-nums">
                        {apifyStatus.account.maxConcurrentActorRuns}
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : apifyStatus?.account_error ? (
                <p className="text-[10px] text-amber-800">
                  Apify API: {apifyStatus.account_error}. Проверьте токен в console.apify.com.
                </p>
              ) : (
                <p className="text-[10px] text-amber-700">
                  Сохраните ключ и нажмите «Обновить статус Apify».
                </p>
              )}
            </div>
          )}

          {config.modelField && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-gray-700">{config.modelLabel}</label>
                  {isOpenRouterPicker && onRefreshOpenrouterCatalog ? (
                    <button
                      type="button"
                      onClick={() => onRefreshOpenrouterCatalog()}
                      disabled={openrouterCatalogLoading}
                      className="text-[10px] px-2 py-0.5 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      {openrouterCatalogLoading ? 'Загрузка…' : 'Обновить каталог OpenRouter'}
                    </button>
                  ) : config.catalogKey === 'openmodel' && onRefreshOpenmodelStatus ? (
                    <button
                      type="button"
                      onClick={() => onRefreshOpenmodelStatus()}
                      disabled={openmodelStatusLoading}
                      className="text-[10px] px-2 py-0.5 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      {openmodelStatusLoading ? 'Загрузка…' : 'Обновить список моделей'}
                    </button>
                  ) : null}
                </div>
                {config.modelHint && <p className="text-[10px] text-gray-400">{config.modelHint}</p>}
                {isOpenRouterPicker ? (
                  <ModelSearchCombobox
                    value={String(settings[config.modelField] ?? '')}
                    onChange={(next) =>
                      onSettingsChange({ [config.modelField!]: next } as Partial<ProviderKeysState>)
                    }
                    options={openrouterPickerOptions}
                    metaById={openrouterMetaById}
                    placeholder="Поиск OpenRouter модели…"
                    loading={openrouterCatalogLoading}
                    loadError={openrouterCatalogError}
                    emptyLabel="Бесплатные и платные модели из openrouter.ai"
                  />
                ) : modelOptions.length > 0 ? (
                  config.id === 'serpapi_keys' ? (
                    <div className="space-y-1.5">
                      <select
                        value={
                          modelOptions.includes(String(settings[config.modelField] ?? ''))
                            ? String(settings[config.modelField] ?? '')
                            : ''
                        }
                        onChange={(e) => {
                          const v = e.target.value
                          if (v) {
                            onSettingsChange({ [config.modelField!]: v } as Partial<ProviderKeysState>)
                          }
                        }}
                        className="w-full border rounded-md px-2.5 py-1.5 text-xs font-mono bg-white"
                      >
                        <option value="">— preset —</option>
                        {modelOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        list="serpapi-engine-presets"
                        value={String(settings[config.modelField] ?? '')}
                        onChange={(e) =>
                          onSettingsChange({ [config.modelField!]: e.target.value } as Partial<ProviderKeysState>)
                        }
                        placeholder={config.modelPlaceholder}
                        className="w-full border rounded-md px-2.5 py-1.5 text-xs font-mono bg-white"
                      />
                      <datalist id="serpapi-engine-presets">
                        {modelOptions.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </div>
                  ) : (
                  <select
                    value={String(settings[config.modelField] ?? '')}
                    onChange={(e) =>
                      onSettingsChange({ [config.modelField!]: e.target.value } as Partial<ProviderKeysState>)
                    }
                    className="w-full border rounded-md px-2.5 py-1.5 text-xs font-mono bg-white"
                  >
                    <option value="">— выберите модель —</option>
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  )
                ) : (
                  <input
                    type="text"
                    value={String(settings[config.modelField] ?? '')}
                    onChange={(e) =>
                      onSettingsChange({ [config.modelField!]: e.target.value } as Partial<ProviderKeysState>)
                    }
                    placeholder={config.modelPlaceholder}
                    className="w-full border rounded-md px-2.5 py-1.5 text-xs font-mono bg-white"
                  />
                )}
                {isOpenRouterPicker ? (
                  <p className="text-[10px] text-gray-400">
                    {openrouterMeta.length > 0
                      ? `Каталог OpenRouter: ${openrouterMeta.length} моделей (кэш 24ч на сервере). Бесплатные — отдельной секцией в списке.`
                      : openrouterCatalogLoading
                        ? 'Загружаем актуальный список с openrouter.ai…'
                        : 'Нажмите «Обновить каталог OpenRouter» или сохраните Agent API key и перезагрузите страницу.'}
                  </p>
                ) : (
                  modelOptions.length > 0 && (
                    <p className="text-[10px] text-gray-400">
                      Список из live API ({modelOptions.length}). Сохраните ключи и обновите страницу для актуализации.
                    </p>
                  )
                )}
              </div>
            </div>
          )}

          {!config.modelField && config.modelHint && (
            <p className="text-[10px] text-gray-500 border-l-2 border-gray-200 pl-2">{config.modelHint}</p>
          )}

          {config.extraFields?.map((ef) => (
            <div key={String(ef.field)} className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">{ef.label}</label>
              {ef.hint && <p className="text-[10px] text-gray-400">{ef.hint}</p>}
              <input
                type="text"
                value={String(settings[ef.field] ?? '')}
                onChange={(e) =>
                  onSettingsChange({ [ef.field]: e.target.value } as Partial<ProviderKeysState>)
                }
                placeholder={ef.placeholder}
                className="w-full border rounded-md px-2.5 py-1.5 text-xs font-mono bg-white"
              />
            </div>
          ))}

          <div className="rounded-md border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-[28px_52px_1fr_72px_64px] gap-1 px-2 py-1.5 bg-gray-50 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              <span>#</span>
              <span>on</span>
              <span>ключ</span>
              <span>health</span>
              <span className="text-right">act</span>
            </div>
            {keys.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-gray-400 italic">Ключи ещё не добавлены.</p>
            ) : (
              keys.map((k, idx) => {
                const enabled = metaEntries[idx]?.enabled !== false
                const health = keyHealth[idx]
                return (
                  <div
                    key={`${k.slice(0, 12)}-${idx}`}
                    className="grid grid-cols-[28px_52px_1fr_72px_64px] gap-1 items-center px-2 py-1.5 border-t border-gray-100 text-xs"
                  >
                    <span className="text-[10px] text-gray-400">{idx + 1}</span>
                    <label className="inline-flex items-center">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(idx, e.target.checked)}
                        className="rounded border-gray-300"
                        title="Включён в ротацию"
                      />
                    </label>
                    <span className="font-mono text-[11px] text-gray-700 truncate" title={maskKey(k)}>
                      {maskKey(k)}
                    </span>
                    <span className="inline-flex items-center gap-1" title={health?.reason || health?.status}>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${healthDotClassExtended(health)}`} />
                      <span className="text-[10px] text-gray-600 truncate">
                        {healthStatusLabel(health)}
                      </span>
                    </span>
                    <div className="flex justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => (onCopy ? onCopy(k) : navigator.clipboard.writeText(k))}
                        className="p-1 rounded border border-gray-200 hover:bg-gray-50"
                        title="Копировать"
                      >
                        <Copy className="w-3 h-3 text-gray-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeys(keys.filter((_, i) => i !== idx))}
                        className="p-1 rounded border border-gray-200 hover:bg-red-50"
                        title="Удалить"
                      >
                        <X className="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="password"
              placeholder={config.newKeyPlaceholder}
              className="flex-1 border rounded-md px-2.5 py-1.5 text-xs font-mono bg-white"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSingle()
                }
              }}
            />
            <button
              type="button"
              onClick={addSingle}
              className="px-3 py-1.5 rounded-md border border-gray-300 text-xs font-medium hover:bg-gray-50"
            >
              Добавить
            </button>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-gray-600 hover:text-gray-900">Массовая вставка</summary>
            <div className="mt-2 space-y-2">
              <textarea
                ref={bulkRef}
                rows={3}
                placeholder="По одному ключу на строку"
                className="w-full border rounded-md px-2.5 py-2 text-xs font-mono bg-white"
              />
              <button
                type="button"
                onClick={addBulk}
                className="px-3 py-1.5 rounded-md border border-gray-300 text-xs hover:bg-gray-50"
              >
                Добавить все
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
