import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'

export type OpenRouterModelMeta = {
  id: string
  name: string
  description?: string
  context_length?: number
  is_free?: boolean
  pricing?: { prompt: string; completion: string }
}

export function isOpenRouterModelFree(meta: OpenRouterModelMeta | undefined): boolean {
  if (!meta) return false
  if (meta.is_free) return true
  const id = meta.id.toLowerCase()
  if (id.includes(':free') || id.endsWith('/free')) return true
  const prompt = parseFloat(meta.pricing?.prompt || '0')
  const completion = parseFloat(meta.pricing?.completion || '0')
  return !Number.isNaN(prompt) && !Number.isNaN(completion) && prompt === 0 && completion === 0
}

function formatPrice(perToken: string | undefined): string {
  const value = parseFloat(perToken || '0')
  if (Number.isNaN(value) || value === 0) return 'Free'
  const perMillion = value * 1_000_000
  if (perMillion < 0.01) return '<$0.01'
  if (perMillion < 1) return `$${perMillion.toFixed(2)}`
  return perMillion >= 10 ? `$${perMillion.toFixed(0)}` : `$${perMillion.toFixed(2)}`
}

function formatContext(length: number | undefined): string {
  const n = Number(length || 0)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return n ? String(n) : '—'
}

type ModelSearchComboboxProps = {
  value: string
  onChange: (next: string) => void
  options: string[]
  metaById?: Record<string, OpenRouterModelMeta>
  placeholder?: string
  emptyLabel?: string
  loading?: boolean
  loadError?: string | null
}

function ModelRow({
  id,
  meta,
  active,
  onPick,
}: {
  id: string
  meta?: OpenRouterModelMeta
  active: boolean
  onPick: () => void
}) {
  const free = isOpenRouterModelFree(meta)
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onPick}
        className={`w-full text-left px-2.5 py-2 hover:bg-amber-50 border-b border-gray-50 last:border-0 ${
          active ? 'bg-amber-50/80' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-gray-900 truncate flex-1">{id}</span>
          {free ? (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
              free
            </span>
          ) : null}
        </div>
        {meta ? (
          <div className="text-[10px] text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
            <span className="truncate max-w-full">{meta.name}</span>
            <span>ctx {formatContext(meta.context_length)}</span>
            <span>
              {formatPrice(meta.pricing?.prompt)}/{formatPrice(meta.pricing?.completion)}
            </span>
          </div>
        ) : null}
      </button>
    </li>
  )
}

export function ModelSearchCombobox({
  value,
  onChange,
  options,
  metaById = {},
  placeholder = 'Поиск модели…',
  emptyLabel = 'Начните вводить или выберите из списка',
  loading = false,
  loadError = null,
}: ModelSearchComboboxProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { freeOptions, paidOptions, filtered } = useMemo(() => {
    const free: string[] = []
    const paid: string[] = []
    for (const id of options) {
      if (isOpenRouterModelFree(metaById[id])) free.push(id)
      else paid.push(id)
    }
    const q = query.trim().toLowerCase()
    if (!q) {
      return {
        freeOptions: free.slice(0, 25),
        paidOptions: paid.slice(0, 25),
        filtered: [] as string[],
      }
    }
    const match = (id: string) => {
      const meta = metaById[id]
      return (
        id.toLowerCase().includes(q) ||
        (meta?.name || '').toLowerCase().includes(q) ||
        (meta?.description || '').toLowerCase().includes(q)
      )
    }
    const hits = options.filter(match).slice(0, 40)
    return { freeOptions: [], paidOptions: [], filtered: hits }
  }, [options, query, metaById])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selectedMeta = value ? metaById[value] : undefined

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            value={open ? query : value}
            placeholder={loading ? 'Загрузка каталога OpenRouter…' : value || placeholder}
            disabled={loading && options.length === 0}
            onFocus={() => {
              setOpen(true)
              setQuery(value)
            }}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            className="w-full border rounded-md pl-7 pr-8 py-1.5 text-xs font-mono bg-white disabled:bg-gray-50"
          />
          <button
            type="button"
            aria-label="Открыть список моделей"
            onClick={() => setOpen((v) => !v)}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[10px] text-gray-500 border border-gray-200 rounded px-2 hover:bg-gray-50 shrink-0"
          >
            clear
          </button>
        ) : null}
      </div>

      {loadError ? <p className="text-[10px] text-rose-600 mt-1">{loadError}</p> : null}

      {selectedMeta && !open ? (
        <p className="text-[10px] text-gray-500 mt-1 truncate">
          {isOpenRouterModelFree(selectedMeta) ? (
            <span className="text-emerald-700 font-medium mr-1">FREE</span>
          ) : null}
          {selectedMeta.name} · ctx {formatContext(selectedMeta.context_length)} ·{' '}
          {formatPrice(selectedMeta.pricing?.prompt)}/{formatPrice(selectedMeta.pricing?.completion)} per 1M
        </p>
      ) : null}

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto border border-gray-200 rounded-md bg-white shadow-lg text-xs"
        >
          {!query.trim() ? (
            <>
              <li className="px-2.5 py-1.5 text-[10px] text-gray-400 border-b border-gray-100 sticky top-0 bg-white">
                {emptyLabel} · всего {options.length}
              </li>
              {freeOptions.length > 0 ? (
                <>
                  <li className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 bg-emerald-50/80 sticky top-7">
                    Бесплатные ({freeOptions.length})
                  </li>
                  {freeOptions.map((id) => (
                    <ModelRow
                      key={`free-${id}`}
                      id={id}
                      meta={metaById[id]}
                      active={id === value}
                      onPick={() => {
                        onChange(id)
                        setQuery('')
                        setOpen(false)
                      }}
                    />
                  ))}
                </>
              ) : null}
              {paidOptions.length > 0 ? (
                <>
                  <li className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600 bg-gray-50 sticky top-7">
                    Платные (топ по дате)
                  </li>
                  {paidOptions.map((id) => (
                    <ModelRow
                      key={`paid-${id}`}
                      id={id}
                      meta={metaById[id]}
                      active={id === value}
                      onPick={() => {
                        onChange(id)
                        setQuery('')
                        setOpen(false)
                      }}
                    />
                  ))}
                </>
              ) : null}
              {options.length === 0 && !loading ? (
                <li className="px-2.5 py-2 text-gray-500">Каталог пуст — нажмите «Обновить каталог» выше</li>
              ) : null}
            </>
          ) : filtered.length === 0 ? (
            <li className="px-2.5 py-2 text-gray-500">Ничего не найдено</li>
          ) : (
            filtered.map((id) => (
              <ModelRow
                key={id}
                id={id}
                meta={metaById[id]}
                active={id === value}
                onPick={() => {
                  onChange(id)
                  setQuery('')
                  setOpen(false)
                }}
              />
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

export function buildOpenRouterMetaMap(meta: OpenRouterModelMeta[]): Record<string, OpenRouterModelMeta> {
  const out: Record<string, OpenRouterModelMeta> = {}
  for (const item of meta) {
    const id = String(item.id || '').trim()
    if (id) out[id] = item
  }
  return out
}
