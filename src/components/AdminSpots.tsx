import { ComponentType, FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Link2,
  BarChart3,
  RefreshCw,
  Activity,
  Filter,
  BellRing,
} from 'lucide-react'

interface Spot {
  id: number
  name: string
  target_tg_url: string
  fb_pixel_id: string
  fb_capi_token: string
  created_at: string
}

interface SpotStatsRow {
  spot_id: number
  clicks_count: number
  successful_conversions_count: number
}

interface AnalyticsRow {
  spot_id: number
  spot_name: string
  day: string
  clicks_count: number
  successful_conversions_count: number
  failed_conversions_count: number
  conversion_rate: number | null
}

interface PostbackLogRow {
  conversion_id: number
  click_id: string
  spot_id: number
  spot_name: string
  event_name: string
  status: 'pending' | 'success' | 'failed'
  fb_event_id: string | null
  error_message: string | null
  conversion_created_at: string
}

interface SpotForm {
  name: string
  target_tg_url: string
  fb_pixel_id: string
  fb_capi_token: string
}

const EMPTY_FORM: SpotForm = {
  name: '',
  target_tg_url: '',
  fb_pixel_id: '',
  fb_capi_token: '',
}

type TabId = 'spots' | 'analytics' | 'postback'

const tabs: Array<{ id: TabId; title: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'spots', title: 'Spots', icon: Link2 },
  { id: 'analytics', title: 'Analytics', icon: Activity },
  { id: 'postback', title: 'n8n / Postback', icon: BellRing },
]

const developmentPlanPhases = [
  {
    title: 'Фаза 1 — Tracking ядро и Spot CRUD',
    items: [
      'Сущности: spots, clicks, conversions, landings',
      'Redirect engine: /go/:spot_id и /l/:slug',
      'Внутренний API для n8n: /api/internal/click и /api/internal/conversion',
      'Spot Tracking UI: Spots, Analytics, n8n/Postback',
    ],
  },
  {
    title: 'Фаза 2 — Лендинги и единый UX-поток',
    items: [
      'Отдельный модуль Landings в админке',
      'Связка landing -> spot -> go-link в одной карточке управления',
      'Передача go_link и UTM-параметров в лендинг через /l/{slug}',
    ],
  },
  {
    title: 'Фаза 3 — Сценарий входа через прокладку бота',
    items: [
      'В настройках Spot (вкладка "Бот") добавить команду /start',
      'В /start зашить приветственный текст и кнопку с инвайт-ссылкой в канал',
      'Поток: реклама -> Telegram bot start -> сообщение с кнопкой -> переход в канал -> подписка',
    ],
  },
  {
    title: 'Фаза 4 — Сценарий через Юзер-бот + подключенный аккаунт',
    items: [
      'Подключение отдельного Telegram-аккаунта (без входящих диалогов) во вкладке "Каналы связи"',
      'Назначение подключенного аккаунта админом целевого канала',
      'В настройках Spot: тип "Открытый канал", во вкладке "Бот" выбрать тип "Юзер бот" и нужный подключенный аккаунт',
    ],
  },
  {
    title: 'Фаза 5 — Надежность, мониторинг и эксплуатация',
    items: [
      'Очередь ретраев postback_retry_queue + n8n retry workflow',
      'Логи ошибок Meta CAPI и ручной retry из интерфейса',
      'Материализованные метрики spot_metrics_mv и регламент refresh',
    ],
  },
]

