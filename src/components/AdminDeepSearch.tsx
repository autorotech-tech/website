import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Search, ExternalLink, Clock, Zap, Globe, BookOpen, FlaskConical, Newspaper, AlignLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

const DEEP_SEARCH_API = '/api/deep-search'

const DEFAULT_MODELS = [
    { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    { id: 'google/gemini-2.5-pro-preview-03-25', label: 'Gemini 2.5 Pro' },
    { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
]

const SOURCE_ICONS: Record<string, React.ReactNode> = {
    arxiv: <FlaskConical className="w-3 h-3" />,
    wikipedia: <BookOpen className="w-3 h-3" />,
    news: <Newspaper className="w-3 h-3" />,
    brave: <Globe className="w-3 h-3" />,
    searxng: <Search className="w-3 h-3" />,
    web: <Globe className="w-3 h-3" />,
}

const SOURCE_COLORS: Record<string, string> = {
    arxiv: 'bg-purple-100 text-purple-700 border-purple-200',
    wikipedia: 'bg-blue-100 text-blue-700 border-blue-200',
    news: 'bg-orange-100 text-orange-700 border-orange-200',
    brave: 'bg-rose-100 text-rose-700 border-rose-200',
    searxng: 'bg-green-100 text-green-700 border-green-200',
    web: 'bg-gray-100 text-gray-600 border-gray-200',
}

interface Citation { num: number; url: string; title: string; source_type: string; credibility: number }
interface HistoryItem { id: string; query: string; model: string; created_at: string }

export function AdminDeepSearch() {
    const [query, setQuery] = useState('')
    const [models, setModels] = useState(DEFAULT_MODELS)
    const [model, setModel] = useState(DEFAULT_MODELS[0].id)
    const [searching, setSearching] = useState(false)
    const [status, setStatus] = useState('')
    const [iteration, setIteration] = useState(0)
    const [confidence, setConfidence] = useState<number | null>(null)
    const [queries, setQueries] = useState<string[]>([])
    const [answer, setAnswer] = useState('')
    const [citations, setCitations] = useState<Citation[]>([])
    const [sourceBreakdown, setSourceBreakdown] = useState<Record<string, number>>({})
    const [history, setHistory] = useState<HistoryItem[]>([])
    const [showHistory, setShowHistory] = useState(false)
    const answerRef = useRef<HTMLDivElement>(null)

    useEffect(() => { loadHistory() }, [])
    useEffect(() => { loadModelsFromSettings() }, [])

    useEffect(() => {
        if (answerRef.current && searching)
            answerRef.current.scrollTop = answerRef.current.scrollHeight
    }, [answer, searching])

    const loadHistory = async () => {
        try {
            const res = await fetch(`${DEEP_SEARCH_API}/history`)
            const data = await res.json()
            setHistory(data.history || [])
        } catch (e) { console.error('History load failed:', e) }
    }

    const loadModelsFromSettings = async () => {
        try {
            const { data, error } = await supabase
                .from('service_settings')
                .select('openrouter_default_model, openrouter_qwen_model')
                .eq('id', 1)
                .single()
            if (error) return
            const fromSettings = [
                String(data?.openrouter_default_model || '').trim(),
                String(data?.openrouter_qwen_model || '').trim(),
            ].filter(Boolean)
            if (!fromSettings.length) return
            const mapped = fromSettings.map((id) => ({ id, label: id }))
            const uniq = [...mapped, ...DEFAULT_MODELS].filter((m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx)
            setModels(uniq)
            if (!uniq.some((m) => m.id === model)) {
                setModel(uniq[0].id)
            }
        } catch {
            // keep defaults silently
        }
    }

    const handleSearch = async () => {
        if (!query.trim() || searching) return
        setSearching(true)
        setAnswer('')
        setCitations([])
        setQueries([])
        setStatus('Starting deep research...')
        setIteration(0)
        setConfidence(null)
        setSourceBreakdown({})

        try {
            const res = await fetch(`${DEEP_SEARCH_API}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query.trim(), model }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)

            const reader = res.body!.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue
                    try {
                        const data = JSON.parse(line.slice(6))
                        switch (data.type) {
                            case 'status': setStatus(data.content); break
                            case 'queries':
                                setQueries(prev => [...prev, ...data.queries])
                                if (data.iteration) setIteration(data.iteration)
                                break
                            case 'answer_start':
                                if (data.iteration > 1) setAnswer('')
                                break
                            case 'token': setAnswer(prev => prev + data.content); break
                            case 'confidence': setConfidence(data.score); break
                            case 'citations': setCitations(data.citations || []); break
                            case 'error':
                                setStatus(`❌ ${data.content}`)
                                setSearching(false)
                                break
                            case 'done':
                                setStatus('')
                                setSearching(false)
                                setSourceBreakdown(data.source_breakdown || {})
                                loadHistory()
                                break
                        }
                    } catch (e) { /* ignore parse errors */ }
                }
            }
        } catch (e: any) {
            setStatus(`Error: ${e.message}`)
            setSearching(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch() }
    }

    const credibilityColor = (score: number) =>
        score >= 0.9 ? 'text-green-600' : score >= 0.75 ? 'text-yellow-600' : 'text-gray-400'

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b px-6 py-3 flex items-center justify-between flex-shrink-0">
                <div>
                    <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <Zap className="w-5 h-5 text-purple-600" /> Deep Search
                        <span className="text-xs font-normal bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">Perplexity-level</span>
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={model}
                        onChange={e => setModel(e.target.value)}
                        className="text-sm border rounded-lg px-2 py-1.5 bg-white text-gray-700"
                    >
                        {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <button
                        onClick={() => { setShowHistory(!showHistory); loadHistory() }}
                        className="text-sm text-gray-600 border rounded-lg px-3 py-1.5 hover:bg-gray-50 flex items-center gap-1.5"
                    >
                        <Clock className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Main */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Search input */}
                    <div className="bg-white border-b px-6 py-3 flex-shrink-0">
                        <div className="flex gap-3">
                            <div className="flex-1 relative">
                                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                                <textarea
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask anything — I'll search 5 sources, fetch 25+ pages, and generate a research report with citations..."
                                    rows={2}
                                    className="w-full pl-9 pr-4 py-2 border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                    disabled={searching}
                                />
                            </div>
                            <button
                                onClick={handleSearch}
                                disabled={!query.trim() || searching}
                                className="px-5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 font-medium text-sm flex-shrink-0"
                            >
                                {searching
                                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    : <Zap className="w-4 h-4" />}
                                Search
                            </button>
                        </div>

                        {/* Search sub-queries pills */}
                        {queries.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {queries.map((q, i) => (
                                    <span key={i} className="text-xs bg-purple-50 text-purple-700 border border-purple-100 rounded-full px-2.5 py-0.5 flex items-center gap-1">
                                        <Globe className="w-3 h-3" /> {q}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Status bar */}
                    {(status || confidence !== null) && (
                        <div className="px-6 py-2 bg-blue-50 border-b text-sm text-blue-700 flex items-center gap-3 flex-shrink-0">
                            {searching && <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                            <span className="flex-1">{status}</span>
                            {confidence !== null && (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${confidence >= 0.8 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                    }`}>
                                    {(confidence * 100).toFixed(0)}% confident
                                </span>
                            )}
                            {iteration > 0 && (
                                <span className="text-xs text-blue-500">Iter {iteration}/3</span>
                            )}
                        </div>
                    )}

                    {/* Answer */}
                    <div ref={answerRef} className="flex-1 overflow-y-auto px-6 py-6">
                        {answer ? (
                            <div className="max-w-4xl mx-auto">
                                {/* Source breakdown */}
                                {Object.keys(sourceBreakdown).length > 0 && (
                                    <div className="mb-4 flex flex-wrap gap-2">
                                        {Object.entries(sourceBreakdown).map(([type, count]) => (
                                            <span key={type} className={`text-xs border rounded-full px-2.5 py-1 flex items-center gap-1.5 ${SOURCE_COLORS[type] || SOURCE_COLORS.web}`}>
                                                {SOURCE_ICONS[type] || <Globe className="w-3 h-3" />}
                                                {type}: {count}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Markdown answer */}
                                <div className="prose prose-sm max-w-none
                  prose-headings:font-bold prose-headings:text-gray-900
                  prose-h2:text-lg prose-h2:border-b prose-h2:pb-1 prose-h2:mb-3 prose-h2:mt-6
                  prose-h3:text-base prose-h3:mt-4
                  prose-a:text-purple-600 prose-a:no-underline hover:prose-a:underline
                  prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded
                  prose-blockquote:border-l-purple-400 prose-blockquote:text-gray-600">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
                                </div>

                                {/* Citations */}
                                {citations.length > 0 && (
                                    <div className="mt-8 border-t pt-6">
                                        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                            <AlignLeft className="w-4 h-4" /> All Sources ({citations.length})
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {citations.map(c => (
                                                <a
                                                    key={c.num}
                                                    href={c.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="flex items-start gap-2 p-2.5 border rounded-lg hover:bg-gray-50 group"
                                                >
                                                    <span className="flex-shrink-0 w-5 h-5 bg-purple-100 text-purple-700 rounded text-xs flex items-center justify-center font-bold">
                                                        {c.num}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs text-gray-800 line-clamp-2">{c.title || c.url}</p>
                                                        <div className="flex items-center gap-1.5 mt-0.5">
                                                            <span className={`text-xs border rounded-full px-1.5 py-0.5 flex items-center gap-1 ${SOURCE_COLORS[c.source_type] || SOURCE_COLORS.web}`}>
                                                                {SOURCE_ICONS[c.source_type] || <Globe className="w-3 h-3" />}
                                                                {c.source_type}
                                                            </span>
                                                            <span className={`text-xs font-mono ${credibilityColor(c.credibility)}`}>
                                                                {(c.credibility * 100).toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 flex-shrink-0 mt-1 text-gray-400" />
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : !searching && (
                            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
                                <Zap className="w-12 h-12 mb-4 text-purple-200" />
                                <p className="text-lg font-medium text-gray-500">Deep Research</p>
                                <p className="text-sm mt-1 max-w-md">
                                    Searches SearXNG, Brave, Wikipedia, ArXiv & News in parallel.
                                    Fetches 25+ pages, re-ranks with cross-encoder, and generates structured reports with citations.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* History */}
                {showHistory && (
                    <div className="w-60 border-l bg-white flex flex-col flex-shrink-0">
                        <div className="px-4 py-3 border-b text-sm font-semibold text-gray-700 flex justify-between">
                            <span>History</span>
                            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {history.length === 0
                                ? <p className="text-xs text-gray-400 p-4 text-center">No searches yet</p>
                                : history.map(h => (
                                    <button
                                        key={h.id}
                                        onClick={() => setQuery(h.query)}
                                        className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b"
                                    >
                                        <p className="text-xs text-gray-800 line-clamp-2">{h.query}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">{new Date(h.created_at).toLocaleDateString()}</p>
                                    </button>
                                ))
                            }
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
