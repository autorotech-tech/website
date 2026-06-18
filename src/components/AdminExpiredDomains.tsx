import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  Globe2, Search, Loader2, AlertCircle, Download, Shield, TrendingUp,
  Filter, History, CheckCircle2, XCircle,
} from 'lucide-react'

const API_BASE = '/api/v1/expired-domains'

interface DomainList {
  id: string
  label: string
  group: string
}

interface DomainScores {
  keyword_score: number
  theme_score: number
  spam_score: number
  authority_score: number
  seo_prospect_score: number
  business_score: number
  passes_filters: boolean
}

interface DomainResult {
  domain: string
  metrics: Record<string, number | string>
  scores: DomainScores
  list_id: string
}

interface JobSummary {
  id: string
  created_at: string
  status: string
  result_count: number
  params?: Record<string, unknown>
  error_message?: string
  duration_ms?: number
}

function scoreColor(score: number, invert = false): string {
  const v = invert ? 100 - score : score
  if (v >= 75) return 'text-emerald-700 bg-emerald-50'
  if (v >= 50) return 'text-amber-700 bg-amber-50'
  return 'text-rose-700 bg-rose-50'
}

export function AdminExpiredDomains() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [agentApiKey, setAgentApiKey] = useState('')
  const [lists, setLists] = useState<DomainList[]>([])
  const [keywords, setKeywords] = useState('')
  const [businessTheme, setBusinessTheme] = useState('')
  const [listId, setListId] = useState('expiredcom')
  const [limit, setLimit] = useState(50)
  const [minTf, setMinTf] = useState<number | ''>('')
  const [minBl, setMinBl] = useState<number | ''>('')
  const [maxSpam, setMaxSpam] = useState<number | ''>(35)
  const [minBusiness, setMinBusiness] = useState<number | ''>(55)
  const [onlyCom, setOnlyCom] = useState(true)
  const [noNumbers, setNoNumbers] = useState(false)
  const [lastHours, setLastHours] = useState<number | ''>(24)
  const [sortBy, setSortBy] = useState('business_score')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<DomainResult[]>([])
  const [jobMeta, setJobMeta] = useState<{ id?: string; duration_ms?: number } | null>(null)
  const [history, setHistory] = useState<JobSummary[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [credOk, setCredOk] = useState<boolean | null>(null)
  const [checkingCreds, setCheckingCreds] = useState(false)

  const keywordList = useMemo(
    () => keywords.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean),
    [keywords],
  )

  const apiHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'X-API-Key': agentApiKey,
    }),
    [agentApiKey],
  )

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        const { data: auth } = await supabase.auth.getUser()
        if (!auth?.user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', auth.user.id)
          .single()
        const admin = profile?.role === 'admin'
        setIsAdmin(admin)
        if (!admin) return
        const { data: settings } = await supabase
          .from('service_settings')
          .select('agent_api_key')
          .eq('id', 1)
          .single()
        setAgentApiKey(String(settings?.agent_api_key || '').trim())
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!agentApiKey) return
    fetch(`${API_BASE}/lists`, { headers: { 'X-API-Key': agentApiKey } })
      .then((r) => r.json())
      .then((d) => setLists(d.lists || []))
      .catch(() => setLists([]))
    loadHistory()
  }, [agentApiKey])

  const loadHistory = async () => {
    if (!agentApiKey) return
    try {
      const res = await fetch(`${API_BASE}/jobs?limit=15`, { headers: { 'X-API-Key': agentApiKey } })
      const data = await res.json()
      setHistory(data.jobs || [])
    } catch {
      setHistory([])
    }
  }

  const verifyCredentials = async () => {
    if (!agentApiKey) {
      setError('Сначала задайте Agent API key в Settings')
      return
    }
    setCheckingCreds(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/verify-credentials`, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setCredOk(Boolean(data.ok))
      if (!data.ok) setError('Не удалось войти в member.expireddomains.net — проверьте логин/пароль в Settings')
    } catch (e: unknown) {
      setCredOk(false)
      setError(e instanceof Error ? e.message : 'Ошибка проверки credentials')
    } finally {
      setCheckingCreds(false)
    }
  }

  const runSearch = async () => {
    if (!agentApiKey) {
      setError('Agent API key не настроен (Settings → Scraping Agent)')
      return
    }
    if (!keywordList.length && !businessTheme.trim()) {
      setError('Укажите ключевые слова или тематику бизнеса')
      return
    }
    setSearching(true)
    setError(null)
    setResults([])
    setJobMeta(null)
    try {
      const body = {
        keywords: keywordList,
        business_theme: businessTheme.trim(),
        list_id: listId,
        limit,
        min_majestic_tf: minTf === '' ? undefined : Number(minTf),
        min_backlinks: minBl === '' ? undefined : Number(minBl),
        max_spam_score: maxSpam === '' ? undefined : Number(maxSpam),
        min_business_score: minBusiness === '' ? undefined : Number(minBusiness),
        only_com: onlyCom,
        no_numbers: noNumbers,
        last_hours: lastHours === '' ? undefined : Number(lastHours),
        sort_by: sortBy,
      }
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setResults(data.results || [])
      setJobMeta({ id: data.job_id, duration_ms: data.duration_ms })
      await loadHistory()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка поиска')
    } finally {
      setSearching(false)
    }
  }

  const exportCsv = () => {
    if (!results.length) return
    const header = [
      'domain', 'business_score', 'spam_score', 'authority_score', 'seo_prospect_score',
      'keyword_score', 'theme_score', 'majestic_tf', 'majestic_cf', 'backlinks', 'domain_pop',
    ]
    const lines = [header.join(',')]
    for (const row of results) {
      const m = row.metrics || {}
      const s = row.scores || {}
      lines.push([
        row.domain,
        s.business_score,
        s.spam_score,
        s.authority_score,
        s.seo_prospect_score,
        s.keyword_score,
        s.theme_score,
        m.majestic_tf ?? '',
        m.majestic_cf ?? '',
        m.backlinks ?? '',
        m.domain_pop ?? '',
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expired-domains-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Загрузка…
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-gray-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
        Доступ только для администраторов
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Globe2 className="w-7 h-7 text-orange-600" />
            Expired Domains Hunter
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Поиск истёкших доменов через member.expireddomains.net с оценкой по ключевым словам,
            spam score, авторитету (Majestic TF/CF) и перспективе в выдаче.
            Credentials — в <strong>Settings → ExpiredDomains.net</strong>.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={verifyCredentials}
            disabled={checkingCreds || !agentApiKey}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {checkingCreds ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Проверить вход
          </button>
          {credOk === true && <span className="text-emerald-600 text-sm flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> OK</span>}
          {credOk === false && <span className="text-rose-600 text-sm flex items-center gap-1"><XCircle className="w-4 h-4" /> Ошибка</span>}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white border rounded-lg p-4 space-y-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Filter className="w-4 h-4" /> Параметры поиска
          </h2>
          <div>
            <label className="text-sm font-medium text-gray-700">Ключевые слова (через запятую или с новой строки)</label>
            <textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              rows={3}
              placeholder="saas, marketing, auto, crypto…"
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Тематика бизнеса</label>
            <input
              value={businessTheme}
              onChange={(e) => setBusinessTheme(e.target.value)}
              placeholder="AI automation platform for marketers"
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Список доменов</label>
            <select value={listId} onChange={(e) => setListId(e.target.value)} className="mt-1 w-full border rounded-md px-3 py-2 text-sm">
              {(lists.length ? lists : [{ id: 'expiredcom', label: 'Expired .com', group: 'deleted' }]).map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Min TF</label>
              <input type="number" min={0} value={minTf} onChange={(e) => setMinTf(e.target.value === '' ? '' : Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600">Min BL</label>
              <input type="number" min={0} value={minBl} onChange={(e) => setMinBl(e.target.value === '' ? '' : Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600">Max spam</label>
              <input type="number" min={0} max={100} value={maxSpam} onChange={(e) => setMaxSpam(e.target.value === '' ? '' : Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600">Min business score</label>
              <input type="number" min={0} max={100} value={minBusiness} onChange={(e) => setMinBusiness(e.target.value === '' ? '' : Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyCom} onChange={(e) => setOnlyCom(e.target.checked)} /> только .com</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={noNumbers} onChange={(e) => setNoNumbers(e.target.checked)} /> без цифр</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Свежесть (часов)</label>
              <input type="number" value={lastHours} onChange={(e) => setLastHours(e.target.value === '' ? '' : Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600">Лимит</label>
              <input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600">Сортировка</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm">
              <option value="business_score">Business score</option>
              <option value="seo_prospect_score">SEO prospect</option>
              <option value="authority_score">Authority</option>
              <option value="keyword_score">Keyword match</option>
              <option value="spam_score">Spam (asc)</option>
            </select>
          </div>
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-60"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Найти домены
          </button>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Результаты {results.length ? `(${results.length})` : ''}
              {jobMeta?.duration_ms != null && (
                <span className="text-xs font-normal text-gray-500">{jobMeta.duration_ms} ms</span>
              )}
            </h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowHistory(!showHistory)} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50 inline-flex items-center gap-1">
                <History className="w-3.5 h-3.5" /> История
              </button>
              {results.length > 0 && (
                <button type="button" onClick={exportCsv} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50 inline-flex items-center gap-1">
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
              )}
            </div>
          </div>

          {showHistory && history.length > 0 && (
            <div className="bg-white border rounded-lg p-3 text-sm space-y-2 max-h-48 overflow-y-auto">
              {history.map((j) => (
                <div key={j.id} className="flex justify-between gap-2 border-b border-gray-100 pb-1">
                  <span className="text-gray-600">{new Date(j.created_at).toLocaleString()}</span>
                  <span>{j.status} · {j.result_count} доменов</span>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white border rounded-lg overflow-hidden">
            {!results.length && !searching && (
              <div className="p-8 text-center text-gray-500 text-sm">Задайте фильтры и запустите поиск</div>
            )}
            {searching && (
              <div className="p-8 text-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin inline mr-2" />Сканируем expireddomains.net…</div>
            )}
            {results.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Домен</th>
                      <th className="px-3 py-2">Business</th>
                      <th className="px-3 py-2">Spam</th>
                      <th className="px-3 py-2">Authority</th>
                      <th className="px-3 py-2">SEO</th>
                      <th className="px-3 py-2">TF</th>
                      <th className="px-3 py-2">CF</th>
                      <th className="px-3 py-2">BL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.domain} className="border-t hover:bg-gray-50/80">
                        <td className="px-3 py-2 font-mono text-gray-900">{row.domain}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${scoreColor(row.scores.business_score)}`}>
                            {row.scores.business_score}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${scoreColor(row.scores.spam_score, true)}`}>
                            {row.scores.spam_score}
                          </span>
                        </td>
                        <td className="px-3 py-2">{row.scores.authority_score}</td>
                        <td className="px-3 py-2">{row.scores.seo_prospect_score}</td>
                        <td className="px-3 py-2">{row.metrics.majestic_tf ?? '—'}</td>
                        <td className="px-3 py-2">{row.metrics.majestic_cf ?? '—'}</td>
                        <td className="px-3 py-2">{row.metrics.backlinks ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
