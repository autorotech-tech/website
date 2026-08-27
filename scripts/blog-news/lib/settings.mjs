import { AUTORO_BLOG_REWRITE_PROMPT } from './rewrite-prompt.mjs'
import { readJson, settingsPath, writeJson, ensureDirs } from './paths.mjs'

export const DEFAULT_SETTINGS = {
  rewritePrompt: AUTORO_BLOG_REWRITE_PROMPT,
  model: 'openrouter/anthropic/claude-3.7-sonnet',
  fallbackModel: 'glm/glm-4-flash',
  requireAllLangs: true,
  ingestLimit: 8,
  relevanceMinScore: 0.55,
  citeMode: 'footer',
  scrapeMode: 'fetcher',
  requireApproval: true,
}

export function loadSettings() {
  ensureDirs()
  const stored = readJson(settingsPath(), {}) || {}
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    rewritePrompt: stored.rewritePrompt || DEFAULT_SETTINGS.rewritePrompt,
    model: process.env.AUTORO_BLOG_REWRITE_MODEL || stored.model || DEFAULT_SETTINGS.model,
    fallbackModel: process.env.AUTORO_BLOG_REWRITE_FALLBACK_MODEL || stored.fallbackModel || DEFAULT_SETTINGS.fallbackModel,
    ingestLimit: Number(process.env.BLOG_NEWS_INGEST_LIMIT || stored.ingestLimit || DEFAULT_SETTINGS.ingestLimit),
    relevanceMinScore: Number(process.env.BLOG_NEWS_RELEVANCE_MIN_SCORE || stored.relevanceMinScore || DEFAULT_SETTINGS.relevanceMinScore),
    scrapeMode: process.env.BLOG_NEWS_SCRAPE_MODE || stored.scrapeMode || DEFAULT_SETTINGS.scrapeMode,
    requireApproval: String(process.env.BLOG_NEWS_REQUIRE_APPROVAL ?? (stored.requireApproval ? '1' : '0')) !== '0',
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch }
  writeJson(settingsPath(), next)
  return next
}
