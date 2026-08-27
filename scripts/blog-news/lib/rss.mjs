function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim()
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')
  const m = block.match(re)
  if (m) return decodeXml(m[1])
  const attr = block.match(new RegExp(`<${name}[^>]*?(?:href|url|src)=["']([^"']+)["']`, 'i'))
  return attr ? decodeXml(attr[1]) : ''
}

function collectBlocks(xml, names) {
  const out = []
  for (const name of names) {
    const re = new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}>`, 'gi')
    let m
    while ((m = re.exec(xml))) out.push(m[0])
  }
  return out
}

export function parseFeedXml(xml) {
  const items = collectBlocks(xml, ['item', 'entry']).map((block) => {
    const link = tag(block, 'link') || tag(block, 'guid') || tag(block, 'id')
    const title = tag(block, 'title')
    const summary =
      tag(block, 'description') ||
      tag(block, 'summary') ||
      tag(block, 'content') ||
      tag(block, 'content:encoded')
    const published =
      tag(block, 'pubDate') ||
      tag(block, 'published') ||
      tag(block, 'updated') ||
      tag(block, 'dc:date')
    return {
      title,
      url: link,
      summary: summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      publishedAt: published || null,
    }
  })
  return items.filter((item) => item.url && item.title)
}

export async function fetchText(url, { timeoutMs = 20000, headers = {} } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'AutoroBlogNews/1.0 (+https://autoro.tech)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.9, */*;q=0.8',
        ...headers,
      },
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchFeedItems(url) {
  const xml = await fetchText(url)
  return parseFeedXml(xml)
}

export function extractListingLinks(html, pageUrl, { linkPattern = null, max = 30 } = {}) {
  const found = []
  const seen = new Set()
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  const origin = new URL(pageUrl)
  const pattern = linkPattern ? new RegExp(linkPattern, 'i') : null
  while ((m = re.exec(html))) {
    let href
    try {
      href = new URL(m[1], origin).toString()
    } catch {
      continue
    }
    if (pattern && !pattern.test(href)) continue
    if (href.split('#')[0] === pageUrl.split('#')[0]) continue
    if (seen.has(href)) continue
    seen.add(href)
    const title = decodeXml(m[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    found.push({ title: title || href, url: href, summary: '', publishedAt: null })
    if (found.length >= max) break
  }
  return found
}

export function parseRedditListing(payload) {
  const children = payload?.data?.children
  if (!Array.isArray(children)) return []
  return children
    .map((row) => {
      const d = row?.data || {}
      const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : ''
      const url = d.url_overridden_by_dest || d.url || permalink
      return {
        title: d.title || '',
        url,
        summary: String(d.selftext || '').slice(0, 4000),
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        redditPermalink: permalink,
      }
    })
    .filter((item) => item.title && item.url)
}
