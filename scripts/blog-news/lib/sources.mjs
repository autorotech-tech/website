import { configSourcesPath, ensureDirs, readJson, runtimeSourcesPath, writeJson } from './paths.mjs'

export function loadSources() {
  ensureDirs()
  const runtime = readJson(runtimeSourcesPath(), null)
  if (runtime && Array.isArray(runtime.sources)) return runtime
  const seed = readJson(configSourcesPath(), { sources: [] })
  writeJson(runtimeSourcesPath(), seed)
  return seed
}

export function saveSources(doc) {
  const next = {
    updatedAt: new Date().toISOString(),
    sources: Array.isArray(doc?.sources) ? doc.sources : [],
  }
  writeJson(runtimeSourcesPath(), next)
  return next
}

export function upsertSource(source) {
  const doc = loadSources()
  const id = String(source.id || '').trim()
  if (!id) throw new Error('source.id is required')
  const idx = doc.sources.findIndex((row) => row.id === id)
  const row = {
    enabled: true,
    type: 'rss',
    category: 'ai_news',
    lang: 'en',
    ...source,
    id,
  }
  if (idx >= 0) doc.sources[idx] = { ...doc.sources[idx], ...row }
  else doc.sources.push(row)
  return saveSources(doc)
}

export function deleteSource(id) {
  const doc = loadSources()
  doc.sources = doc.sources.filter((row) => row.id !== id)
  return saveSources(doc)
}

export function enabledSources() {
  return loadSources().sources.filter((row) => row.enabled !== false)
}
