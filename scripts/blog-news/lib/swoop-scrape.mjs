function swoopBase() {
  return String(process.env.SWOOP_API_BASE || 'https://swoop.autoro.tech').replace(/\/+$/, '')
}

function swoopKey() {
  return String(process.env.SWOOP_API_KEY || process.env.AUTORO_SCRAPE_API_KEY || process.env.AGENT_API_KEY || '').trim()
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchPlain(url, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'AutoroBlogNews/1.0 (+https://autoro.tech)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function swoopScrape(url, { mode = 'fetcher', outputFormat = 'markdown', timeoutMs = 90000 } = {}) {
  const key = swoopKey()
  if (!key) throw new Error('SWOOP_API_KEY is required for scrape')
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    authorization: `Bearer ${key}`,
  }
  const created = await fetch(`${swoopBase()}/api/v1/scrape`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url,
      mode,
      output_format: outputFormat,
    }),
  })
  const createdText = await created.text()
  if (!created.ok) {
    throw new Error(`scrape create HTTP ${created.status}: ${createdText.slice(0, 300)}`)
  }
  const job = JSON.parse(createdText)
  const jobId = job.job_id || job.id
  if (!jobId) throw new Error('scrape job_id missing')

  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    await sleep(2000)
    const statusRes = await fetch(`${swoopBase()}/api/v1/scrape/${jobId}`, { headers })
    const statusText = await statusRes.text()
    if (!statusRes.ok) throw new Error(`scrape status HTTP ${statusRes.status}`)
    const status = JSON.parse(statusText)
    const st = status.status
    if (st === 'done' || st === 'completed') {
      if (status.result_preview && status.result_preview.length > 400) {
        return status.result_preview
      }
      if (status.result_url) {
        const dl = await fetch(`${swoopBase()}${status.result_url.startsWith('/') ? status.result_url : `/${status.result_url}`}`, { headers })
        if (dl.ok) return await dl.text()
      }
      return status.result_preview || ''
    }
    if (st === 'error' || st === 'failed') {
      throw new Error(status.error || 'scrape failed')
    }
  }
  throw new Error(`scrape timeout for ${url}`)
}

async function apifyFallback(url) {
  const token = process.env.BLOG_NEWS_APIFY_TOKEN || process.env.APIFY_TOKEN
  const actor = process.env.BLOG_NEWS_APIFY_ACTOR || 'apify/website-content-crawler'
  if (!token) return null
  const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url }], maxCrawlPages: 1 }),
  })
  if (!res.ok) return null
  const rows = await res.json()
  const row = Array.isArray(rows) ? rows[0] : null
  return row?.text || row?.markdown || row?.content || null
}

export async function scrapeArticle(url, { mode = 'fetcher' } = {}) {
  let text = ''
  try {
    const html = await fetchPlain(url)
    text = htmlToText(html)
  } catch {
    text = ''
  }
  if (text.length >= 800) return { text, via: 'fetch' }

  try {
    const scraped = await swoopScrape(url, { mode })
    const cleaned = htmlToText(scraped)
    if (cleaned.length > text.length) {
      return { text: cleaned, via: 'swoop' }
    }
  } catch (err) {
    if (text.length >= 280) return { text, via: 'fetch-short', error: String(err.message || err) }
  }

  const apify = await apifyFallback(url)
  if (apify && apify.length > text.length) {
    return { text: htmlToText(apify), via: 'apify' }
  }
  if (text) return { text, via: 'fetch-fallback' }
  throw new Error(`Could not scrape ${url}`)
}
