import fs from 'node:fs'
import path from 'node:path'
import { contentDir, ensureDirs, readJson, writeJson } from './paths.mjs'
import { BLOG_LANGS, emptyLangs, STATUSES } from './langs.mjs'
import { slugify } from './slug.mjs'

export function listItems() {
  ensureDirs()
  const dir = contentDir()
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  return files
    .map((name) => readJson(path.join(dir, name), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
}

export function getItem(slug) {
  ensureDirs()
  return readJson(path.join(contentDir(), `${slug}.json`), null)
}

export function itemPath(slug) {
  return path.join(contentDir(), `${slug}.json`)
}

export function uniqueSlug(base) {
  let slug = slugify(base)
  let n = 2
  while (fs.existsSync(itemPath(slug))) {
    slug = `${slugify(base)}-${n}`
    n += 1
  }
  return slug
}

export function saveItem(item) {
  if (!item?.slug) throw new Error('item.slug is required')
  if (item.status && !STATUSES.includes(item.status) && item.status !== 'published') {
    throw new Error(`invalid status ${item.status}`)
  }
  item.updatedAt = new Date().toISOString()
  if (!item.createdAt) item.createdAt = item.updatedAt
  if (!item.langs) item.langs = emptyLangs()
  for (const lang of BLOG_LANGS) {
    if (!item.langs[lang]) item.langs[lang] = emptyLangs()[lang]
  }
  writeJson(itemPath(item.slug), item)
  return item
}

export function deleteItem(slug) {
  const file = itemPath(slug)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export function createItem(partial) {
  const requested = partial.slug || uniqueSlug(partial.sourceTitle || partial.title || 'news')
  const slug = fs.existsSync(itemPath(requested)) ? uniqueSlug(requested) : requested
  const item = {
    slug,
    status: partial.status || 'pending',
    source: 'pipeline',
    category: partial.category || 'ai_news',
    sourceId: partial.sourceId || null,
    sourceUrl: partial.sourceUrl || '',
    sourceTitle: partial.sourceTitle || '',
    sourceText: partial.sourceText || '',
    citeMode: partial.citeMode || 'footer',
    relevance: partial.relevance || null,
    langs: partial.langs || emptyLangs(),
    publishedAt: null,
    publishedPostId: null,
    ...partial,
    slug,
  }
  return saveItem(item)
}
