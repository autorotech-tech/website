import { useMemo, useRef, useState } from 'react'
import { Copy, X } from 'lucide-react'
import {
  ModelSearchCombobox,
  buildOpenRouterMetaMap,
  type OpenRouterModelMeta,
} from './ModelSearchCombobox'

export type { OpenRouterModelMeta }

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
  category: 'llm' | 'search'
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
  brave_keys: string[]
  tavily_keys: string[]
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
}

export const PROVIDER_CATEGORIES = [
  { id: 'llm' as const, label: 'LLM / Chat' },
  { id: 'search' as const, label: 'Поиск' },
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

function healthDotClass(status?: KeyHealthEntry['status']) {
  if (status === 'active') return 'bg-emerald-500'
  if (status === 'inactive') return 'bg-rose-500'
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

export function ProviderApiKeysPanel({
  settings,
  apiKeyPoolMeta,
  keyHealthByProvider,
  modelCatalogs = {},
  openrouterMeta = [],
  openrouterCatalogLoading = false,
  openrouterCatalogError = null,
  onRefreshOpenrouterCatalog,
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
                      <span className={`w-2 h-2 rounded-full shrink-0 ${healthDotClass(health?.status)}`} />
                      <span className="text-[10px] text-gray-600 truncate">
                        {health?.status === 'active'
                          ? 'ok'
                          : health?.status === 'inactive'
                            ? 'fail'
                            : '?'}
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
