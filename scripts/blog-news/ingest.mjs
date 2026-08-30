#!/usr/bin/env node
import { enabledSources } from './lib/sources.mjs'
import { loadSettings } from './lib/settings.mjs'
import { createItem, listItems, uniqueSlug } from './lib/store.mjs'
import { fetchFeedItems, fetchText, extractListingLinks, parseRedditListing } from './lib/rss.mjs'
import { scrapeArticle } from './lib/swoop-scrape.mjs'
import { checkNewsRelevance } from './lib/relevance.mjs'
import { isDuplicate } from './lib/dedup.mjs'
import { loadIngestState, markSeen, saveIngestState } from './lib/ingest-state.mjs'
import { normalizeUrl } from './lib/slug.mjs'
import { emptyLangs } from './lib/langs.mjs'

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  return fallback
}

async function collectCandidates(source) {
  const type = source.type || 'rss'
  if (type === 'rss' || type === 'atom') {
    return fetchFeedItems(source.url)
  }
  if (type === 'reddit_json') {
    const raw = await fetchText(source.url)
    return parseRedditListing(JSON.parse(raw))
  }
  if (type === 'listing') {
    const html = await fetchText(source.url)
    return extractListingLinks(html, source.url, {
      linkPattern: source.linkPattern || null,
      max: source.maxItems || 20,
    })
  }
  throw new Error(`Unknown source type ${type}`)
}

export async function ingestNews({ limit, sourceId } = {}) {
  const settings = loadSettings()
  const cap = Number(limit || settings.ingestLimit || 8)
  const state = loadIngestState()
  const seenUrls = new Set(state.seenUrls || [])
  const existing = listItems()
  const sources = enabledSources().filter((row) => !sourceId || row.id === sourceId)
  const stats = {
    sources: sources.length,
    fetched: 0,
    skippedDup: 0,
    skippedRelevance: 0,
    scraped: 0,
    created: 0,
    errors: [],
  }
  const created = []

  for (const source of sources) {
    if (created.length >= cap) break
    let candidates = []
    try {
      candidates = await collectCandidates(source)
    } catch (err) {
      stats.errors.push({ source: source.id, error: String(err.message || err) })
      continue
    }

    for (const cand of candidates) {
      if (created.length >= cap) break
      stats.fetched += 1
      const url = normalizeUrl(cand.url)
      const dup = isDuplicate({ url, title: cand.title }, { seenUrls, existingItems: [...existing, ...created] })
      if (dup.dup) {
        stats.skippedDup += 1
        markSeen(state, url)
        continue
      }

      const relevance = await checkNewsRelevance({
        title: cand.title,
        summary: cand.summary || '',
        url,
        category: source.category,
        model: settings.fallbackModel || settings.model,
        minScore: settings.relevanceMinScore,
        trusted: true,
      })
      if (!relevance.relevant) {
        stats.skippedRelevance += 1
        continue
      }

      let sourceText = cand.summary || ''
      try {
        const scraped = await scrapeArticle(url, { mode: settings.scrapeMode })
        sourceText = [cand.summary, scraped.text].filter(Boolean).join('\n\n').slice(0, 40000)
        stats.scraped += 1
      } catch (err) {
        const errMsg = String(err.message || err)
        console.warn(`[ingest] Scrape fallback/warning for ${url}: ${errMsg}`)
        if (sourceText.length < 120) {
          stats.errors.push({ url, error: errMsg })
          continue
        }
      }

      const item = createItem({
        slug: uniqueSlug(`${source.id}-${cand.title}`).slice(0, 90),
        status: 'pending',
        source: 'pipeline',
        category: relevance.category || source.category,
        sourceId: source.id,
        sourceUrl: url,
        sourceTitle: cand.title,
        sourceText,
        citeMode: settings.citeMode,
        relevance,
        langs: emptyLangs(),
      })
      created.push(item)
      existing.push(item)
      markSeen(state, url)
      stats.created += 1
    }
  }

  state.lastRunAt = new Date().toISOString()
  state.lastStats = stats
  saveIngestState(state)
  return { created, stats }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('ingest.mjs')
if (isMain) {
  ingestNews({
    limit: argValue('--limit'),
    sourceId: argValue('--source'),
  })
    .then((result) => {
      console.log(JSON.stringify(result.stats, null, 2))
      for (const item of result.created) {
        console.log(`created ${item.slug} <- ${item.sourceUrl}`)
      }
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
