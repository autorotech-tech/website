import { useRef } from 'react'
import { Copy, X } from 'lucide-react'

function maskKey(key: string) {
  return key ? key.slice(0, 8) + '•'.repeat(Math.min(key.length - 8, 20)) : ''
}

export type MultiKeyFieldProps = {
  label: string
  description: string
  keys: string[]
  onChange: (keys: string[]) => void
  newKeyPlaceholder: string
  /** Показать тост «Скопировано» в родителе */
  onCopy?: (text: string) => void
  keyHealth?: Array<{
    status: 'active' | 'inactive' | 'unknown'
    reason?: string
    until?: string
  }>
}

export function MultiKeyField({
  label,
  description,
  keys,
  onChange,
  newKeyPlaceholder,
  onCopy,
  keyHealth,
}: MultiKeyFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const bulkRef = useRef<HTMLTextAreaElement>(null)

  const addSingle = () => {
    const value = inputRef.current?.value.trim() ?? ''
    if (!value) return
    onChange([...keys, value])
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
    onChange(next)
    if (bulkRef.current) bulkRef.current.value = ''
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <p className="text-[11px] text-gray-400">{description}</p>
      <div className="space-y-1.5">
        {keys.length === 0 && (
          <p className="text-[11px] text-gray-400 italic">Ключи ещё не добавлены.</p>
        )}
        {keys.map((k, idx) => (
          <div key={`${k.slice(0, 12)}-${idx}`} className="flex items-center gap-2">
            <div className="flex-1 px-3 py-1.5 rounded border text-xs font-mono bg-gray-50 text-gray-700">
              {maskKey(k)}
            </div>
            {keyHealth?.[idx] && (
              <span
                className={
                  keyHealth[idx].status === 'active'
                    ? 'px-2 py-1 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : keyHealth[idx].status === 'inactive'
                      ? 'px-2 py-1 rounded text-[10px] bg-rose-50 text-rose-700 border border-rose-200'
                      : 'px-2 py-1 rounded text-[10px] bg-gray-50 text-gray-600 border border-gray-200'
                }
                title={
                  keyHealth[idx].reason
                    ? `${keyHealth[idx].reason}${keyHealth[idx].until ? `; until ${keyHealth[idx].until}` : ''}`
                    : keyHealth[idx].status
                }
              >
                {keyHealth[idx].status === 'active' ? 'активен' : keyHealth[idx].status === 'inactive' ? 'неактивен' : 'неизвестно'}
              </span>
            )}
            <button
              type="button"
              onClick={() => (onCopy ? onCopy(k) : navigator.clipboard.writeText(k))}
              className="p-1.5 rounded border border-gray-200 hover:bg-gray-100"
              title="Копировать"
            >
              <Copy className="w-3.5 h-3.5 text-gray-500" />
            </button>
            <button
              type="button"
              onClick={() => onChange(keys.filter((_, i) => i !== idx))}
              className="p-1.5 rounded border border-gray-200 hover:bg-red-50"
              title="Удалить"
            >
              <X className="w-3.5 h-3.5 text-red-500" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="password"
            placeholder={newKeyPlaceholder}
            className="flex-1 border rounded-md px-3 py-2 text-xs font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSingle()
              }
            }}
          />
          <button
            type="button"
            className="px-3 py-2 text-xs rounded-md border border-gray-300 hover:bg-gray-50 shrink-0"
            onClick={addSingle}
          >
            + Добавить
          </button>
        </div>
        <div className="space-y-1 pt-1">
          <label className="text-[11px] font-medium text-gray-600">Массовая вставка</label>
          <textarea
            ref={bulkRef}
            rows={3}
            placeholder="Один ключ на строку — вставьте список и нажмите «Добавить из списка»"
            className="w-full border rounded-md px-3 py-2 text-xs font-mono"
          />
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded-md border border-gray-300 hover:bg-gray-50"
            onClick={addBulk}
          >
            Добавить из списка
          </button>
        </div>
      </div>
    </div>
  )
}
