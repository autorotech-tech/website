#!/usr/bin/env node
import { ingestNews } from './ingest.mjs'
import { rewritePending } from './rewrite.mjs'

const rewrite = process.argv.includes('--rewrite')
const limit = (() => {
  const idx = process.argv.indexOf('--limit')
  return idx >= 0 ? process.argv[idx + 1] : undefined
})()

const result = await ingestNews({ limit })
console.log('ingest', result.stats)
if (rewrite) {
  const rewritten = await rewritePending({ limit: limit || 3 })
  console.log(`rewritten ${rewritten.length}`)
} else {
  console.log('skip rewrite (cron ingest-only). Use --rewrite or blog-news:rewrite')
}
