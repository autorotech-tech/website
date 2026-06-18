import { useMemo, useState } from 'react'
import { MultiKeyField } from './MultiKeyField'
import { Plus, Trash2 } from 'lucide-react'
import type { ProviderCatalogs } from './ProviderApiKeysPanel'

export type ApiKeyGroup = {
  id: string
  name: string
  keys: string[]
  provider?: string
  tiers?: string[]
  models?: string[]
  user_email?: string
  priority?: number
}

export function normalizeApiGroupId(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s || `group_${Date.now()}`
}

export type ApiKeyGroupsFieldProps = {
  groups: ApiKeyGroup[]
  onChange: (groups: ApiKeyGroup[]) => void
  onCopy?: (text: string) => void
  modelCatalogs?: ProviderCatalogs
}

const PROVIDER_OPTIONS: Array<{ id: string; label: string; catalogKey?: string }> = [
  { id: '', label: 'Любой провайдер' },
  { id: 'openrouter', label: 'OpenRouter', catalogKey: 'openrouter' },
  { id: 'openai', label: 'OpenAI', catalogKey: 'openai' },
  { id: 'groq', label: 'Groq', catalogKey: 'groq' },
  { id: 'glm', label: 'GLM (BigModel)', catalogKey: 'glm' },
  { id: 'gemini', label: 'Gemini', catalogKey: 'gemini' },
  { id: 'lmarena', label: 'LMArena Bridge', catalogKey: 'lmarena' },
]

const TIER_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'code', label: 'code' },
  { id: 'reasoning', label: 'reasoning' },
  { id: 'fast', label: 'fast' },
  { id: 'general', label: 'general' },
]

const MODEL_PRESETS: Record<string, string[]> = {
  openrouter: [
    'anthropic/claude-3.7-sonnet',
    'openai/gpt-4o-mini',
    'google/gemini-2.0-flash-001',
  ],
}

