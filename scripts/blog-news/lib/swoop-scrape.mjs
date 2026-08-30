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

function getApifyTokens() {
  const raw = [
    process.env.BLOG_NEWS_APIFY_TOKEN,
    process.env.APIFY_TOKEN,
    process.env.APIFY_API_KEY,
    process.env.APIFY_KEYS,
  ].filter(Boolean)
  const tokens = []
  for (const item of raw) {
    if (typeof item === 'string' && item.startsWith('[')) {
      try {
        const parsed = JSON.parse(item)
        if (Array.isArray(parsed)) {
          tokens.push(...parsed.filter((t) => typeof t === 'string' && t.trim()))
          continue
        }
      } catch {}
    }
    if (typeof item === 'string' && item.includes(',')) {
      tokens.push(...item.split(',').map((t) => t.trim()).filter(Boolean))
    } else if (typeof item === 'string' && item.trim()) {
      tokens.push(item.trim())
    }
  }
  return Array.from(new Set(tokens))
}

export async function jinaFallback(url, timeoutMs = 25000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers = {
      'user-agent': 'AutoroBlogNews/1.0 (+https://autoro.tech)',
      accept: 'text/markdown,text/plain,*/*',
    }
    const jinaKey = (process.env.JINA_API_KEY || process.env.JINA_TOKEN || '').trim()
    if (jinaKey) {
      headers['authorization'] = `Bearer ${jinaKey}`
    }
    const cleanUrl = url.replace(/^https?:\/\//i, '')
    const res = await fetch(`https://r.jina.ai/https://${cleanUrl}`, {
      signal: ctrl.signal,
      headers,
    })
    if (!res.ok) return null
    const text = await res.text()
    return text && text.length > 200 ? text : null
  } catch (err) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function scrapingBeeFallback(url, timeoutMs = 35000) {
  const raw = [
    process.env.SCRAPINGBEE_API_KEY,
    process.env.SCRAPINGBEE_KEY,
    process.env.SCRAPINGBEE_KEYS,
  ].filter(Boolean)
  const keys = []
  for (const item of raw) {
    if (typeof item === 'string' && item.startsWith('[')) {
      try {
        const parsed = JSON.parse(item)
        if (Array.isArray(parsed)) {
          keys.push(...parsed.filter((t) => typeof t === 'string' && t.trim()))
          continue
        }
      } catch {}
    }
    if (typeof item === 'string' && item.includes(',')) {
      keys.push(...item.split(',').map((t) => t.trim()).filter(Boolean))
    } else if (typeof item === 'string' && item.trim()) {
      keys.push(item.trim())
    }
  }
  if (!keys.length) return null

  for (const apiKey of keys) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const q = new URLSearchParams({
        api_key: apiKey,
        url,
        render_js: 'false',
        extract_rules: JSON.stringify({ body: 'body' }),
      })
      const res = await fetch(`https://app.scrapingbee.com/api/v1/?${q.toString()}`, {
        signal: ctrl.signal,
      })
      if (!res.ok) continue
      const text = await res.text()
      if (text && text.length > 200) {
        return text
      }
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function apifyFallback(url) {
  const tokens = getApifyTokens()
  if (!tokens.length) return null

  const actor = process.env.BLOG_NEWS_APIFY_ACTOR || 'apify/website-content-crawler'
  const memoryMbytes = parseInt(process.env.BLOG_NEWS_APIFY_MEMORY_MB || '1024', 10) || 1024

  for (const token of tokens) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 60000)
      const q = new URLSearchParams({
        token,
        memory: String(memoryMbytes),
        timeout: '60',
      })
      const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?${q.toString()}`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url }],
          maxCrawlPages: 1,
          maxResults: 1,
          saveHtml: false,
          saveMarkdown: true,
          saveScreenshots: false,
        }),
      })
      clearTimeout(timer)
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.warn(`[apifyFallback] Token attempt failed (${res.status}): ${errText.slice(0, 180)}`)
        continue
      }
      const rows = await res.json()
      const row = Array.isArray(rows) ? rows[0] : null
      const content = row?.markdown || row?.text || row?.content
      if (content && content.length > 200) {
        return content
      }
    } catch (err) {
      console.warn(`[apifyFallback] Actor run error: ${err.message || err}`)
      continue
    }
  }
  return null
}

export async function scrapeArticle(url, { mode = 'fetcher' } = {}) {
  let text = ''
  let bestVia = 'fetch'
  const errors = []

  // 1. Прямой fetchPlain
  try {
    const html = await fetchPlain(url)
    text = htmlToText(html)
  } catch (err) {
    text = ''
    errors.push(`fetchPlain: ${err.message || err}`)
  }
  if (text.length >= 800) return { text, via: 'fetch' }

  // 2. Swoop Scrape (Scrapling / stealth / dynamic)
  try {
    const scraped = await swoopScrape(url, { mode })
    const cleaned = htmlToText(scraped)
    if (cleaned.length > text.length && cleaned.length >= 250) {
      return { text: cleaned, via: 'swoop' }
    }
    if (cleaned.length > text.length) {
      text = cleaned
      bestVia = 'swoop'
    }
  } catch (err) {
    errors.push(`swoop: ${err.message || err}`)
    if (text.length >= 350) return { text, via: 'fetch-short', error: String(err.message || err) }
  }

  // 3. Jina AI reader (быстрый чистый markdown)
  try {
    const jinaText = await jinaFallback(url)
    if (jinaText) {
      const cleaned = htmlToText(jinaText)
      if (cleaned.length > text.length && cleaned.length >= 300) {
        return { text: cleaned, via: 'jina' }
      }
      if (cleaned.length > text.length) {
        text = cleaned
        bestVia = 'jina'
      }
    }
  } catch (err) {
    errors.push(`jina: ${err.message || err}`)
  }

  // 4. ScrapingBee (проксирование антифрод/Cloudflare)
  try {
    const sbText = await scrapingBeeFallback(url)
    if (sbText) {
      const cleaned = htmlToText(sbText)
      if (cleaned.length > text.length && cleaned.length >= 300) {
        return { text: cleaned, via: 'scrapingbee' }
      }
      if (cleaned.length > text.length) {
        text = cleaned
        bestVia = 'scrapingbee'
      }
    }
  } catch (err) {
    errors.push(`scrapingbee: ${err.message || err}`)
  }

  // 5. Apify fallback с ротацией токенов и пониженным memory allocation (1024MB)
  try {
    const apify = await apifyFallback(url)
    if (apify) {
      const cleaned = htmlToText(apify)
      if (cleaned.length > text.length && cleaned.length >= 300) {
        return { text: cleaned, via: 'apify' }
      }
      if (cleaned.length > text.length) {
        text = cleaned
        bestVia = 'apify'
      }
    }
  } catch (err) {
    errors.push(`apify: ${err.message || err}`)
  }

  if (text && text.length >= 200) {
    return { text, via: bestVia, fallback: true, errors }
  }

  throw new Error(`Could not scrape ${url}: ${errors.join('; ')}`)
}
