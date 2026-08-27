import { normalizeTitle, normalizeUrl } from './slug.mjs'

function tokens(title) {
  return new Set(normalizeTitle(title).split(' ').filter((w) => w.length > 2))
}

export function titleSimilarity(a, b) {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size || !right.size) return 0
  let inter = 0
  for (const t of left) {
    if (right.has(t)) inter += 1
  }
  return inter / Math.min(left.size, right.size)
}

export function isDuplicate({ url, title }, { seenUrls, existingItems, titleThreshold = 0.86 }) {
  const nurl = normalizeUrl(url)
  if (seenUrls.has(nurl)) return { dup: true, reason: 'url' }
  for (const item of existingItems) {
    if (normalizeUrl(item.sourceUrl || item.url || '') === nurl) {
      return { dup: true, reason: 'item-url' }
    }
    if (titleSimilarity(title, item.sourceTitle || item.langs?.en?.title || '') >= titleThreshold) {
      return { dup: true, reason: 'title' }
    }
  }
  return { dup: false, reason: null }
}
