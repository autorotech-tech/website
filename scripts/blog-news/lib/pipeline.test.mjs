import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFeedXml, parseRedditListing, extractListingLinks } from './rss.mjs'
import { slugify, normalizeUrl } from './slug.mjs'
import { heuristicScore } from './relevance.mjs'
import { stripAiSlop, markdownToHtml } from './rewrite-article.mjs'
import { titleSimilarity } from './dedup.mjs'

test('parse RSS items', () => {
  const xml = `<?xml version="1.0"?>
  <rss><channel>
    <item>
      <title>Google Ads API v18</title>
      <link>https://developers.google.com/google-ads/api/docs/release-notes</link>
      <description>New metrics for Performance Max.</description>
    </item>
  </channel></rss>`
  const items = parseFeedXml(xml)
  assert.equal(items.length, 1)
  assert.match(items[0].title, /Google Ads API/)
  assert.match(items[0].url, /release-notes/)
})

test('parse Atom and reddit json', () => {
  const atom = `<feed><entry><title>Claude update</title><link href="https://www.anthropic.com/news/x"/><summary>API change</summary></entry></feed>`
  const items = parseFeedXml(atom)
  assert.equal(items[0].url.includes('anthropic.com'), true)
  const reddit = parseRedditListing({
    data: { children: [{ data: { title: 'PPC tip', permalink: '/r/PPC/comments/1', url: 'https://example.com/a', selftext: 'bid caps', created_utc: 1700000000 } }] },
  })
  assert.equal(reddit[0].title, 'PPC tip')
})

test('listing links honor pattern', () => {
  const html = `<a href="/blog/hello">Hello</a><a href="/about">About</a>`
  const links = extractListingLinks(html, 'https://blog.n8n.io/', { linkPattern: '/blog/' })
  assert.equal(links.length, 1)
  assert.equal(links[0].url, 'https://blog.n8n.io/blog/hello')
})

test('slug and url normalize', () => {
  assert.equal(slugify('AI Marketing: What to do next!'), 'ai-marketing-what-to-do-next')
  assert.equal(normalizeUrl('https://x.com/a/?utm=1#'), 'https://x.com/a?utm=1')
})

test('relevance heuristic', () => {
  const ads = heuristicScore({ title: 'Google Ads conversion tracking update', summary: 'Performance Max', category: 'google_ads' })
  const travel = heuristicScore({ title: 'Best beaches in Phu Quoc', summary: 'travel itinerary', category: 'ai_news' })
  const pump = heuristicScore({ title: 'This memecoin will moon 100x', summary: 'pump and dump gem', category: 'crypto' })
  assert.ok(ads > 0.4)
  assert.ok(travel < 0.3)
  assert.ok(pump < 0.2)
})

test('slop and markdown', () => {
  const cleaned = stripAiSlop('Hello — world → “x” delve into it')
  assert.equal(cleaned.includes('—'), false)
  assert.equal(cleaned.includes('→'), false)
  const html = markdownToHtml('# Title\n\n- one')
  assert.match(html, /<h1>/)
  assert.match(html, /<ul>/)
})

test('title similarity', () => {
  assert.ok(titleSimilarity('Google Ads API v18 release notes', 'Google Ads API v18 release notes!') > 0.9)
})

test('scraping fallback functions exist and export correctly', async () => {
  const { scrapeArticle, jinaFallback, scrapingBeeFallback, fetchPlain } = await import('./swoop-scrape.mjs')
  assert.equal(typeof scrapeArticle, 'function')
  assert.equal(typeof jinaFallback, 'function')
  assert.equal(typeof scrapingBeeFallback, 'function')
  assert.equal(typeof fetchPlain, 'function')
})
