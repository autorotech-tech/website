import { CATEGORIES } from './langs.mjs'
import { chatJson } from './swoop-llm.mjs'

const POSITIVE = [
  'ai marketing', 'marketing automation', 'google ads', 'meta ads', 'facebook ads',
  'ppc', 'paid search', 'paid social', 'programmatic', 'cro', 'seo', 'llm',
  'openai', 'anthropic', 'gemini', 'claude', 'chatgpt', 'n8n', 'hubspot', 'martech',
  'advertising', 'campaign', 'creative', 'attribution', 'conversion',
  'marketing api', 'ads api', 'digital marketing', 'growth', 'performance marketing',
  'automation', 'workflow', 'ads', 'agent',
]

const NEGATIVE = [
  'phu quoc', 'fukuoka', 'travel itinerary', 'celebrity', 'hollywood',
  'football transfer', 'recipe', 'horoscope', 'memecoin', 'shitcoin',
  'pump and dump', 'airdrop hunt', 'onlyfans',
]

const CRYPTO_KEEP = [
  'ads', 'advertis', 'marketing', 'regulation', 'sec', 'etf', 'payment',
  'merchant', 'business', 'fraud', 'attribution', 'stablecoin', 'exchange hack',
]

export function heuristicScore({ title, summary, category, trusted = false }) {
  const blob = `${title || ''} ${summary || ''}`.toLowerCase()
  let score = 0.15
  for (const k of POSITIVE) {
    if (blob.includes(k)) score += 0.12
  }
  for (const k of NEGATIVE) {
    if (blob.includes(k)) score -= 0.35
  }
  if (category === 'crypto') {
    const keep = CRYPTO_KEEP.some((k) => blob.includes(k))
    if (!keep) score -= 0.4
    if (/\b(pump|moon|100x|gem)\b/.test(blob)) score -= 0.4
  } else if (trusted) {
    score += 0.3
  }
  if (category === 'manuals') score += 0.15
  if (category === 'google_ads' || category === 'meta_ads' || category === 'ai_marketing') score += 0.12
  return Math.max(0, Math.min(1, score))
}

export async function checkNewsRelevance({ title, summary, url, category, model, minScore, trusted = false }) {
  const heuristic = heuristicScore({ title, summary, category, trusted })
  const fallback = {
    relevant: heuristic >= minScore,
    score: heuristic,
    category: CATEGORIES.includes(category) ? category : 'ai_news',
    reason: 'heuristic',
  }

  try {
    const { json } = await chatJson({
      model,
      temperature: 0,
      maxTokens: 400,
      messages: [
        {
          role: 'system',
          content: `Classify if an article should appear on Autoro.tech (AI marketing, ads, automation, models, implementation, digital marketing, relevant crypto-for-business, first-party ad API manuals). Reject travel, celebrity, sports, recipes, memecoins, off-topic pumps. Return JSON {"relevant":boolean,"score":0-1,"category":one of ${CATEGORIES.join(',')},"reason":"short"}.`,
        },
        {
          role: 'user',
          content: JSON.stringify({ title, summary, url, suggestedCategory: category }),
        },
      ],
    })
    const score = Number(json.score)
    const cat = CATEGORIES.includes(json.category) ? json.category : (category || 'ai_news')
    const relevant = Boolean(json.relevant) && (Number.isFinite(score) ? score : heuristic) >= minScore
    return {
      relevant,
      score: Number.isFinite(score) ? score : heuristic,
      category: cat,
      reason: String(json.reason || 'llm'),
    }
  } catch {
    return fallback
  }
}