function buildModelOptions(
  provider: string,
  catalogs: ProviderCatalogs,
  selected: string[],
): string[] {
  const catalogKey = PROVIDER_OPTIONS.find((p) => p.id === provider)?.catalogKey
  const live = catalogKey ? catalogs[catalogKey] || [] : []
  const presets = catalogKey ? MODEL_PRESETS[catalogKey] || [] : []
  const merged = [...live, ...presets, ...selected]
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of merged) {
    const v = String(m || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

export function ApiKeyGroupsField({
  groups,
  onChange,
  onCopy,
  modelCatalogs = {},
}: ApiKeyGroupsFieldProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  const safeIdx = groups.length === 0 ? -1 : Math.min(selectedIdx, groups.length - 1)
  const group = safeIdx >= 0 ? groups[safeIdx] : null

  const modelOptions = useMemo(() => {
    if (!group) return []
    return buildModelOptions(String(group.provider || ''), modelCatalogs, group.models || [])
  }, [group, modelCatalogs])

  const addGroup = () => {
    const next = [
      ...groups,
      {
        id: `group_${Date.now()}`,
        name: 'Новая группа',
        keys: [],
        provider: '',
        tiers: [],
        models: [],
        user_email: '',
        priority: 0,
      },
    ]
    onChange(next)
    setSelectedIdx(next.length - 1)
  }

  const removeGroup = (idx: number) => {
    const next = groups.filter((_, i) => i !== idx)
    onChange(next)
    setSelectedIdx(Math.max(0, Math.min(idx, next.length - 1)))
  }

  const patchGroup = (idx: number, patch: Partial<ApiKeyGroup>) => {
    onChange(groups.map((g, i) => (i === idx ? { ...g, ...patch } : g)))
  }

  const addModelToGroup = (model: string) => {
    if (!group || safeIdx < 0 || !model) return
    const set = new Set(group.models || [])
    set.add(model)
    patchGroup(safeIdx, { models: Array.from(set) })
  }

  const removeModelFromGroup = (model: string) => {
    if (!group || safeIdx < 0) return
    patchGroup(safeIdx, {
      models: (group.models || []).filter((m) => m !== model),
    })
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80 space-y-2">
        <p className="text-[11px] text-gray-500">
          Именованные пулы ключей для DeerFlow и кастомных интеграций. ID →{' '}
          <code className="bg-white px-1 rounded">SWOOP_API_GROUP_&lt;ID&gt;_KEYS</code>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600 shrink-0">Группа:</label>
          <select
            value={safeIdx >= 0 ? String(safeIdx) : ''}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            className="flex-1 min-w-[160px] border rounded-md px-2.5 py-1.5 text-xs bg-white"
            disabled={groups.length === 0}
          >
            {groups.length === 0 ? (
              <option value="">— нет групп —</option>
            ) : (
              groups.map((g, i) => (
                <option key={`${g.id}-${i}`} value={String(i)}>
                  {g.name || g.id} ({g.keys.length} ключ.)
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={addGroup}
            className="inline-flex items-center gap-1 shrink-0 px-3 py-1.5 text-xs rounded-md border border-gray-300 hover:bg-gray-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Новая
          </button>
        </div>
      </div>

      {group && safeIdx >= 0 ? (
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-gray-600">ID группы</label>
                <input
                  type="text"
                  value={group.id}
                  onChange={(e) => patchGroup(safeIdx, { id: e.target.value })}
                  onBlur={() => patchGroup(safeIdx, { id: normalizeApiGroupId(group.id) })}
                  placeholder="my_custom_api"
                  className="w-full border rounded-md px-2 py-1.5 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-gray-600">Название</label>
                <input
                  type="text"
                  value={group.name}
                  onChange={(e) => patchGroup(safeIdx, { name: e.target.value })}
                  placeholder="Отображаемое имя"
                  className="w-full border rounded-md px-2 py-1.5 text-xs"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeGroup(safeIdx)}
              className="p-2 rounded border border-red-200 text-red-600 hover:bg-red-50 shrink-0"
              title="Удалить группу"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600">Провайдер</label>
              <select
                value={String(group.provider || '')}
                onChange={(e) => patchGroup(safeIdx, { provider: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-xs"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.id || 'any'} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600">User email</label>
              <input
                type="email"
                value={String(group.user_email || '')}
                onChange={(e) => patchGroup(safeIdx, { user_email: e.target.value })}
                placeholder="autoro.tech@gmail.com"
                className="w-full border rounded-md px-2 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600">Tiers</label>
              <div className="flex flex-wrap gap-2 text-xs">
                {TIER_OPTIONS.map((t) => {
                  const set = new Set((group.tiers || []).map((x) => String(x).toLowerCase()))
                  const checked = set.has(t.id)
                  return (
                    <label key={t.id} className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set((group.tiers || []).map((x) => String(x).toLowerCase()))
                          if (e.target.checked) next.add(t.id)
                          else next.delete(t.id)
                          patchGroup(safeIdx, { tiers: Array.from(next) })
                        }}
                      />
                      <span className="font-mono">{t.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600">Priority</label>
              <input
                type="number"
                value={Number(group.priority || 0)}
                onChange={(e) => patchGroup(safeIdx, { priority: Number(e.target.value || 0) })}
                className="w-full border rounded-md px-2 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-gray-600">Модели (привязка группы)</label>
            <div className="flex gap-2">
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value
                  if (v) addModelToGroup(v)
                  e.target.value = ''
                }}
                className="flex-1 border rounded-md px-2.5 py-1.5 text-xs font-mono bg-white"
              >
                <option value="">— добавить модель из списка —</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m} disabled={(group.models || []).includes(m)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {(group.models || []).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {(group.models || []).map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[10px] font-mono text-violet-900"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => removeModelFromGroup(m)}
                      className="text-violet-500 hover:text-red-600"
                      title="Убрать"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-400">Пусто — группа для любой модели провайдера.</p>
            )}
          </div>

          <MultiKeyField
            label="Ключи выбранной группы"
            description="Ротация по порядку при ошибках и лимитах."
            keys={group.keys}
            onChange={(keys) => patchGroup(safeIdx, { keys })}
            newKeyPlaceholder="API key"
            onCopy={onCopy}
          />
        </div>
      ) : (
        <p className="px-4 py-6 text-[11px] text-gray-400 italic">Создайте группу для произвольного пула ключей.</p>
      )}
    </div>
  )
}
