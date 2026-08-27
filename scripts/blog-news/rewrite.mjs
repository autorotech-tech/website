#!/usr/bin/env node
import { getItem, listItems, saveItem } from './lib/store.mjs'
import { loadSettings } from './lib/settings.mjs'
import { generateArticleTwoPhase } from './lib/rewrite-article.mjs'

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  return fallback
}

export async function rewriteItem(slug, { settings } = {}) {
  const item = getItem(slug)
  if (!item) throw new Error(`Draft not found: ${slug}`)
  const cfg = settings || loadSettings()
  const { langs, coverage } = await generateArticleTwoPhase(item, cfg)
  item.langs = { ...item.langs, ...langs }
  const complete = coverage.missing.length === 0
  item.status = cfg.requireAllLangs && !complete ? 'pending' : 'ready'
  item.rewrite = {
    at: new Date().toISOString(),
    model: cfg.model,
    coverage,
  }
  return saveItem(item)
}

export async function rewritePending({ limit = 3 } = {}) {
  const settings = loadSettings()
  const items = listItems()
    .filter((row) => row.status === 'pending' && row.sourceText)
    .slice(0, Number(limit))
  const out = []
  for (const item of items) {
    out.push(await rewriteItem(item.slug, { settings }))
  }
  return out
}

const isMain = process.argv[1]?.endsWith('rewrite.mjs')
if (isMain) {
  const slug = argValue('--slug')
  const job = slug ? rewriteItem(slug) : rewritePending({ limit: argValue('--limit', '3') })
  job
    .then((result) => {
      const rows = Array.isArray(result) ? result : [result]
      for (const row of rows) {
        console.log(`rewritten ${row.slug} status=${row.status}`)
      }
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
