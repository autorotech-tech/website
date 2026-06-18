import { useEffect, useState } from 'react'
import { Bookmark, RefreshCcw } from 'lucide-react'
import { bookmarksAgentApiBase } from '../bookmarksBro/agentApiBase'

const API_BASE = bookmarksAgentApiBase()
const API_KEY_STORAGE_KEY = 'bookmarksBro.agentApiKey'

type WorkspaceOption = {
  id: string
  name: string
}

export function AdminBookmarksBro() {
  const [workspaceId, setWorkspaceId] = useState('1')
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [jobId, setJobId] = useState('')
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workerStats, setWorkerStats] = useState<any>(null)
  const [enrichStats, setEnrichStats] = useState<any>(null)
  const [metrics, setMetrics] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('ai automation')
  const [searchSemantic, setSearchSemantic] = useState(true)
  const [searchResults, setSearchResults] = useState<any>(null)
  const [aiTask, setAiTask] = useState(
    'Нужно автоматизировать сбор лидов из Telegram и записывать их в CRM без ручного копирования.',
  )
  const [aiRecommend, setAiRecommend] = useState<any>(null)

  const parseApiResponse = async (response: Response) => {
    const raw = await response.text()
    let data: any = null
    let jsonOk = true
    if (raw.length === 0) {
      return { data: null, raw, jsonOk: true }
    }
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
      jsonOk = false
    }
    return { data, raw, jsonOk }
  }

  /** 200 + index.html (SPA) when /api/v1/ is not proxied — JSON.parse fails. */
  const assertJsonParsed = (response: Response, jsonOk: boolean, raw: string, label: string) => {
    if (!response.ok) return
    const ct = (response.headers.get('content-type') || '').toLowerCase()
    const head = (raw || '').trim().slice(0, 120)
    if (!jsonOk || ct.includes('text/html') || head.startsWith('<') || /^\s*<!doctype/i.test(head)) {
      throw new Error(
        `${label}: expected JSON, got ${!jsonOk ? 'non-JSON body' : 'HTML'} (npm dev: proxy /api/v1 → agent-api; prod: nginx; или задайте VITE_AGENT_API_BASE). Snippet: ${head.replace(/\s+/g, ' ')}`,
      )
    }
  }

  const extractApiError = (status: number, data: any, raw: string) => {
    if (data?.detail) return String(data.detail)
    if (raw && raw.trim().startsWith('<')) {
      return `Gateway/proxy returned HTML instead of JSON (HTTP ${status}). Try smaller worker batch.`
    }
    return raw || `HTTP ${status}`
  }

  useEffect(() => {
    try {
      const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY)
      if (savedKey) {
        setApiKey(savedKey)
      }
    } catch {
      // ignore localStorage access issues
    }
  }, [])

  useEffect(() => {
    try {
      if (apiKey) {
        localStorage.setItem(API_KEY_STORAGE_KEY, apiKey)
      } else {
        localStorage.removeItem(API_KEY_STORAGE_KEY)
      }
    } catch {
      // ignore localStorage access issues
    }
  }, [apiKey])

  const loadWorkspaces = async () => {
    setWorkspacesLoading(true)
    setError(null)
    try {
      if (!apiKey) {
        throw new Error('Enter Agent API Key first')
      }
      const response = await fetch(`${API_BASE}/api/v1/bookmarks/workspaces`, {
        headers: {
          'X-API-Key': apiKey,
        },
      })
      const { data, raw, jsonOk } = await parseApiResponse(response)
      if (!response.ok) {
        throw new Error(extractApiError(response.status, data, raw))
      }
      assertJsonParsed(response, jsonOk, raw, 'Workspaces')
      const options: WorkspaceOption[] = Array.isArray(data?.items) ? data.items : []

      setWorkspaceOptions(options)
      if (options.length === 0) {
        setWorkspaceOptions([{ id: workspaceId, name: `Workspace ${workspaceId}` }])
      } else if (!options.some((option) => option.id === workspaceId)) {
        setWorkspaceId(options[0].id)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load workspaces')
    } finally {
      setWorkspacesLoading(false)
    }
  }

  const loadJobStatus = async () => {
    if (!jobId) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/v1/bookmarks/sync/jobs/${jobId}`, {
        headers: {
          'X-API-Key': apiKey,
        },
      })
      const { data, raw, jsonOk } = await parseApiResponse(response)
      if (!response.ok) {
        throw new Error(extractApiError(response.status, data, raw))
      }
      assertJsonParsed(response, jsonOk, raw, 'Job status')
      setStatus(data)
    } catch (e: any) {
      setError(e.message || 'Failed to fetch job status')
    } finally {
      setLoading(false)
    }
  }

  const runWorkerBatch = async () => {
    if (!apiKey) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/v1/bookmarks/worker/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({ max_tasks: 25, workspaceId }),
      })
      const { data, raw, jsonOk } = await parseApiResponse(response)
      if (!response.ok) {
        throw new Error(extractApiError(response.status, data, raw))
      }
      assertJsonParsed(response, jsonOk, raw, 'Worker run')
      setWorkerStats(data)
    } catch (e: any) {
      setError(e.message || 'Worker run failed')
    } finally {
      setLoading(false)
    }
  }

  const runEnrichmentBatch = async () => {
    if (!apiKey) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/v1/bookmarks/enrich/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({ max_tasks: 50, workspaceId }),
      })
      const { data, raw, jsonOk } = await parseApiResponse(response)
      if (!response.ok) {
        throw new Error(extractApiError(response.status, data, raw))
      }
      assertJsonParsed(response, jsonOk, raw, 'Enrichment run')
      setEnrichStats(data)
    } catch (e: any) {
      setError(e.message || 'Enrichment run failed')
    } finally {
      setLoading(false)
    }
  }

  const runAiRecommend = async () => {
    if (!apiKey || !aiTask.trim()) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/v1/bookmarks/ai-recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          workspaceId,
          task: aiTask.trim(),
          retrieveLimit: 32,
          maxPicks: 10,
        }),
      })
      const { data, raw, jsonOk } = await parseApiResponse(response)
      if (!response.ok) {
        throw new Error(extractApiError(response.status, data, raw))
      }
      assertJsonParsed(response, jsonOk, raw, 'AI recommend')
      setAiRecommend(data)
    } catch (e: any) {
      setError(e.message || 'AI recommend failed')
    } finally {
      setLoading(false)
    }
  }

  const loadMetrics = async () => {
    if (!apiKey) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/v1/bookmarks/metrics?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: {
          'X-API-Key': apiKey,
        },
      })
      const { data, raw, jsonOk } = await parseApiResponse(response)
      if (!response.ok) {
        throw new Error(extractApiError(response.status, data, raw))
      }
      assertJsonParsed(response, jsonOk, raw, 'Metrics')
      setMetrics(data)
    } catch (e: any) {
      setError(e.message || 'Metrics load failed')
    } finally {
      setLoading(false)
    }
  }

  const runSearch = async () => {
    if (!apiKey || !searchQuery.trim()) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/v1/bookmarks/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          workspaceId,
          query: searchQuery.trim(),
          semantic: searchSemantic,
          limit: 20,
        }),
      })
      const { data, raw, jsonOk } = await parseApiResponse(response)
      if (!response.ok) {
        throw new Error(extractApiError(response.status, data, raw))
      }
      assertJsonParsed(response, jsonOk, raw, 'Search')
      setSearchResults(data)
    } catch (e: any) {
      setError(e.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bookmark className="w-6 h-6 text-indigo-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bookmarks Bro Operations</h1>
          <p className="text-sm text-gray-500">Operational panel for monitoring and running pipeline stages.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-4 max-w-3xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Workspace ID</span>
            <span className="block text-xs text-gray-500 mb-1">
              Используется в поиске, AI и в батчах Worker / Enrichment (только этот workspace).
            </span>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              list="workspace-options"
            />
            {workspaceOptions.length > 0 && (
              <datalist id="workspace-options">
                {workspaceOptions.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </datalist>
            )}
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Sync Job ID</span>
            <input
              className="w-full border rounded-lg px-3 py-2 mb-2"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="Paste Job ID from extension popup"
            />
            <span className="block text-gray-600 mb-1">Agent API Key</span>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="X-API-Key"
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">
          База Agent API:{' '}
          <code className="text-gray-700 break-all">
            {API_BASE ||
              '(пусто → относительный /api/v1; npm run dev проксирует на agent-api, см. .env.example)'}
          </code>
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={loadWorkspaces}
            disabled={loading || workspacesLoading}
            className="inline-flex items-center gap-2 bg-slate-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            {workspacesLoading ? 'Loading...' : 'Load Workspaces'}
          </button>
          <button
            onClick={loadJobStatus}
            disabled={loading || !apiKey || !jobId}
            className="inline-flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            Refresh Job Status
          </button>
          <button
            onClick={runWorkerBatch}
            disabled={loading || !apiKey}
            className="inline-flex items-center gap-2 bg-emerald-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            Run Worker Batch
          </button>
          <button
            onClick={runEnrichmentBatch}
            disabled={loading || !apiKey}
            className="inline-flex items-center gap-2 bg-violet-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            Run Enrichment
          </button>
          <button
            onClick={loadMetrics}
            disabled={loading || !apiKey}
            className="inline-flex items-center gap-2 bg-teal-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            Load Metrics
          </button>
        </div>

        {jobId && <p className="text-sm text-gray-600">Current Job ID: <code>{jobId}</code></p>}
        {workspaceOptions.length > 0 && (
          <p className="text-sm text-gray-600">
            Loaded workspaces: <strong>{workspaceOptions.length}</strong>
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="bg-white rounded-xl border p-5 max-w-3xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Operational Metrics</h2>
        {metrics == null ? (
          <p className="text-xs text-gray-500">Метрики еще не загружены.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-gray-50 p-3">
                <div className="text-xs text-gray-500">Jobs</div>
                <div className="text-xl font-semibold text-gray-900">{metrics?.jobs?.total_jobs ?? 0}</div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3">
                <div className="text-xs text-gray-500">Blocked</div>
                <div className="text-xl font-semibold text-amber-700">{metrics?.content?.blocked_total ?? 0}</div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3">
                <div className="text-xs text-gray-500">Failed</div>
                <div className="text-xl font-semibold text-rose-700">
                  {(metrics?.tasks?.failed_tasks ?? 0) + (metrics?.content?.failed_total ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3">
                <div className="text-xs text-gray-500">Enriched</div>
                <div className="text-xl font-semibold text-emerald-700">{metrics?.content?.enriched_total ?? 0}</div>
              </div>
            </div>
            <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
              {JSON.stringify(metrics, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border p-5 max-w-3xl">
        <h2 className="text-lg font-semibold text-gray-900">Sync job (latest)</h2>
        <p className="text-xs text-gray-500 mb-3 mt-1">
          Ответ <strong>GET sync/jobs/:id</strong>. Проверка состояния ingestion job из extension по Job ID.
        </p>
        <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
          {status == null
            ? 'Нет данных: укажите Job ID из extension и нажмите Refresh Job Status.'
            : JSON.stringify(status, null, 2)}
        </pre>
      </div>

      <div className="bg-white rounded-xl border p-5 max-w-3xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Last worker run</h2>
        <p className="text-xs text-gray-500 mb-3">
          Обработка очереди (fetch контента). <code className="text-gray-700">retry</code> +{' '}
          <code className="text-gray-700">429</code> — лимит Jina/HTTP; <code className="text-gray-700">422</code> — ответ
          провайдера не принят; повторите позже или уменьшите batch.
        </p>
        <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
          {workerStats == null ? 'No worker execution yet' : JSON.stringify(workerStats, null, 2)}
        </pre>
      </div>

      <div className="bg-white rounded-xl border p-5 max-w-3xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Last enrichment run</h2>
        <p className="text-xs text-gray-500 mb-3">
          LLM-сводка включается при ключах в <code className="text-gray-700">service_settings</code> или env; чтобы
          не вызывать LLM и оставить только локальные эвристики:{' '}
          <code className="text-gray-700">BOOKMARKS_AI_ENRICH=0</code> на agent-api.
        </p>
        <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
          {enrichStats == null ? 'No enrichment execution yet' : JSON.stringify(enrichStats, null, 2)}
        </pre>
      </div>

      <div className="bg-white rounded-xl border p-5 max-w-3xl space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">AI-подбор закладок под задачу</h2>
        <p className="text-xs text-gray-500">
          Векторный поиск по embedding (после Enrichment) + LLM ранжирует и объясняет. Ключи берутся из{' '}
          <code className="text-gray-700">service_settings</code> (админка Swoop: GLM, Gemini, OpenRouter и др.) или из{' '}
          <code className="text-gray-700">OPENAI_API_KEY</code> на agent-api.
        </p>
        <textarea
          className="w-full border rounded-lg px-3 py-2 text-sm min-h-[96px]"
          value={aiTask}
          onChange={(e) => setAiTask(e.target.value)}
          placeholder="Опишите задачу: что хотите сделать, контекст, ограничения..."
        />
        <button
          type="button"
          onClick={runAiRecommend}
          disabled={loading || !apiKey || aiTask.trim().length < 5}
          className="inline-flex items-center gap-2 bg-indigo-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Рекомендовать закладки
        </button>
        {aiRecommend == null ? (
          <div className="text-xs bg-gray-50 border rounded-lg p-3 text-gray-500">Ответ появится здесь.</div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-1">
                mode: {aiRecommend.retrievalMode || 'unknown'}
              </span>
              <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">
                candidates: {aiRecommend.candidateCount ?? 0}
              </span>
              <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">
                picks: {Array.isArray(aiRecommend.recommendations) ? aiRecommend.recommendations.length : 0}
              </span>
            </div>
            {aiRecommend.notice ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {aiRecommend.notice}
              </div>
            ) : null}
            {aiRecommend.overview ? (
              <div className="rounded-lg border bg-slate-50 px-3 py-3 text-sm text-slate-800">{aiRecommend.overview}</div>
            ) : null}
            {Array.isArray(aiRecommend.recommendations) && aiRecommend.recommendations.length > 0 ? (
              <div className="space-y-3">
                {aiRecommend.recommendations.map((item: any) => (
                  <div key={item.bookmarkId} className="rounded-xl border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-indigo-700 hover:underline break-all"
                        >
                          {item.title || item.url}
                        </a>
                        <div className="text-xs text-gray-500 break-all">{item.url}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-gray-500">Relevance</div>
                        <div className="text-sm font-semibold text-gray-900">
                          {typeof item.relevance === 'number' ? `${Math.round(item.relevance * 100)}%` : 'n/a'}
                        </div>
                      </div>
                    </div>
                    {item.reason ? <div className="text-sm text-gray-800">{item.reason}</div> : null}
                    {item.summary ? <div className="text-sm text-gray-600">{item.summary}</div> : null}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {item.category ? (
                        <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">{item.category}</span>
                      ) : null}
                      {typeof item.vectorDistance === 'number' ? (
                        <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">
                          distance: {item.vectorDistance.toFixed(4)}
                        </span>
                      ) : null}
                      {Array.isArray(item.tags)
                        ? item.tags.slice(0, 8).map((tag: string) => (
                            <span key={`${item.bookmarkId}-${tag}`} className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-1">
                              #{tag}
                            </span>
                          ))
                        : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs bg-gray-50 border rounded-lg p-3 text-gray-500">Подходящих рекомендаций пока нет.</div>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500">Raw JSON</summary>
              <pre className="mt-2 bg-gray-50 border rounded-lg p-3 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(aiRecommend, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border p-5 max-w-3xl space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Search smoke-test</h2>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="flex-1 border rounded-lg px-3 py-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search query"
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={searchSemantic}
              onChange={(e) => setSearchSemantic(e.target.checked)}
            />
            Semantic
          </label>
          <button
            onClick={runSearch}
            disabled={loading || !apiKey || !searchQuery.trim()}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Run Search
          </button>
        </div>
        <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
          {searchResults == null ? 'No search executed yet' : JSON.stringify(searchResults, null, 2)}
        </pre>
      </div>
    </div>
  )
}
