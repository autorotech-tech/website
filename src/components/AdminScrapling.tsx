import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  Globe2, Play, Loader2, AlertCircle, Download, Eye, X,
  RefreshCw, Sparkles, RotateCcw, Layers, Link2, Trash2,
  Plus, Save, FileSpreadsheet, Shield, RotateCw, ChevronDown, ChevronUp, Pencil, Fingerprint,
  Workflow, CheckCircle2, XCircle, Clock, HelpCircle, Wand2,
} from 'lucide-react'

type JobType = 'single' | 'batch' | 'crawl'
type Mode = 'fetcher' | 'stealth' | 'dynamic' | 'gologin'
type OutputFormat = 'markdown' | 'html' | 'text'

interface Progress {
  completed: number
  total: number
  errors: number
}

interface TemplateColumn {
  name: string
  selector: string
  attribute: string
}

interface Template {
  id: string
  created_at: string
  name: string
  columns: TemplateColumn[]
}

interface ProxyList {
  id: string
  created_at: string
  name: string
  proxies: string[]
  rotate_url?: string | null
}

interface ScraplingJob {
  id: string
  display_id?: number | null
  created_at: string
  url: string
  job_type: string
  urls?: string[] | null
  mode: string
  selector?: string | null
  output_format?: string | null
  impersonate?: string | null
  ai_prompt?: string | null
  crawl_depth?: number
  max_pages?: number
  link_selector?: string | null
  solve_cloudflare?: boolean
  network_idle?: boolean
  headless?: boolean
  proxy?: string | null
  progress?: Progress | null
  status: string
  result_path?: string | null
  result_preview?: string | null
  error_message?: string | null
  template_id?: string | null
  proxy_list_id?: string | null
  proxy_rotate_url?: string | null
}

const JOB_TYPE_LABELS: Record<JobType, string> = {
  single: 'URL',
  batch: 'Batch',
  crawl: 'Crawl',
}

type SettingsTab = 'job' | 'templates' | 'proxies' | 'gologin' | 'scenarios'

interface Scenario {
  id: string
  created_at: string
  updated_at: string
  name: string
  description: string
  yaml_content: string
}

interface ScenarioRun {
  id: string
  created_at: string
  scenario_id: string
  profile_ids: string[]
  concurrency: number
  status: string
  results: any
  started_at?: string | null
  completed_at?: string | null
  error_message?: string | null
}

interface GoLoginProfile {
  profile_id: string
  name: string
  custom_proxy: string
}

interface GoLoginConfig {
  api_token: string
  profiles: GoLoginProfile[]
  proxy_type: string
  default_country: string
  wait_until: string
  wait_timeout_sec: number
  gemini_api_key: string
}

const SCENARIO_YAML_TEMPLATE = `name: Example Scenario
randomize:
  delay: [800, 3000]
  mouse_jitter: true
  typing_speed: [40, 120]
  scroll_noise: true

steps:
  - navigate: "https://example.com"

  - wait: networkidle

  - if:
      exists: "#cookie-accept"
      then:
        - click: "#cookie-accept"
        - log: "Cookie banner closed"

  - extract:
      selector: "h1"
      save_as: "title"

  - log: "Done"
  - result: { status: "ok" }
`