export function AdminSpots() {
  const [activeTab, setActiveTab] = useState<TabId>('spots')
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [statsBySpotId, setStatsBySpotId] = useState<Record<number, SpotStatsRow>>({})
  const [form, setForm] = useState<SpotForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [analyticsRows, setAnalyticsRows] = useState<AnalyticsRow[]>([])
  const [postbackRows, setPostbackRows] = useState<PostbackLogRow[]>([])
  const [retryingConversionId, setRetryingConversionId] = useState<number | null>(null)

  const [spotFilterId, setSpotFilterId] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all')

  const today = new Date().toISOString().slice(0, 10)
  const weekAgoDate = new Date()
  weekAgoDate.setDate(weekAgoDate.getDate() - 7)
  const [dateFrom, setDateFrom] = useState<string>(weekAgoDate.toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState<string>(today)

  const sortedSpots = useMemo(
    () => [...spots].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [spots]
  )

  const filteredAnalyticsRows = useMemo(() => {
    return analyticsRows.filter((row) => {
      if (spotFilterId !== 'all' && String(row.spot_id) !== spotFilterId) return false
      if (dateFrom && row.day < dateFrom) return false
      if (dateTo && row.day > dateTo) return false
      return true
    })
  }, [analyticsRows, spotFilterId, dateFrom, dateTo])

  const filteredPostbackRows = useMemo(() => {
    return postbackRows.filter((row) => {
      if (spotFilterId !== 'all' && String(row.spot_id) !== spotFilterId) return false
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      return true
    })
  }, [postbackRows, spotFilterId, statusFilter])

  const analyticsTotals = useMemo(() => {
    return filteredAnalyticsRows.reduce(
      (acc, row) => {
        acc.clicks += row.clicks_count ?? 0
        acc.success += row.successful_conversions_count ?? 0
        acc.failed += row.failed_conversions_count ?? 0
        return acc
      },
      { clicks: 0, success: 0, failed: 0 }
    )
  }, [filteredAnalyticsRows])

  const chartMax = useMemo(() => {
    let max = 0
    for (const row of filteredAnalyticsRows) {
      max = Math.max(max, row.clicks_count || 0, row.successful_conversions_count || 0)
    }
    return max || 1
  }, [filteredAnalyticsRows])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const loadData = async () => {
    setError(null)
    const [spotsRes, statsRes, analyticsRes, postbackRes] = await Promise.all([
      supabase.from('spots').select('*').order('created_at', { ascending: false }),
      supabase.from('spot_stats').select('spot_id, clicks_count, successful_conversions_count'),
      supabase.from('spot_metrics_mv').select('*').order('day', { ascending: true }),
      supabase
        .from('spot_postback_log_v')
        .select('*')
        .order('conversion_created_at', { ascending: false })
        .limit(300),
    ])

    if (spotsRes.error) throw spotsRes.error
    if (statsRes.error) throw statsRes.error
    if (analyticsRes.error) throw analyticsRes.error
    if (postbackRes.error) throw postbackRes.error

    setSpots((spotsRes.data || []) as Spot[])
    setAnalyticsRows((analyticsRes.data || []) as AnalyticsRow[])
    setPostbackRows((postbackRes.data || []) as PostbackLogRow[])

    const map: Record<number, SpotStatsRow> = {}
    for (const row of (statsRes.data || []) as SpotStatsRow[]) {
      map[row.spot_id] = row
    }
    setStatsBySpotId(map)
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
        setError(e.message || 'Не удалось загрузить споты')
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      if (!form.name.trim() || !form.target_tg_url.trim() || !form.fb_pixel_id.trim() || !form.fb_capi_token.trim()) {
        throw new Error('Заполните все обязательные поля')
      }

      if (editingId) {
        const { error } = await supabase
          .from('spots')
          .update({
            name: form.name.trim(),
            target_tg_url: form.target_tg_url.trim(),
            fb_pixel_id: form.fb_pixel_id.trim(),
            fb_capi_token: form.fb_capi_token.trim(),
          })
          .eq('id', editingId)

        if (error) throw error
        setSuccess('Спот обновлен')
      } else {
        const { error } = await supabase.from('spots').insert({
          name: form.name.trim(),
          target_tg_url: form.target_tg_url.trim(),
          fb_pixel_id: form.fb_pixel_id.trim(),
          fb_capi_token: form.fb_capi_token.trim(),
        })

        if (error) throw error
        setSuccess('Спот создан')
      }

      resetForm()
      await loadData()
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (spot: Spot) => {
    setEditingId(spot.id)
    setForm({
      name: spot.name,
      target_tg_url: spot.target_tg_url,
      fb_pixel_id: spot.fb_pixel_id,
      fb_capi_token: spot.fb_capi_token,
    })
  }

  const removeSpot = async (spot: Spot) => {
    if (!window.confirm(`Удалить спот "${spot.name}"?`)) return
    setError(null)
    setSuccess(null)
    const { error } = await supabase.from('spots').delete().eq('id', spot.id)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess('Спот удален')
    await loadData()
  }

  const copyTrackingLink = async (spotId: number) => {
    const link = `${window.location.origin}/go/${spotId}`
    await navigator.clipboard.writeText(link)
    setSuccess('Трекинговая ссылка скопирована')
    setTimeout(() => setSuccess(null), 1800)
  }

  const createRetryTask = async (row: PostbackLogRow) => {
    setRetryingConversionId(row.conversion_id)
    setError(null)
    setSuccess(null)
    try {
      const { error } = await supabase.from('postback_retry_queue').insert({
        conversion_id: row.conversion_id,
        click_id: row.click_id,
        spot_id: row.spot_id,
        reason: 'manual_retry_from_admin_ui',
      })
      if (error) throw error
      setSuccess(`Retry поставлен в очередь для conversion #${row.conversion_id}`)
    } catch (e: any) {
      setError(e.message || 'Не удалось поставить retry в очередь')
    } finally {
      setRetryingConversionId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-700">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Загрузка спотов...</span>
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
        <h1 className="text-2xl font-bold text-gray-900">Ad Spots & Tracking</h1>
        <p className="text-sm text-gray-500 mt-1">
          Управление рекламными спотами, аналитикой, логами постбэков и retry-задачами для n8n.
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

      <div className="bg-white border border-gray-200 rounded-lg p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.title}
              </button>
            )
          })}
        </div>
      </div>

      {activeTab === 'spots' && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2 text-gray-900 font-semibold">
              <BarChart3 className="w-4 h-4" />
              <span>План разработки Spot Tracking</span>
            </div>
            <p className="text-sm text-gray-500">
              План синхронизирован с текущей реализацией и включает следующий блок функционала для ботов и каналов.
            </p>

            <div className="space-y-3">
              {developmentPlanPhases.map((phase) => (
                <div key={phase.title} className="border border-gray-100 rounded-md p-3">
                  <div className="text-sm font-semibold text-gray-800">{phase.title}</div>
                  <ul className="mt-2 space-y-1">
                    {phase.items.map((item) => (
                      <li key={item} className="text-sm text-gray-700 flex gap-2">
                        <span className="text-blue-600">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2 text-gray-900 font-semibold">
              <Plus className="w-4 h-4" />
              <span>{editingId ? 'Редактирование спота' : 'Создание нового спота'}</span>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <input
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                placeholder="Название кампании"
                className="border rounded-md px-3 py-2 text-sm"
              />
              <input
                value={form.target_tg_url}
                onChange={(e) => setForm((v) => ({ ...v, target_tg_url: e.target.value }))}
                placeholder="https://t.me/YOUR_BOT"
                className="border rounded-md px-3 py-2 text-sm"
              />
              <input
                value={form.fb_pixel_id}
                onChange={(e) => setForm((v) => ({ ...v, fb_pixel_id: e.target.value }))}
                placeholder="Facebook Pixel ID"
                className="border rounded-md px-3 py-2 text-sm"
              />
              <input
                value={form.fb_capi_token}
                onChange={(e) => setForm((v) => ({ ...v, fb_capi_token: e.target.value }))}
                placeholder="Facebook CAPI Token"
                className="border rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={saving}
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {editingId ? 'Сохранить изменения' : 'Создать спот'}
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
              <BarChart3 className="w-4 h-4" />
              <span>Споты и статистика</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left p-3">Спот</th>
                    <th className="text-left p-3">Pixel</th>
                    <th className="text-left p-3">Клики</th>
                    <th className="text-left p-3">Успешные конверсии</th>
                    <th className="text-left p-3">Трекинговая ссылка</th>
                    <th className="text-right p-3">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSpots.map((spot) => {
                    const stat = statsBySpotId[spot.id]
                    return (
                      <tr key={spot.id} className="border-t border-gray-100">
                        <td className="p-3">
                          <div className="font-medium text-gray-900">{spot.name}</div>
                          <div className="text-xs text-gray-500">{spot.target_tg_url}</div>
                        </td>
                        <td className="p-3 text-gray-700">{spot.fb_pixel_id}</td>
                        <td className="p-3 font-medium text-gray-900">{stat?.clicks_count ?? 0}</td>
                        <td className="p-3 font-medium text-emerald-700">{stat?.successful_conversions_count ?? 0}</td>
                        <td className="p-3">
                          <button
                            onClick={() => copyTrackingLink(spot.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            <span>{`/go/${spot.id}`}</span>
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => startEdit(spot)}
                              className="p-2 rounded border border-gray-300 hover:bg-gray-50"
                              title="Редактировать"
                            >
                              <Pencil className="w-4 h-4 text-gray-600" />
                            </button>
                            <button
                              onClick={() => removeSpot(spot)}
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
                  {!sortedSpots.length && (
                    <tr>
                      <td className="p-6 text-center text-gray-500" colSpan={6}>
                        Споты пока не созданы.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'analytics' && (
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-800 font-semibold mb-4">
              <Filter className="w-4 h-4" />
              <span>Фильтры</span>
            </div>
            <div className="grid lg:grid-cols-4 md:grid-cols-2 gap-3">
              <select
                value={spotFilterId}
                onChange={(e) => setSpotFilterId(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="all">Все споты</option>
                {sortedSpots.map((spot) => (
                  <option key={spot.id} value={String(spot.id)}>
                    {spot.name}
                  </option>
                ))}
              </select>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-md px-3 py-2 text-sm" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-md px-3 py-2 text-sm" />
              <button
                onClick={loadData}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" />
                Обновить
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500">Всего кликов</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{analyticsTotals.clicks}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500">Успешные конверсии</div>
              <div className="text-2xl font-bold text-emerald-700 mt-1">{analyticsTotals.success}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500">Conversion Rate</div>
              <div className="text-2xl font-bold text-blue-700 mt-1">
                {analyticsTotals.clicks ? ((analyticsTotals.success / analyticsTotals.clicks) * 100).toFixed(2) : '0.00'}%
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-sm font-semibold text-gray-900 mb-4">Daily Trend</div>
            <div className="space-y-3">
              {filteredAnalyticsRows.slice(-20).map((row) => (
                <div key={`${row.spot_id}-${row.day}`} className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>{row.day} — {row.spot_name}</span>
                    <span>Clicks: {row.clicks_count} | Success: {row.successful_conversions_count}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-2 rounded bg-gray-100 overflow-hidden">
                      <div
                        className="h-2 bg-blue-500"
                        style={{ width: `${Math.max(2, ((row.clicks_count || 0) / chartMax) * 100)}%` }}
                      />
                    </div>
                    <div className="h-2 rounded bg-gray-100 overflow-hidden">
                      <div
                        className="h-2 bg-emerald-500"
                        style={{ width: `${Math.max(2, ((row.successful_conversions_count || 0) / chartMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {!filteredAnalyticsRows.length && (
                <div className="text-sm text-gray-500">Нет данных для выбранных фильтров.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'postback' && (
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-800 font-semibold mb-4">
              <Filter className="w-4 h-4" />
              <span>Фильтры логов</span>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <select
                value={spotFilterId}
                onChange={(e) => setSpotFilterId(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="all">Все споты</option>
                {sortedSpots.map((spot) => (
                  <option key={spot.id} value={String(spot.id)}>
                    {spot.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="all">Все статусы</option>
                <option value="pending">pending</option>
                <option value="success">success</option>
                <option value="failed">failed</option>
              </select>
              <button
                onClick={loadData}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" />
                Обновить
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left p-3">Время</th>
                    <th className="text-left p-3">Spot</th>
                    <th className="text-left p-3">Click ID</th>
                    <th className="text-left p-3">Event</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Error</th>
                    <th className="text-right p-3">Retry</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPostbackRows.map((row) => (
                    <tr key={row.conversion_id} className="border-t border-gray-100 align-top">
                      <td className="p-3 text-xs text-gray-600 whitespace-nowrap">
                        {new Date(row.conversion_created_at).toLocaleString()}
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-gray-900">{row.spot_name}</div>
                        <div className="text-xs text-gray-500">#{row.spot_id}</div>
                      </td>
                      <td className="p-3 text-xs font-mono text-gray-700">{row.click_id}</td>
                      <td className="p-3 text-gray-700">{row.event_name}</td>
                      <td className="p-3">
                        <span
                          className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                            row.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700'
                              : row.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-red-600 max-w-xs">{row.error_message || '—'}</td>
                      <td className="p-3 text-right">
                        {row.status === 'failed' ? (
                          <button
                            onClick={() => createRetryTask(row)}
                            disabled={retryingConversionId === row.conversion_id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                          >
                            {retryingConversionId === row.conversion_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            Retry
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filteredPostbackRows.length && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-gray-500">
                        Логи постбэков пока отсутствуют.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
