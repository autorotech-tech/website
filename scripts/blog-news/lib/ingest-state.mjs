import { ingestStatePath, readJson, writeJson, ensureDirs } from './paths.mjs'

export function loadIngestState() {
  ensureDirs()
  return readJson(ingestStatePath(), { seenUrls: [], lastRunAt: null }) || { seenUrls: [], lastRunAt: null }
}

export function saveIngestState(state) {
  writeJson(ingestStatePath(), {
    seenUrls: Array.from(new Set(state.seenUrls || [])),
    lastRunAt: state.lastRunAt || new Date().toISOString(),
    lastStats: state.lastStats || null,
  })
}

export function markSeen(state, url) {
  if (!state.seenUrls) state.seenUrls = []
  if (url && !state.seenUrls.includes(url)) state.seenUrls.push(url)
  return state
}