export function AdminScrapling() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<ScraplingJob[]>([])

  const [jobType, setJobType] = useState<JobType>('single')
  const [url, setUrl] = useState('')
  const [batchUrls, setBatchUrls] = useState('')
  const [mode, setMode] = useState<Mode>('fetcher')
  const [selector, setSelector] = useState('')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('markdown')
  const [aiPrompt, setAiPrompt] = useState('')

  const [crawlDepth, setCrawlDepth] = useState(1)
  const [maxPages, setMaxPages] = useState(10)
  const [linkSelector, setLinkSelector] = useState('')

  const [impersonate, setImpersonate] = useState('')
  const [solveCloudflare, setSolveCloudflare] = useState(false)
  const [networkIdle, setNetworkIdle] = useState(false)
  const [headless, setHeadless] = useState(true)
  const [proxy, setProxy] = useState('')
  const [gologinCountry, setGologinCountry] = useState('')

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [selectedProxyListId, setSelectedProxyListId] = useState<string>('')
  const [proxyRotateUrl, setProxyRotateUrl] = useState('')

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewJob, setPreviewJob] = useState<ScraplingJob | null>(null)

  // Settings tabs
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('job')

  // Templates state
  const [templates, setTemplates] = useState<Template[]>([])
  const [tplName, setTplName] = useState('')
  const [tplColumns, setTplColumns] = useState<TemplateColumn[]>([
    { name: '', selector: '', attribute: '' },
  ])
  const [editingTplId, setEditingTplId] = useState<string | null>(null)
  const [savingTpl, setSavingTpl] = useState(false)

  // Proxy lists state
  const [proxyLists, setProxyLists] = useState<ProxyList[]>([])
  const [plName, setPlName] = useState('')
  const [plProxies, setPlProxies] = useState('')
  const [plRotateUrl, setPlRotateUrl] = useState('')
  const [editingPlId, setEditingPlId] = useState<string | null>(null)
  const [savingPl, setSavingPl] = useState(false)

  // GoLogin state
  const [glConfig, setGlConfig] = useState<GoLoginConfig>({
    api_token: '', profiles: [], proxy_type: 'residential',
    default_country: '', wait_until: 'networkidle', wait_timeout_sec: 60,
    gemini_api_key: '',
  })
  const [glNewProfile, setGlNewProfile] = useState({ profile_id: '', name: '', custom_proxy: '' })
  const [glSaving, setGlSaving] = useState(false)
  const [glSelectedProfile, setGlSelectedProfile] = useState('')
  const [glJobProxyType, setGlJobProxyType] = useState('')
  const [glJobWaitUntil, setGlJobWaitUntil] = useState('')

  // Scenarios state
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRun[]>([])
  const [scName, setScName] = useState('')
  const [scDescription, setScDescription] = useState('')
  const [scYaml, setScYaml] = useState(SCENARIO_YAML_TEMPLATE)
  const [editingScId, setEditingScId] = useState<string | null>(null)
  const [savingSc, setSavingSc] = useState(false)
  const [runProfileIds, setRunProfileIds] = useState<string[]>([])
  const [runConcurrency, setRunConcurrency] = useState(2)
  const [launchingSc, setLaunchingSc] = useState(false)
  const [selectedRunScenarioId, setSelectedRunScenarioId] = useState('')
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  // AI scenario generation
  const [aiGenUrl, setAiGenUrl] = useState('')
  const [aiGenPrompt, setAiGenPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  // FAQ
  const [showFaq, setShowFaq] = useState(false)

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('scrapling_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      setJobs((data || []) as ScraplingJob[])
    } catch (e) {
      console.error('Failed to fetch scrapling jobs', e)
    }
  }

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('scrapling_templates')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setTemplates((data || []) as Template[])
    } catch (e) {
      console.error('Failed to fetch templates', e)
    }
  }

  const fetchProxyLists = async () => {
    try {
      const { data, error } = await supabase
        .from('scrapling_proxy_lists')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setProxyLists((data || []) as ProxyList[])
    } catch (e) {
      console.error('Failed to fetch proxy lists', e)
    }
  }

  const fetchGologinConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('scrapling_gologin_config')
        .select('*')
        .eq('id', 1)
        .single()
      if (error) throw error
      if (data) {
        setGlConfig({
          api_token: data.api_token || '',
          profiles: (data.profiles || []) as GoLoginProfile[],
          proxy_type: data.proxy_type || 'residential',
          default_country: data.default_country || '',
          wait_until: data.wait_until || 'networkidle',
          wait_timeout_sec: data.wait_timeout_sec ?? 60,
          gemini_api_key: data.gemini_api_key || '',
        })
      }
    } catch (e) {
      console.error('Failed to fetch GoLogin config', e)
    }
  }

  const fetchScenarios = async () => {
    try {
      const { data, error } = await supabase
        .from('scrapling_scenarios')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setScenarios((data || []) as Scenario[])
    } catch (e) {
      console.error('Failed to fetch scenarios', e)
    }
  }

  const fetchScenarioRuns = async () => {
    try {
      const { data, error } = await supabase
        .from('scrapling_scenario_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      setScenarioRuns((data || []) as ScenarioRun[])
    } catch (e) {
      console.error('Failed to fetch scenario runs', e)
    }
  }

  const saveGologinConfig = async (patch: Partial<GoLoginConfig>) => {
    setGlSaving(true)
    try {
      const updated = { ...glConfig, ...patch, updated_at: new Date().toISOString() }
      const { error } = await supabase
        .from('scrapling_gologin_config')
        .upsert({ id: 1, ...updated })
      if (error) throw error
      setGlConfig(updated as GoLoginConfig)
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения GoLogin конфигурации')
    } finally {
      setGlSaving(false)
    }
  }

  const addGlProfile = () => {
    if (!glNewProfile.profile_id.trim()) return
    const updated = [...glConfig.profiles, { ...glNewProfile, profile_id: glNewProfile.profile_id.trim(), name: glNewProfile.name.trim(), custom_proxy: glNewProfile.custom_proxy.trim() }]
    saveGologinConfig({ profiles: updated })
    setGlNewProfile({ profile_id: '', name: '', custom_proxy: '' })
  }

  const removeGlProfile = (pid: string) => {
    saveGologinConfig({ profiles: glConfig.profiles.filter(p => p.profile_id !== pid) })
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: auth } = await supabase.auth.getUser()
        const user = auth?.user
        if (!user) { setLoading(false); return }
        const { data: profile } = await supabase
          .from('profiles').select('role').eq('id', user.id).single()
        const admin = profile?.role === 'admin'
        setIsAdmin(admin)
        if (!admin) { setLoading(false); return }
        await Promise.all([fetchJobs(), fetchTemplates(), fetchProxyLists(), fetchGologinConfig(), fetchScenarios(), fetchScenarioRuns()])
      } catch (e: any) {
        setError(e.message || 'Не удалось загрузить данные')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    const interval = setInterval(() => { fetchJobs(); fetchScenarioRuns() }, 4000)
    return () => clearInterval(interval)
  }, [isAdmin])

  const batchUrlList = batchUrls
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.length > 0)

  // -----------------------------------------------------------------------
  // Job creation
  // -----------------------------------------------------------------------
  const createJob = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    let primaryUrl = ''
    let urlsPayload: string[] | null = null

    if (jobType === 'batch') {
      if (batchUrlList.length === 0) {
        setError('Введите хотя бы один URL')
      return
    }
      for (const u of batchUrlList) {
        try { new URL(u) } catch {
          setError(`Неверный URL: ${u}`)
      return
        }
      }
      primaryUrl = batchUrlList[0]
      urlsPayload = batchUrlList
    } else {
      if (!url.trim()) { setError('Введите URL'); return }
      try { new URL(url.trim()) } catch { setError('Неверный формат URL'); return }
      primaryUrl = url.trim()
    }

    setCreating(true)
    try {
      const { data: auth } = await supabase.auth.getUser()
      const payload: any = {
        url: primaryUrl,
        job_type: jobType,
        mode,
        selector: selector.trim() || null,
        output_format: outputFormat,
        ai_prompt: aiPrompt.trim() || null,
        impersonate: impersonate.trim() || null,
        solve_cloudflare: solveCloudflare,
        network_idle: networkIdle,
        headless,
        proxy: mode === 'gologin' ? (gologinCountry || null) : (proxy.trim() || null),
        template_id: selectedTemplateId || null,
        proxy_list_id: mode === 'gologin' ? null : (selectedProxyListId || null),
        proxy_rotate_url: proxyRotateUrl.trim() || null,
        gologin_profile_id: mode === 'gologin' ? (glSelectedProfile || null) : null,
        gologin_proxy_type: mode === 'gologin' ? (glJobProxyType || null) : null,
        gologin_wait_until: mode === 'gologin' ? (glJobWaitUntil || null) : null,
        status: 'queued',
      }

      if (urlsPayload) payload.urls = urlsPayload
      if (jobType === 'crawl') {
        payload.crawl_depth = crawlDepth
        payload.max_pages = maxPages
        payload.link_selector = linkSelector.trim() || null
      }
      if (auth?.user) payload.created_by = auth.user.id

      const { error } = await supabase.from('scrapling_jobs').insert(payload)
      if (error) throw error
      setUrl('')
      setBatchUrls('')
      setSelector('')
      setAiPrompt('')
      await fetchJobs()
    } catch (e: any) {
      setError(e.message || 'Не удалось создать задачу')
    } finally {
      setCreating(false)
    }
  }

  // -----------------------------------------------------------------------
  // Template CRUD
  // -----------------------------------------------------------------------
  const addTplColumn = () => {
    setTplColumns([...tplColumns, { name: '', selector: '', attribute: '' }])
  }

  const updateTplColumn = (idx: number, field: keyof TemplateColumn, val: string) => {
    const next = [...tplColumns]
    next[idx] = { ...next[idx], [field]: val }
    setTplColumns(next)
  }

  const removeTplColumn = (idx: number) => {
    setTplColumns(tplColumns.filter((_, i) => i !== idx))
  }

  const resetTplForm = () => {
    setTplName('')
    setTplColumns([{ name: '', selector: '', attribute: '' }])
    setEditingTplId(null)
  }

  const loadTplForEdit = (tpl: Template) => {
    setEditingTplId(tpl.id)
    setTplName(tpl.name)
    setTplColumns(
      (tpl.columns || []).length > 0
        ? tpl.columns.map((c) => ({ name: c.name || '', selector: c.selector || '', attribute: c.attribute || '' }))
        : [{ name: '', selector: '', attribute: '' }]
    )
    setSettingsTab('templates')
  }

  const saveTemplate = async () => {
    if (!tplName.trim()) { setError('Укажите название шаблона'); return }
    const validCols = tplColumns.filter((c) => c.name.trim() && c.selector.trim())
    if (validCols.length === 0) { setError('Добавьте хотя бы одну колонку с названием и селектором'); return }

    setSavingTpl(true)
    setError(null)
    try {
      const { data: auth } = await supabase.auth.getUser()
      const payload = {
        name: tplName.trim(),
        columns: validCols,
        ...(auth?.user ? { created_by: auth.user.id } : {}),
      }

      if (editingTplId) {
        const { error } = await supabase.from('scrapling_templates').update(payload).eq('id', editingTplId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('scrapling_templates').insert(payload)
        if (error) throw error
      }
      resetTplForm()
      await fetchTemplates()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingTpl(false)
    }
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Удалить шаблон?')) return
    try {
      const { error } = await supabase.from('scrapling_templates').delete().eq('id', id)
      if (error) throw error
      if (selectedTemplateId === id) setSelectedTemplateId('')
      await fetchTemplates()
    } catch (e: any) { setError(e.message) }
  }

  // -----------------------------------------------------------------------
  // Proxy list CRUD
  // -----------------------------------------------------------------------
  const resetPlForm = () => {
    setPlName('')
    setPlProxies('')
    setPlRotateUrl('')
    setEditingPlId(null)
  }

  const loadPlForEdit = (pl: ProxyList) => {
    setEditingPlId(pl.id)
    setPlName(pl.name)
    setPlProxies((pl.proxies || []).join('\n'))
    setPlRotateUrl(pl.rotate_url || '')
    setSettingsTab('proxies')
  }

  const saveProxyList = async () => {
    if (!plName.trim()) { setError('Укажите название списка прокси'); return }
    const proxies = plProxies
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    if (proxies.length === 0) { setError('Добавьте хотя бы один прокси'); return }

    setSavingPl(true)
    setError(null)
    try {
      const { data: auth } = await supabase.auth.getUser()
      const payload = {
        name: plName.trim(),
        proxies,
        rotate_url: plRotateUrl.trim() || null,
        ...(auth?.user ? { created_by: auth.user.id } : {}),
      }

      if (editingPlId) {
        const { error } = await supabase.from('scrapling_proxy_lists').update(payload).eq('id', editingPlId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('scrapling_proxy_lists').insert(payload)
        if (error) throw error
      }
      resetPlForm()
      await fetchProxyLists()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingPl(false)
    }
  }

  const deleteProxyList = async (id: string) => {
    if (!confirm('Удалить список прокси?')) return
    try {
      const { error } = await supabase.from('scrapling_proxy_lists').delete().eq('id', id)
      if (error) throw error
      if (selectedProxyListId === id) setSelectedProxyListId('')
      await fetchProxyLists()
    } catch (e: any) { setError(e.message) }
  }

  // -----------------------------------------------------------------------
  // Scenario CRUD
  // -----------------------------------------------------------------------
  const resetScForm = () => {
    setScName('')
    setScDescription('')
    setScYaml(SCENARIO_YAML_TEMPLATE)
    setEditingScId(null)
  }

  const loadScForEdit = (sc: Scenario) => {
    setEditingScId(sc.id)
    setScName(sc.name)
    setScDescription(sc.description || '')
    setScYaml(sc.yaml_content)
    setSettingsTab('scenarios')
  }

  const saveScenario = async () => {
    if (!scName.trim()) { setError('Укажите название сценария'); return }
    if (!scYaml.trim()) { setError('Укажите YAML сценария'); return }

    setSavingSc(true)
    setError(null)
    try {
      const { data: auth } = await supabase.auth.getUser()
      const payload = {
        name: scName.trim(),
        description: scDescription.trim(),
        yaml_content: scYaml,
        updated_at: new Date().toISOString(),
        ...(auth?.user ? { created_by: auth.user.id } : {}),
      }

      if (editingScId) {
        const { error } = await supabase.from('scrapling_scenarios').update(payload).eq('id', editingScId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('scrapling_scenarios').insert(payload)
        if (error) throw error
      }
      resetScForm()
      await fetchScenarios()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingSc(false)
    }
  }

  const deleteScenario = async (id: string) => {
    if (!confirm('Удалить сценарий и все его запуски?')) return
    try {
      const { error } = await supabase.from('scrapling_scenarios').delete().eq('id', id)
      if (error) throw error
      await fetchScenarios()
      await fetchScenarioRuns()
    } catch (e: any) { setError(e.message) }
  }

  const launchScenario = async () => {
    if (!selectedRunScenarioId) { setError('Выберите сценарий'); return }
    if (runProfileIds.length === 0 && glConfig.profiles.length === 0) {
      setError('Нет профилей для запуска. Добавьте профили во вкладке GoLogin')
      return
    }

    setLaunchingSc(true)
    setError(null)
    try {
      const { data: auth } = await supabase.auth.getUser()
      const pids = runProfileIds.length > 0 ? runProfileIds : glConfig.profiles.map(p => p.profile_id)
      const { error } = await supabase.from('scrapling_scenario_runs').insert({
        scenario_id: selectedRunScenarioId,
        profile_ids: pids,
        concurrency: Math.max(1, runConcurrency),
        status: 'queued',
        ...(auth?.user ? { created_by: auth.user.id } : {}),
      })
      if (error) throw error
      await fetchScenarioRuns()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLaunchingSc(false)
    }
  }

  const deleteScenarioRun = async (id: string) => {
    if (!confirm('Удалить запуск?')) return
    try {
      const { error } = await supabase.from('scrapling_scenario_runs').delete().eq('id', id)
      if (error) throw error
      await fetchScenarioRuns()
    } catch (e: any) { setError(e.message) }
  }

  const generateScenarioAI = async () => {
    const key = glConfig.gemini_api_key
    if (!key) { setError('Gemini API Key не настроен. Укажите его во вкладке GoLogin.'); return }
    if (!aiGenPrompt.trim()) { setError('Опишите, что должен делать сценарий'); return }

    setGenerating(true)
    setError(null)
    try {
      const systemPrompt = `You are a browser automation expert. Generate a YAML scenario for Playwright browser automation via GoLogin anti-detect profiles.

Available step types:
- navigate: "url"
- click: "selector" or {selector: "...", wait_after: ms}
- fill: {selector: "...", text: "...", human_typing: true}
- type: {selector: "...", text: "..."}
- select: {selector: "...", value: "..."}
- hover: "selector"
- wait: "networkidle" | "domcontentloaded" | "load" | selector_string
- delay: [min_ms, max_ms] or fixed_ms
- extract: {selector: "...", attribute: "...", save_as: "key"}
- scroll: "bottom" | "top" | pixels | {selector: "..."}
- evaluate: "js code"
- keyboard: "Enter" | "Tab" etc
- log: "message"
- result: {status: "ok"}
- if: {exists: "selector", then: [...steps], else: [...steps]}

Randomize section:
  delay: [min_ms, max_ms]
  mouse_jitter: true/false
  typing_speed: [min_ms, max_ms]
  scroll_noise: true/false

Generate ONLY valid YAML. No explanations, no markdown fences. Just raw YAML.
Include a randomize section with realistic human-like values.
Always start with a navigate step if a URL is provided.`

      const userMsg = aiGenUrl.trim()
        ? `Target URL: ${aiGenUrl.trim()}\n\nTask: ${aiGenPrompt.trim()}`
        : `Task: ${aiGenPrompt.trim()}`

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userMsg }] },
            ],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
          }),
        }
      )

      if (!resp.ok) {
        const errData = await resp.json().catch(() => null)
        throw new Error(errData?.error?.message || `Gemini API error: ${resp.status}`)
      }

      const data = await resp.json()
      let yaml = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      yaml = yaml.replace(/^```ya?ml\s*/i, '').replace(/```\s*$/i, '').trim()

      if (!yaml) throw new Error('Gemini вернул пустой ответ')

      setScYaml(yaml)
      if (!scName.trim() && aiGenPrompt.trim()) {
        setScName(aiGenPrompt.trim().slice(0, 60))
      }
    } catch (e: any) {
      setError(e.message || 'Ошибка генерации сценария')
    } finally {
      setGenerating(false)
    }
  }

  const toggleRunProfile = (pid: string) => {
    setRunProfileIds(prev =>
      prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
    )
  }

  // -----------------------------------------------------------------------
  // Job actions
  // -----------------------------------------------------------------------
  const retryJob = async (jobId: string) => {
    try {
      const { error } = await supabase
        .from('scrapling_jobs')
        .update({ status: 'queued', error_message: null, result_path: null, result_preview: null, progress: null })
        .eq('id', jobId)
      if (error) throw error
      await fetchJobs()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const deleteJob = async (jobId: string) => {
    if (!confirm('Удалить задачу?')) return
    try {
      const { error } = await supabase.from('scrapling_jobs').delete().eq('id', jobId)
      if (error) throw error
      await fetchJobs()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const downloadResult = async (job: ScraplingJob) => {
    if (!job.result_path) return
    try {
      const { data, error } = await supabase.storage
        .from('user_uploads')
        .createSignedUrl(job.result_path, 60)
      if (error || !data) throw error || new Error('No signed URL')
      const link = document.createElement('a')
      link.href = data.signedUrl
      link.download = job.result_path.split('/').pop() || 'result.txt'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (e) {
      console.error('Download failed', e)
      setError('Не удалось скачать результат')
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-700">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Загрузка…</span>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-4 text-red-600 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        <span>Доступ только для администраторов</span>
      </div>
    )
  }

  const statusBadge = (status: string) => {
    const s = (status || 'queued').toLowerCase()
    const cls = s === 'done'
      ? 'bg-green-50 border-green-200 text-green-700'
      : s === 'error'
        ? 'bg-red-50 border-red-200 text-red-700'
        : s === 'running'
          ? 'bg-blue-50 border-blue-200 text-blue-700'
          : 'bg-gray-50 border-gray-200 text-gray-700'
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] gap-1 ${cls}`}>
        {s === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
        {s === 'error' && <AlertCircle className="w-3 h-3" />}
        <span>{status || 'queued'}</span>
      </span>
    )
  }

  const typeBadge = (jt: string) => {
    const cls = jt === 'batch'
      ? 'bg-purple-50 border-purple-200 text-purple-700'
      : jt === 'crawl'
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-gray-50 border-gray-200 text-gray-500'
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls}`}>
        {jt === 'batch' && <Layers className="w-2.5 h-2.5 mr-0.5" />}
        {jt === 'crawl' && <Link2 className="w-2.5 h-2.5 mr-0.5" />}
        {(JOB_TYPE_LABELS as any)[jt] || jt}
      </span>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Globe2 className="w-6 h-6 text-blue-600" />
          Web Scraping & Automation
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Единый сервис скрапинга и автоматизации: парсинг контента через Scrapling или GoLogin Cloud Browser,
          CSV-шаблоны, прокси-ротация, AI-извлечение данных (Gemini) и сценарии автоматизации в браузерных профилях.
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

      {/* Section tabs: Job / Templates / Proxies / GoLogin */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {([
          { key: 'job' as SettingsTab, label: 'Новая задача', icon: Play },
          { key: 'templates' as SettingsTab, label: 'CSV-шаблоны', icon: FileSpreadsheet },
          { key: 'proxies' as SettingsTab, label: 'Прокси', icon: Shield },
          { key: 'gologin' as SettingsTab, label: 'GoLogin', icon: Fingerprint },
          { key: 'scenarios' as SettingsTab, label: 'Сценарии', icon: Workflow },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSettingsTab(key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm transition-all ${
              settingsTab === key
                ? 'bg-white shadow-sm text-gray-900 font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB: New Job */}
      {/* ================================================================ */}
      {settingsTab === 'job' && (
      <form onSubmit={createJob} className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          {/* Job type tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {(['single', 'batch', 'crawl'] as JobType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setJobType(t)}
                className={`px-4 py-1.5 rounded-md text-sm transition-all ${
                  jobType === t
                    ? 'bg-white shadow-sm text-gray-900 font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'single' && 'URL'}
                {t === 'batch' && 'Batch (пакет)'}
                {t === 'crawl' && 'Crawl (краулинг)'}
              </button>
            ))}
          </div>

          {/* URL input */}
          {jobType === 'single' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/page"
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          )}

          {jobType === 'batch' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URLs (по одному на строку)
              </label>
              <textarea
                value={batchUrls}
                onChange={(e) => setBatchUrls(e.target.value)}
                placeholder={'https://example.com/page1\nhttps://example.com/page2\nhttps://example.com/page3'}
                rows={5}
                className="w-full border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                {batchUrlList.length} URL{batchUrlList.length !== 1 ? 's' : ''} для обработки
              </p>
        </div>
          )}

          {jobType === 'crawl' && (
            <div className="space-y-3">
          <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Начальный URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/"
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Глубина (depth)</label>
                  <input
                    type="number" min={1} max={5}
                    value={crawlDepth}
                    onChange={(e) => setCrawlDepth(Math.min(5, Math.max(1, Number(e.target.value))))}
              className="w-full border rounded-md px-3 py-2 text-sm"
                  />
          </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Макс. страниц</label>
                  <input
                    type="number" min={1} max={100}
                    value={maxPages}
                    onChange={(e) => setMaxPages(Math.min(100, Math.max(1, Number(e.target.value))))}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Селектор ссылок</label>
                  <input
                    type="text"
                    value={linkSelector}
                    onChange={(e) => setLinkSelector(e.target.value)}
                    placeholder=".pagination a, .product-link"
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Common settings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Режим</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="w-full border rounded-md px-3 py-2 text-sm">
                <option value="fetcher">Fetcher — быстрый HTTP</option>
                <option value="stealth">Stealth — обход Cloudflare</option>
                <option value="dynamic">Dynamic — JS/SPA рендеринг</option>
                <option value="gologin">GoLogin — анти-детект Cloud Browser</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Формат вывода</label>
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as OutputFormat)} className="w-full border rounded-md px-3 py-2 text-sm">
                <option value="markdown">Markdown (.md)</option>
                <option value="html">HTML (.html)</option>
                <option value="text">Текст (.txt)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CSS / XPath селектор</label>
            <input
              type="text"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
                placeholder=".product или //div[@class='item']"
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* GoLogin per-job settings */}
          {mode === 'gologin' && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-violet-700">
                <Fingerprint className="w-4 h-4" />
                GoLogin Cloud Browser — настройки задачи
              </div>
              {!glConfig.api_token && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                  API Token не настроен. Перейдите во вкладку «GoLogin» для конфигурации.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Profile selector */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Профиль</label>
                  <select
                    value={glSelectedProfile}
                    onChange={(e) => setGlSelectedProfile(e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">Авто (первый / временный)</option>
                    {glConfig.profiles.map(p => (
                      <option key={p.profile_id} value={p.profile_id}>
                        {p.name || p.profile_id}
                        {p.custom_proxy ? ' 🔒' : ''}
                      </option>
                    ))}
                  </select>
          </div>

                {/* Country override */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Страна прокси</label>
                  <select
                    value={gologinCountry}
                    onChange={(e) => setGologinCountry(e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">По умолчанию ({glConfig.default_country || 'нет'})</option>
                    <option value="us">🇺🇸 US</option>
                    <option value="gb">🇬🇧 GB</option>
                    <option value="de">🇩🇪 DE</option>
                    <option value="fr">🇫🇷 FR</option>
                    <option value="nl">🇳🇱 NL</option>
                    <option value="ca">🇨🇦 CA</option>
                    <option value="au">🇦🇺 AU</option>
                    <option value="jp">🇯🇵 JP</option>
                    <option value="kr">🇰🇷 KR</option>
                    <option value="sg">🇸🇬 SG</option>
                    <option value="in">🇮🇳 IN</option>
                    <option value="br">🇧🇷 BR</option>
                    <option value="mx">🇲🇽 MX</option>
                    <option value="it">🇮🇹 IT</option>
                    <option value="es">🇪🇸 ES</option>
                    <option value="pl">🇵🇱 PL</option>
                    <option value="tr">🇹🇷 TR</option>
                    <option value="ua">🇺🇦 UA</option>
                    <option value="ru">🇷🇺 RU</option>
                    <option value="se">🇸🇪 SE</option>
                    <option value="ch">🇨🇭 CH</option>
                    <option value="il">🇮🇱 IL</option>
                    <option value="ae">🇦🇪 AE</option>
                    <option value="hk">🇭🇰 HK</option>
                  </select>
        </div>

                {/* Proxy type override */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Тип прокси</label>
                  <select
                    value={glJobProxyType}
                    onChange={(e) => setGlJobProxyType(e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">По умолчанию ({glConfig.proxy_type})</option>
                    <option value="residential">Residential</option>
                    <option value="mobile">Mobile</option>
                  </select>
                </div>

                {/* Wait until override */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ожидание</label>
                  <select
                    value={glJobWaitUntil}
                    onChange={(e) => setGlJobWaitUntil(e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">По умолчанию ({glConfig.wait_until})</option>
                    <option value="networkidle">Network Idle</option>
                    <option value="domcontentloaded">DOM Content Loaded</option>
                    <option value="load">Load</option>
                    <option value="commit">Commit</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                При выборе профиля с пользовательским прокси (🔒) — страна GoLogin не используется.
                Если профилей нет — создаётся временный.
              </p>
            </div>
          )}

          {/* CSV Template selector */}
          {templates.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  CSV-шаблон извлечения
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Без шаблона (raw контент)</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({(t.columns || []).length} колонок)
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-400">
                  При выборе шаблона результат будет в CSV с заданными колонками
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-indigo-600" />
                  Список прокси
                </label>
                <select
                  value={selectedProxyListId}
                  onChange={(e) => setSelectedProxyListId(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Без списка прокси</option>
                  {proxyLists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name} ({(pl.proxies || []).length} прокси{pl.rotate_url ? ', rotate' : ''})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-400">
                  Прокси будут чередоваться при batch/crawl
                </p>
              </div>
            </div>
          )}

          {/* AI prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              AI-промпт для извлечения данных
            </label>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Опишите что извлечь. Например: «Извлеки название товара, цену и ссылку на изображение в формате таблицы»"
              rows={2}
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {selectedTemplateId
                ? 'AI-промпт игнорируется при использовании CSV-шаблона'
                : 'AI проанализирует контент каждой страницы и извлечёт данные по запросу (Gemini)'}
            </p>
          </div>

          {/* Advanced settings */}
          <div>
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showAdvanced ? 'Скрыть дополнительные настройки' : 'Дополнительные настройки'}
            </button>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-3 bg-gray-50 rounded-md">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Impersonate</label>
                <select value={impersonate} onChange={(e) => setImpersonate(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
                  <option value="">По умолчанию</option>
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="safari">Safari</option>
                  <option value="edge">Edge</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Proxy (одиночный)</label>
                <input
                  type="text" value={proxy} onChange={(e) => setProxy(e.target.value)}
                  placeholder="http://user:pass@proxy:8080"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                  <RotateCw className="w-3 h-3 text-indigo-500" />
                  Rotate Proxy URL
                </label>
                <input
                  type="text" value={proxyRotateUrl} onChange={(e) => setProxyRotateUrl(e.target.value)}
                  placeholder="https://provider.com/api/rotate?key=..."
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[10px] text-gray-400">URL для смены IP у провайдера прокси</p>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={solveCloudflare} onChange={(e) => setSolveCloudflare(e.target.checked)} className="rounded border-gray-300" />
                  <span className="text-gray-700">Обход Cloudflare</span>
                  <span className="text-[10px] text-gray-400">(Stealth)</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={networkIdle} onChange={(e) => setNetworkIdle(e.target.checked)} className="rounded border-gray-300" />
                  <span className="text-gray-700">Network Idle</span>
                  <span className="text-[10px] text-gray-400">(Dynamic)</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} className="rounded border-gray-300" />
                  <span className="text-gray-700">Headless</span>
                  <span className="text-[10px] text-gray-400">(Stealth/Dynamic)</span>
                </label>
              </div>
            </div>
          )}

        <div className="flex justify-end">
          <button
              type="submit" disabled={creating}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {creating ? 'Создание…' : 'Запустить'}
          </button>
        </div>
      </form>
      )}

      {/* ================================================================ */}
      {/* TAB: CSV Templates */}
      {/* ================================================================ */}
      {settingsTab === 'templates' && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            CSV-шаблоны извлечения
          </h2>
          <p className="text-sm text-gray-500">
            Шаблон определяет колонки CSV-файла. Каждая колонка извлекается со страницы через CSS/XPath-селектор.
            Опционально можно указать атрибут (href, src и т.д.) — иначе берётся текст.
          </p>

          {/* Template form */}
          <div className="space-y-3 p-3 bg-gray-50 rounded-md">
            <div className="flex items-center gap-3">
              <input
                type="text" value={tplName} onChange={(e) => setTplName(e.target.value)}
                placeholder="Название шаблона"
                className="flex-1 border rounded-md px-3 py-2 text-sm"
              />
              {editingTplId && (
                <button onClick={resetTplForm} className="text-xs text-gray-500 hover:text-gray-700">Отмена</button>
              )}
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_120px_32px] gap-2 text-[11px] font-medium text-gray-500 px-1">
                <span>Название колонки</span>
                <span>CSS / XPath селектор</span>
                <span>Атрибут</span>
                <span />
              </div>
              {tplColumns.map((col, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_120px_32px] gap-2">
                  <input
                    type="text" value={col.name} onChange={(e) => updateTplColumn(idx, 'name', e.target.value)}
                    placeholder="Название" className="border rounded px-2 py-1.5 text-sm"
                  />
                  <input
                    type="text" value={col.selector} onChange={(e) => updateTplColumn(idx, 'selector', e.target.value)}
                    placeholder=".price, h1, //a" className="border rounded px-2 py-1.5 text-sm font-mono"
                  />
                  <input
                    type="text" value={col.attribute} onChange={(e) => updateTplColumn(idx, 'attribute', e.target.value)}
                    placeholder="href, src…" className="border rounded px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button" onClick={() => removeTplColumn(idx)}
                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                    disabled={tplColumns.length <= 1}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button" onClick={addTplColumn}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Добавить колонку
              </button>
              <div className="flex-1" />
              <button
                type="button" onClick={saveTemplate} disabled={savingTpl}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {savingTpl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingTplId ? 'Обновить' : 'Сохранить шаблон'}
              </button>
            </div>
          </div>

          {/* Existing templates */}
          {templates.length > 0 && (
            <div className="divide-y">
              {templates.map((tpl) => (
                <div key={tpl.id} className="py-3 flex items-start gap-3">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{tpl.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {(tpl.columns || []).map((c) => c.name).join(', ')}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(tpl.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => loadTplForEdit(tpl)} className="p-1 rounded hover:bg-gray-100" title="Редактировать">
                      <Pencil className="w-3.5 h-3.5 text-gray-500" />
                    </button>
                    <button onClick={() => deleteTemplate(tpl.id)} className="p-1 rounded hover:bg-gray-100" title="Удалить">
                      <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {templates.length === 0 && (
            <p className="text-sm text-gray-400">Шаблонов пока нет. Создайте первый выше.</p>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Proxy Lists */}
      {/* ================================================================ */}
      {settingsTab === 'proxies' && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            Списки прокси
          </h2>
          <p className="text-sm text-gray-500">
            Прокси из списка чередуются при обработке нескольких страниц (batch/crawl).
            Если провайдер поддерживает смену IP через API — укажите Rotate URL.
          </p>

          {/* Proxy list form */}
          <div className="space-y-3 p-3 bg-gray-50 rounded-md">
            <div className="flex items-center gap-3">
              <input
                type="text" value={plName} onChange={(e) => setPlName(e.target.value)}
                placeholder="Название списка"
                className="flex-1 border rounded-md px-3 py-2 text-sm"
              />
              {editingPlId && (
                <button onClick={resetPlForm} className="text-xs text-gray-500 hover:text-gray-700">Отмена</button>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Прокси (по одному на строку)
              </label>
              <textarea
                value={plProxies} onChange={(e) => setPlProxies(e.target.value)}
                placeholder={'http://user:pass@proxy1:8080\nhttp://user:pass@proxy2:8080\nsocks5://user:pass@proxy3:1080'}
                rows={4}
                className="w-full border rounded-md px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-indigo-500" />
                Rotate URL (опционально)
              </label>
              <input
                type="text" value={plRotateUrl} onChange={(e) => setPlRotateUrl(e.target.value)}
                placeholder="https://provider.com/api/rotate?key=abc123"
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                GET-запрос на этот URL будет отправляться перед каждым запросом для смены IP.
                Используйте если провайдер прокси поддерживает ротацию IP через API.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button" onClick={saveProxyList} disabled={savingPl}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                {savingPl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingPlId ? 'Обновить' : 'Сохранить список'}
              </button>
            </div>
          </div>

          {/* Existing proxy lists */}
          {proxyLists.length > 0 && (
            <div className="divide-y">
              {proxyLists.map((pl) => (
                <div key={pl.id} className="py-3 flex items-start gap-3">
                  <Shield className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 flex items-center gap-2">
                      {pl.name}
                      <span className="text-[10px] text-gray-400 font-normal">
                        {(pl.proxies || []).length} прокси
                      </span>
                      {pl.rotate_url && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                          <RotateCw className="w-2.5 h-2.5" /> rotate
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 font-mono truncate">
                      {(pl.proxies || []).slice(0, 3).join(', ')}
                      {(pl.proxies || []).length > 3 && ` …+${(pl.proxies || []).length - 3}`}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => loadPlForEdit(pl)} className="p-1 rounded hover:bg-gray-100" title="Редактировать">
                      <Pencil className="w-3.5 h-3.5 text-gray-500" />
                    </button>
                    <button onClick={() => deleteProxyList(pl.id)} className="p-1 rounded hover:bg-gray-100" title="Удалить">
                      <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {proxyLists.length === 0 && (
            <p className="text-sm text-gray-400">Списков прокси пока нет.</p>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: GoLogin Settings */}
      {/* ================================================================ */}
      {settingsTab === 'gologin' && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-violet-600" />
            GoLogin — Анти-детект Cloud Browser
          </h2>
          <p className="text-xs text-gray-500">
            Конфигурация GoLogin API для скрапинга через Cloud Browser с анти-детект профилями.
            GoLogin MCP также требует этот API токен в env переменной <code className="bg-gray-100 px-1 rounded">API_TOKEN</code>.
          </p>

          {/* API Token */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">API Token</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={glConfig.api_token}
                onChange={(e) => setGlConfig(c => ({ ...c, api_token: e.target.value }))}
                placeholder="Вставьте GoLogin API token"
                className="flex-1 border rounded-md px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => saveGologinConfig({ api_token: glConfig.api_token })}
                disabled={glSaving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-violet-600 text-white text-sm hover:bg-violet-700 disabled:opacity-60"
              >
                {glSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Сохранить
              </button>
            </div>
          </div>

          {/* Gemini API Key */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-amber-500" />
              Gemini API Key (для AI-генерации сценариев и извлечения)
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={glConfig.gemini_api_key}
                onChange={(e) => setGlConfig(c => ({ ...c, gemini_api_key: e.target.value }))}
                placeholder="AIzaSy..."
                className="flex-1 border rounded-md px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => saveGologinConfig({ gemini_api_key: glConfig.gemini_api_key })}
                disabled={glSaving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-amber-600 text-white text-sm hover:bg-amber-700 disabled:opacity-60"
              >
                {glSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Сохранить
              </button>
            </div>
            <p className="text-[11px] text-gray-400">
              Ключ используется для AI-генерации YAML-сценариев и AI-извлечения данных из страниц.
            </p>
          </div>

          {/* Default Settings */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Тип прокси</label>
              <select
                value={glConfig.proxy_type}
                onChange={(e) => { setGlConfig(c => ({ ...c, proxy_type: e.target.value })); saveGologinConfig({ proxy_type: e.target.value }) }}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="residential">Residential</option>
                <option value="mobile">Mobile</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Страна по умолч.</label>
              <select
                value={glConfig.default_country}
                onChange={(e) => { setGlConfig(c => ({ ...c, default_country: e.target.value })); saveGologinConfig({ default_country: e.target.value }) }}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="">— не выбрана —</option>
                <option value="us">🇺🇸 US — США</option>
                <option value="gb">🇬🇧 GB — Великобритания</option>
                <option value="de">🇩🇪 DE — Германия</option>
                <option value="fr">🇫🇷 FR — Франция</option>
                <option value="nl">🇳🇱 NL — Нидерланды</option>
                <option value="ca">🇨🇦 CA — Канада</option>
                <option value="au">🇦🇺 AU — Австралия</option>
                <option value="jp">🇯🇵 JP — Япония</option>
                <option value="kr">🇰🇷 KR — Южная Корея</option>
                <option value="sg">🇸🇬 SG — Сингапур</option>
                <option value="in">🇮🇳 IN — Индия</option>
                <option value="br">🇧🇷 BR — Бразилия</option>
                <option value="mx">🇲🇽 MX — Мексика</option>
                <option value="it">🇮🇹 IT — Италия</option>
                <option value="es">🇪🇸 ES — Испания</option>
                <option value="pl">🇵🇱 PL — Польша</option>
                <option value="tr">🇹🇷 TR — Турция</option>
                <option value="ua">🇺🇦 UA — Украина</option>
                <option value="ru">🇷🇺 RU — Россия</option>
                <option value="se">🇸🇪 SE — Швеция</option>
                <option value="ch">🇨🇭 CH — Швейцария</option>
                <option value="at">🇦🇹 AT — Австрия</option>
                <option value="be">🇧🇪 BE — Бельгия</option>
                <option value="cz">🇨🇿 CZ — Чехия</option>
                <option value="dk">🇩🇰 DK — Дания</option>
                <option value="fi">🇫🇮 FI — Финляндия</option>
                <option value="no">🇳🇴 NO — Норвегия</option>
                <option value="pt">🇵🇹 PT — Португалия</option>
                <option value="ar">🇦🇷 AR — Аргентина</option>
                <option value="il">🇮🇱 IL — Израиль</option>
                <option value="ae">🇦🇪 AE — ОАЭ</option>
                <option value="za">🇿🇦 ZA — ЮАР</option>
                <option value="hk">🇭🇰 HK — Гонконг</option>
                <option value="tw">🇹🇼 TW — Тайвань</option>
                <option value="th">🇹🇭 TH — Таиланд</option>
                <option value="vn">🇻🇳 VN — Вьетнам</option>
                <option value="id">🇮🇩 ID — Индонезия</option>
                <option value="ph">🇵🇭 PH — Филиппины</option>
                <option value="my">🇲🇾 MY — Малайзия</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ожидание загрузки</label>
              <select
                value={glConfig.wait_until}
                onChange={(e) => { setGlConfig(c => ({ ...c, wait_until: e.target.value })); saveGologinConfig({ wait_until: e.target.value }) }}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="networkidle">Network Idle</option>
                <option value="domcontentloaded">DOM Content Loaded</option>
                <option value="load">Load</option>
                <option value="commit">Commit (первый байт)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Таймаут (сек)</label>
              <input
                type="number" min={5} max={300}
                value={glConfig.wait_timeout_sec}
                onChange={(e) => { const v = parseInt(e.target.value) || 60; setGlConfig(c => ({ ...c, wait_timeout_sec: v })); saveGologinConfig({ wait_timeout_sec: v }) }}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* Profiles */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Браузерные профили</h3>
            <p className="text-[11px] text-gray-400">
              Добавьте ID профилей из GoLogin. Профили ротируются при batch-парсинге.
              Для каждого профиля можно указать свой прокси (опционально).
            </p>

            {/* Existing profiles */}
            {glConfig.profiles.length > 0 && (
              <div className="divide-y border rounded-md">
                {glConfig.profiles.map((p) => (
                  <div key={p.profile_id} className="p-2.5 flex items-center gap-3">
                    <Fingerprint className="w-4 h-4 text-violet-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{p.name || p.profile_id}</div>
                      <div className="text-[11px] text-gray-400 font-mono truncate">
                        ID: {p.profile_id}
                        {p.custom_proxy && <> · Прокси: {p.custom_proxy}</>}
                      </div>
                    </div>
                    <button onClick={() => removeGlProfile(p.profile_id)} className="p-1 rounded hover:bg-gray-100" title="Удалить">
                      <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add profile form */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-3 bg-gray-50 rounded-md">
              <input
                type="text"
                value={glNewProfile.profile_id}
                onChange={(e) => setGlNewProfile(p => ({ ...p, profile_id: e.target.value }))}
                placeholder="Profile ID"
                className="border rounded-md px-2 py-1.5 text-sm font-mono"
              />
              <input
                type="text"
                value={glNewProfile.name}
                onChange={(e) => setGlNewProfile(p => ({ ...p, name: e.target.value }))}
                placeholder="Название (опц.)"
                className="border rounded-md px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                value={glNewProfile.custom_proxy}
                onChange={(e) => setGlNewProfile(p => ({ ...p, custom_proxy: e.target.value }))}
                placeholder="http://user:pass@host:port (опц.)"
                className="border rounded-md px-2 py-1.5 text-sm font-mono"
              />
              <button
                type="button"
                onClick={addGlProfile}
                disabled={!glNewProfile.profile_id.trim() || glSaving}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 text-white text-sm hover:bg-violet-700 disabled:opacity-60"
              >
                <Plus className="w-3.5 h-3.5" />
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Scenarios */}
      {/* ================================================================ */}
      {settingsTab === 'scenarios' && (
        <div className="space-y-5">
          {/* Scenario editor */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Workflow className="w-5 h-5 text-cyan-600" />
              {editingScId ? 'Редактирование сценария' : 'Новый сценарий'}
            </h2>

            {/* AI Scenario Generation */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                <Wand2 className="w-4 h-4" />
                AI-генерация сценария (Gemini)
              </div>
              {!glConfig.gemini_api_key && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                  Gemini API Key не настроен. Перейдите во вкладку «GoLogin» для указания ключа.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">URL страницы (опц.)</label>
                  <input
                    type="url"
                    value={aiGenUrl}
                    onChange={(e) => setAiGenUrl(e.target.value)}
                    placeholder="https://example.com/login"
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Что должен делать сценарий?</label>
                  <input
                    type="text"
                    value={aiGenPrompt}
                    onChange={(e) => setAiGenPrompt(e.target.value)}
                    placeholder="Авторизоваться, перейти в профиль, извлечь email и имя пользователя"
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={generateScenarioAI}
                  disabled={generating || !glConfig.gemini_api_key || !aiGenPrompt.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-60"
                >
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {generating ? 'Генерация…' : 'Сгенерировать YAML'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500">
                AI создаст YAML-сценарий на основе описания. Результат появится в редакторе ниже — проверьте и при необходимости скорректируйте.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
                <input
                  type="text" value={scName} onChange={(e) => setScName(e.target.value)}
                  placeholder="Login & Check Dashboard"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
                <input
                  type="text" value={scDescription} onChange={(e) => setScDescription(e.target.value)}
                  placeholder="Авторизация и проверка наличия данных на панели"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">YAML сценарий</label>
              <textarea
                value={scYaml}
                onChange={(e) => setScYaml(e.target.value)}
                rows={20}
                spellCheck={false}
                className="w-full border rounded-md px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-gray-50"
                style={{ tabSize: 2 }}
              />
              <p className="mt-1 text-[11px] text-gray-400">
                Шаги: navigate, click, fill, type, select, wait, extract, scroll, evaluate, keyboard, hover, delay, log, result, if (exists/not_exists → then/else).
                Рандомизация: delay [min, max] мс, mouse_jitter, typing_speed [min, max] мс, scroll_noise.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {editingScId && (
                <button onClick={resetScForm} className="text-sm text-gray-500 hover:text-gray-700">Отмена</button>
              )}
              <div className="flex-1" />
              <button
                type="button" onClick={saveScenario} disabled={savingSc}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
              >
                {savingSc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingScId ? 'Обновить сценарий' : 'Сохранить сценарий'}
              </button>
            </div>
          </div>

          {/* Saved scenarios list */}
          {scenarios.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Сохранённые сценарии</h3>
              <div className="divide-y">
                {scenarios.map(sc => (
                  <div key={sc.id} className="py-3 flex items-start gap-3">
                    <Workflow className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">{sc.name}</div>
                      {sc.description && <div className="text-xs text-gray-500 mt-0.5">{sc.description}</div>}
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {new Date(sc.updated_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => loadScForEdit(sc)} className="p-1 rounded hover:bg-gray-100" title="Редактировать">
                        <Pencil className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                      <button onClick={() => deleteScenario(sc.id)} className="p-1 rounded hover:bg-gray-100" title="Удалить">
                        <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Launch scenario */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Play className="w-4 h-4 text-green-600" />
              Запуск сценария
            </h3>

            {!glConfig.api_token && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                GoLogin API Token не настроен. Перейдите во вкладку «GoLogin».
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Сценарий</label>
                <select
                  value={selectedRunScenarioId}
                  onChange={(e) => setSelectedRunScenarioId(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                >
                  <option value="">— выберите —</option>
                  {scenarios.map(sc => (
                    <option key={sc.id} value={sc.id}>{sc.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Параллелизм (одновременно профилей)
                </label>
                <input
                  type="number" min={1} max={20}
                  value={runConcurrency}
                  onChange={(e) => setRunConcurrency(Math.max(1, Math.min(20, Number(e.target.value))))}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button" onClick={launchScenario}
                  disabled={launchingSc || !selectedRunScenarioId}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60 w-full justify-center"
                >
                  {launchingSc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Запустить
                </button>
              </div>
            </div>

            {/* Profile selector */}
            {glConfig.profiles.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Профили {runProfileIds.length > 0 ? `(${runProfileIds.length} выбрано)` : '(все)'}
                </label>
                <div className="flex flex-wrap gap-2">
                  {glConfig.profiles.map(p => {
                    const selected = runProfileIds.length === 0 || runProfileIds.includes(p.profile_id)
                    return (
                      <button
                        key={p.profile_id}
                        type="button"
                        onClick={() => {
                          if (runProfileIds.length === 0) {
                            setRunProfileIds(glConfig.profiles.filter(pr => pr.profile_id !== p.profile_id).map(pr => pr.profile_id))
                          } else {
                            toggleRunProfile(p.profile_id)
                          }
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${
                          selected
                            ? 'bg-cyan-50 border-cyan-300 text-cyan-700'
                            : 'bg-gray-50 border-gray-200 text-gray-400'
                        }`}
                      >
                        <Fingerprint className="w-3 h-3" />
                        {p.name || p.profile_id.slice(0, 8)}
                      </button>
                    )
                  })}
                  {runProfileIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setRunProfileIds([])}
                      className="text-[10px] text-gray-400 hover:text-gray-600 self-center"
                    >
                      Выбрать все
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Scenario runs history */}
          {scenarioRuns.length > 0 && (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
                <span className="font-semibold text-gray-900 text-sm">История запусков сценариев</span>
                <button onClick={fetchScenarioRuns} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Обновить
                </button>
              </div>
              <div className="divide-y">
                {scenarioRuns.map(run => {
                  const sc = scenarios.find(s => s.id === run.scenario_id)
                  const st = (run.status || 'queued').toLowerCase()
                  const profiles = run.results?.profiles || {}
                  const profileCount = run.profile_ids?.length || 0
                  const doneCount = Object.values(profiles).filter((r: any) => r.status === 'ok').length
                  const errCount = Object.values(profiles).filter((r: any) => r.status === 'error').length
                  const expanded = expandedRunId === run.id

                  return (
                    <div key={run.id}>
                      <div
                        className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50/60 cursor-pointer"
                        onClick={() => setExpandedRunId(expanded ? null : run.id)}
                      >
                        <div className="shrink-0">
                          {st === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                          {st === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
                          {st === 'running' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                          {st === 'queued' && <Clock className="w-4 h-4 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {sc?.name || run.scenario_id.slice(0, 8)}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                            <span>{new Date(run.created_at).toLocaleString()}</span>
                            <span className="text-gray-300">|</span>
                            <span>{profileCount} профилей, x{run.concurrency}</span>
                            {Object.keys(profiles).length > 0 && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span className="text-green-600">{doneCount} ok</span>
                                {errCount > 0 && <span className="text-red-600">{errCount} err</span>}
                              </>
                            )}
                          </div>
                          {run.error_message && (
                            <div className="text-[10px] text-red-500 mt-0.5 truncate">{run.error_message}</div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {(st === 'done' || st === 'error') && (
          <button
                              onClick={(e) => { e.stopPropagation(); deleteScenarioRun(run.id) }}
                              className="p-1 rounded hover:bg-gray-100" title="Удалить"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                            </button>
                          )}
                          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </div>
                      </div>

                      {/* Expanded per-profile results */}
                      {expanded && Object.keys(profiles).length > 0 && (
                        <div className="px-4 pb-4">
                          <div className="space-y-2 bg-gray-50 rounded-md p-3">
                            {Object.entries(profiles).map(([pid, result]: [string, any]) => {
                              const pName = glConfig.profiles.find(p => p.profile_id === pid)?.name || pid.slice(0, 12)
                              return (
                                <div key={pid} className="bg-white rounded border p-2.5">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <Fingerprint className="w-3.5 h-3.5 text-violet-500" />
                                    <span className="text-sm font-medium text-gray-900">{pName}</span>
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      result.status === 'ok'
                                        ? 'bg-green-50 text-green-700 border border-green-200'
                                        : 'bg-red-50 text-red-700 border border-red-200'
                                    }`}>
                                      {result.status}
                                    </span>
                                    {result.duration_ms != null && (
                                      <span className="text-[10px] text-gray-400">{(result.duration_ms / 1000).toFixed(1)}s</span>
                                    )}
                                  </div>
                                  {result.error && (
                                    <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded mb-1.5">{result.error}</div>
                                  )}
                                  {result.data && Object.keys(result.data).filter(k => !k.startsWith('_')).length > 0 && (
                                    <div className="text-xs text-gray-700 space-y-0.5 mb-1.5">
                                      {Object.entries(result.data).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                                        <div key={k}><span className="text-gray-500">{k}:</span> {String(v).slice(0, 120)}</div>
                                      ))}
                                    </div>
                                  )}
                                  {result.logs && result.logs.length > 0 && (
                                    <div className="text-[10px] text-gray-500 font-mono bg-gray-50 rounded px-2 py-1 max-h-24 overflow-auto">
                                      {result.logs.map((l: string, i: number) => (
                                        <div key={i}>{l}</div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          {run.results?.summary && (
                            <div className="mt-2 text-xs text-gray-500 text-center">{run.results.summary}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* Jobs list */}
      {/* ================================================================ */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <span className="font-semibold text-gray-900">История задач</span>
          <button onClick={fetchJobs} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Обновить
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">Задач пока нет.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-700 w-16">ID</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Дата</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Тип</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">URL</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Режим</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Статус</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Превью</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((job) => {
                  const st = (job.status || '').toLowerCase()
                  const isDone = st === 'done'
                  const isError = st === 'error'
                  const isRunning = st === 'running'
                  const jt = job.job_type || 'single'
                  const urlCount = jt === 'batch' && job.urls ? job.urls.length : null

                  return (
                    <tr key={job.id} className="hover:bg-gray-50/60">
                      <td className="px-3 py-2 text-xs text-gray-600 font-mono whitespace-nowrap">
                        #{job.display_id ?? job.id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {job.created_at ? new Date(job.created_at).toLocaleString() : ''}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {typeBadge(jt)}
                          {job.ai_prompt && (
                            <span title="AI extraction" className="text-amber-500">
                              <Sparkles className="w-3 h-3" />
                            </span>
                          )}
                          {job.template_id && (
                            <span title="CSV template" className="text-emerald-500">
                              <FileSpreadsheet className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <div className="text-xs text-gray-900 truncate" title={job.url}>
                          {job.url}
                        </div>
                        {urlCount && (
                          <div className="text-[10px] text-gray-400">+{urlCount - 1} URLs</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 capitalize">{job.mode}</td>
                      <td className="px-3 py-2">
                        {statusBadge(job.status)}
                        {isError && job.error_message && (
                          <div className="mt-1 text-[10px] text-red-500 truncate max-w-[160px]" title={job.error_message}>
                            {job.error_message}
                          </div>
                        )}
                        {(isRunning || isDone) && job.progress && (
                          <div className="mt-1.5">
                            <div className="w-24 h-1 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${Math.round((job.progress.completed / Math.max(job.progress.total, 1)) * 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400">
                              {job.progress.completed}/{job.progress.total}
                              {job.progress.errors > 0 && ` (${job.progress.errors} err)`}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[180px]">
                        {job.result_preview ? (
                          <div
                            className="text-xs text-gray-600 truncate cursor-pointer hover:text-blue-600"
                            onClick={() => setPreviewJob(job)}
                            title="Нажмите для просмотра"
                          >
                            {job.result_preview.slice(0, 100)}…
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {isDone && job.result_preview && (
                            <button onClick={() => setPreviewJob(job)} className="p-1 rounded hover:bg-gray-100" title="Просмотр">
                              <Eye className="w-3.5 h-3.5 text-gray-500" />
                            </button>
                          )}
                        {isDone && job.result_path && (
                            <button onClick={() => downloadResult(job)} className="p-1 rounded hover:bg-gray-100" title="Скачать">
                              <Download className="w-3.5 h-3.5 text-gray-500" />
                          </button>
                        )}
                          {isError && (
                            <button onClick={() => retryJob(job.id)} className="p-1 rounded hover:bg-gray-100" title="Повторить">
                              <RotateCcw className="w-3.5 h-3.5 text-blue-500" />
                            </button>
                          )}
                          {(isDone || isError) && (
                            <button onClick={() => deleteJob(job.id)} className="p-1 rounded hover:bg-gray-100" title="Удалить">
                              <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FAQ Section */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowFaq(!showFaq)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <span className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-blue-500" />
            FAQ — Краткое руководство по сервису
          </span>
          {showFaq ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showFaq && (
          <div className="px-4 pb-4 space-y-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <h4 className="font-medium text-gray-900">Какие режимы скрапинга доступны?</h4>
                <p className="text-gray-600 text-xs leading-relaxed">
                  <strong>Fetcher</strong> — быстрый HTTP-запрос без рендеринга JS.
                  <strong> Stealth</strong> — обход Cloudflare и защит.
                  <strong> Dynamic</strong> — полный JS/SPA рендеринг через Playwright.
                  <strong> GoLogin</strong> — Cloud Browser с анти-детект профилем для максимальной скрытности.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-medium text-gray-900">Как использовать CSV-шаблоны?</h4>
                <p className="text-gray-600 text-xs leading-relaxed">
                  Создайте шаблон во вкладке «CSV-шаблоны» — укажите колонки с CSS/XPath селекторами.
                  При создании задачи выберите шаблон — результат будет структурированным CSV-файлом.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-medium text-gray-900">Как работает ротация прокси?</h4>
                <p className="text-gray-600 text-xs leading-relaxed">
                  Создайте список прокси во вкладке «Прокси». При batch/crawl задачах прокси чередуются.
                  Если провайдер поддерживает смену IP — укажите Rotate URL для автоматической ротации.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-medium text-gray-900">Как подключить GoLogin?</h4>
                <p className="text-gray-600 text-xs leading-relaxed">
                  Перейдите во вкладку «GoLogin» → укажите API Token → добавьте ID браузерных профилей.
                  Для каждого профиля можно задать свой прокси. При создании задачи выберите режим «GoLogin».
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-medium text-gray-900">Как создать сценарий автоматизации?</h4>
                <p className="text-gray-600 text-xs leading-relaxed">
                  Во вкладке «Сценарии» опишите шаги в YAML или используйте AI-генерацию —
                  укажите URL и опишите задачу, Gemini создаст YAML. Запустите сценарий в выбранных GoLogin профилях
                  с указанием параллелизма.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-medium text-gray-900">Как работает AI-извлечение данных?</h4>
                <p className="text-gray-600 text-xs leading-relaxed">
                  При создании задачи заполните поле «AI-промпт» — опишите что нужно извлечь.
                  Gemini проанализирует HTML страницы и вернёт структурированный результат.
                  AI-промпт не используется совместно с CSV-шаблоном.
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
              <p className="text-xs text-blue-700">
                <strong>Порядок работы:</strong> Настройте GoLogin и/или прокси → Создайте CSV-шаблон (при необходимости) →
                Запустите задачу скрапинга или создайте сценарий автоматизации → Скачайте результат.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Preview modal */}
      {previewJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPreviewJob(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 text-sm">Результат</h3>
                  {typeBadge(previewJob.job_type || 'single')}
                  {previewJob.ai_prompt && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                      <Sparkles className="w-2.5 h-2.5" /> AI
                    </span>
                  )}
                  {previewJob.template_id && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      <FileSpreadsheet className="w-2.5 h-2.5" /> CSV
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">{previewJob.url}</p>
              </div>
              <button onClick={() => setPreviewJob(null)} className="p-1 hover:bg-gray-100 rounded shrink-0">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">
                {previewJob.result_preview || 'Нет данных'}
              </pre>
            </div>
            <div className="px-4 py-3 border-t flex justify-end gap-2 shrink-0">
              {previewJob.result_path && (
                <button
                  onClick={() => downloadResult(previewJob)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Download className="w-3 h-3" /> Скачать полный файл
                </button>
              )}
              <button onClick={() => setPreviewJob(null)} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-50">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
