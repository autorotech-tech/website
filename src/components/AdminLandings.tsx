import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AlertCircle, CheckCircle2, Copy, ExternalLink, Link2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

interface SpotLite {
  id: number
  name: string
}

interface Landing {
  id: number
  name: string
  slug: string
  page_url: string
  spot_id: number
  is_active: boolean
  created_at: string
}

interface LandingForm {
  name: string
  slug: string
  page_url: string
  spot_id: string
  is_active: boolean
}

const EMPTY_FORM: LandingForm = {
  name: '',
  slug: '',
  page_url: '',
  spot_id: '',
  is_active: true,
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function AdminLandings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [spots, setSpots] = useState<SpotLite[]>([])
  const [landings, setLandings] = useState<Landing[]>([])
  const [form, setForm] = useState<LandingForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)

  const spotById = useMemo(() => {
    const map = new Map<number, SpotLite>()
    for (const s of spots) map.set(s.id, s)
    return map
  }, [spots])

  const loadData = async () => {
    setError(null)
    const [spotsRes, landingsRes] = await Promise.all([
      supabase.from('spots').select('id, name').order('created_at', { ascending: false }),
      supabase.from('landings').select('*').order('created_at', { ascending: false }),
    ])
    if (spotsRes.error) throw spotsRes.error
    if (landingsRes.error) throw landingsRes.error
    setSpots((spotsRes.data || []) as SpotLite[])
    setLandings((landingsRes.data || []) as Landing[])
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        const { data: auth } = await supabase.auth.getUser()
        const user = auth?.user
        if (!user) return

        const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        const admin = profile?.role === 'admin'
        setIsAdmin(admin)
        if (!admin) return

        await loadData()
      } catch (e: any) {
        setError(e.message || 'Не удалось загрузить лендинги')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const copy = async (value: string, message = 'Скопировано') => {
    await navigator.clipboard.writeText(value)
    setSuccess(message)
    setTimeout(() => setSuccess(null), 1600)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      if (!form.name.trim()) throw new Error('Введите название лендинга')
      if (!form.slug.trim()) throw new Error('Введите slug')
      if (!form.page_url.trim()) throw new Error('Введите URL лендинга')
      if (!form.spot_id) throw new Error('Выберите Spot')

      const payload = {
        name: form.name.trim(),
        slug: slugify(form.slug),
        page_url: form.page_url.trim(),
        spot_id: Number(form.spot_id),
        is_active: form.is_active,
      }

      if (editingId) {
        const { error } = await supabase.from('landings').update(payload).eq('id', editingId)
        if (error) throw error
        setSuccess('Лендинг обновлен')
      } else {
        const { error } = await supabase.from('landings').insert(payload)
        if (error) throw error
        setSuccess('Лендинг создан')
      }
      resetForm()
      await loadData()
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (row: Landing) => {
    setEditingId(row.id)
    setForm({
      name: row.name,
      slug: row.slug,
      page_url: row.page_url,
      spot_id: String(row.spot_id),
      is_active: row.is_active,
    })
  }

  const remove = async (row: Landing) => {
    if (!window.confirm(`Удалить лендинг "${row.name}"?`)) return
    const { error } = await supabase.from('landings').delete().eq('id', row.id)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess('Лендинг удален')
    await loadData()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-700">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Загрузка landings...</span>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-4 text-red-600 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        <span>Доступ только для администраторов.</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Landings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Единый UX-поток: привязка landing -&gt; spot -&gt; go-link для рекламного трафика.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 rounded bg-green-50 text-green-700 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 text-gray-900 font-semibold">
          <Plus className="w-4 h-4" />
          <span>{editingId ? 'Редактирование лендинга' : 'Создание лендинга'}</span>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <input
            value={form.name}
            onChange={(e) => {
              const name = e.target.value
              setForm((v) => ({ ...v, name, slug: v.slug ? v.slug : slugify(name) }))
            }}
            placeholder="Название лендинга"
            className="border rounded-md px-3 py-2 text-sm"
          />
          <input
            value={form.slug}
            onChange={(e) => setForm((v) => ({ ...v, slug: slugify(e.target.value) }))}
            placeholder="my-landing"
            className="border rounded-md px-3 py-2 text-sm"
          />
          <input
            value={form.page_url}
            onChange={(e) => setForm((v) => ({ ...v, page_url: e.target.value }))}
            placeholder="https://example.com/landing"
            className="border rounded-md px-3 py-2 text-sm"
          />
          <select
            value={form.spot_id}
            onChange={(e) => setForm((v) => ({ ...v, spot_id: e.target.value }))}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Выберите Spot</option>
            {spots.map((spot) => (
              <option key={spot.id} value={String(spot.id)}>
                {spot.name}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((v) => ({ ...v, is_active: e.target.checked }))}
              className="rounded border-gray-300"
            />
            Активный лендинг
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            disabled={saving}
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {editingId ? 'Сохранить изменения' : 'Создать лендинг'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
            >
              Отмена
            </button>
          )}
        </div>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center gap-2 font-semibold text-gray-900">
          <Link2 className="w-4 h-4" />
          <span>Landing → Spot → Go-Link</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-3">Landing</th>
                <th className="text-left p-3">Spot</th>
                <th className="text-left p-3">Landing Link</th>
                <th className="text-left p-3">Go Link</th>
                <th className="text-right p-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {landings.map((row) => {
                const landingLink = `${window.location.origin}/l/${row.slug}`
                const goLink = `${window.location.origin}/go/${row.spot_id}`
                return (
                  <tr key={row.id} className="border-t border-gray-100 align-top">
                    <td className="p-3">
                      <div className="font-medium text-gray-900">{row.name}</div>
                      <div className="text-xs text-gray-500">slug: {row.slug}</div>
                      <div className={`text-xs ${row.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {row.is_active ? 'active' : 'inactive'}
                      </div>
                    </td>
                    <td className="p-3 text-gray-700">{spotById.get(row.spot_id)?.name || `#${row.spot_id}`}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copy(landingLink, 'Landing link скопирован')}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>/l/{row.slug}</span>
                        </button>
                        <a href={landingLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => copy(goLink, 'Go-link скопирован')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>/go/{row.spot_id}</span>
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => startEdit(row)}
                          className="p-2 rounded border border-gray-300 hover:bg-gray-50"
                          title="Редактировать"
                        >
                          <Pencil className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => remove(row)}
                          className="p-2 rounded border border-red-200 hover:bg-red-50"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!landings.length && (
                <tr>
                  <td className="p-6 text-center text-gray-500" colSpan={5}>
                    Лендинги пока не созданы.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
